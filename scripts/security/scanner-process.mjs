import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const supervisor = fileURLToPath(
  new URL("./scanner-supervisor.py", import.meta.url),
);
const guardian = fileURLToPath(
  new URL("./scanner-guardian.py", import.meta.url),
);
const DEFAULT_LIMIT = 32 * 1024 * 1024;
const STATUS_LIMIT = 64 * 1024;
const OWNERSHIP_FRAME_LIMIT = 64 * 1024;
const TERMINATIONS = new Set([
  "none",
  "timeout",
  "overflow",
  "interrupted",
  "control-eof",
  "cleanup-deadline",
  "spawn-error",
]);
const signalName = (value) =>
  typeof value === "string" && /^SIG[A-Z0-9]+$/.test(value);

export const selectOwnedTree = (records, rootPid, expectedRoot) => {
  const root = records.get(rootPid);
  if (
    !expectedRoot ||
    !root ||
    root.startTime !== expectedRoot.startTime ||
    (expectedRoot.ppid !== undefined && root.ppid !== expectedRoot.ppid)
  )
    return new Map();
  const owned = new Map();
  const pending = [rootPid];
  while (pending.length) {
    const pid = pending.pop();
    const record = records.get(pid);
    if (!record || owned.has(pid)) continue;
    owned.set(pid, record);
    for (const [candidate, candidateRecord] of records) {
      if (candidateRecord.ppid === pid) pending.push(candidate);
    }
  }
  return owned;
};

const identity = (entry) =>
  entry &&
  Number.isInteger(entry.pid) &&
  entry.pid > 0 &&
  typeof entry.startTime === "string"
    ? { pid: entry.pid, startTime: entry.startTime }
    : null;

export const ownershipSnapshot = (value) => {
  if (!value || value.version !== 1) return null;
  const root = value.root === null ? null : identity(value.root);
  const descendants = Array.isArray(value.descendants)
    ? value.descendants.map(identity).filter(Boolean)
    : null;
  if (!descendants) return null;
  return { root, descendants };
};

export const consumeOwnershipFrames = (pending, chunk) => {
  let buffer = Buffer.concat([pending, chunk]);
  const discarding = pending.discarding === true;
  const frames = [];
  if (discarding) {
    const delimiter = buffer.indexOf(0x0a);
    if (delimiter === -1) {
      const empty = Buffer.alloc(0);
      empty.discarding = true;
      return { pending: empty, frames };
    }
    buffer = buffer.subarray(delimiter + 1);
  }
  let index;
  while ((index = buffer.indexOf(0x0a)) !== -1) {
    const line = buffer.subarray(0, index);
    buffer = buffer.subarray(index + 1);
    if (!line.length || line.length > OWNERSHIP_FRAME_LIMIT) continue;
    try {
      const snapshot = ownershipSnapshot(JSON.parse(line.toString("utf8")));
      if (snapshot) frames.push(snapshot);
    } catch {
      // Malformed telemetry cannot mint ownership.
    }
  }
  if (buffer.length > OWNERSHIP_FRAME_LIMIT) {
    const empty = Buffer.alloc(0);
    empty.discarding = true;
    return { pending: empty, frames };
  }
  return { pending: buffer, frames };
};

export const selectRecordedProcesses = (records, snapshot) => {
  const selected = new Map();
  if (!snapshot) return selected;
  for (const entry of [snapshot.root, ...snapshot.descendants].filter(
    Boolean,
  )) {
    const current = records.get(entry.pid);
    if (!current || current.startTime !== entry.startTime) continue;
    for (const [pid, record] of selectOwnedTree(records, entry.pid, {
      startTime: entry.startTime,
    }))
      selected.set(pid, record);
  }
  return selected;
};

const decodeBoundedUtf8 = (chunks) => {
  const bytes = Buffer.concat(chunks);
  for (let end = bytes.length; end >= Math.max(0, bytes.length - 3); end -= 1) {
    const text = bytes.subarray(0, end).toString("utf8");
    if (Buffer.byteLength(text) <= end) return { bytes: end, text };
  }
  return { bytes: 0, text: "" };
};

const validStatus = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (
    JSON.stringify(keys) !==
    JSON.stringify([
      "error",
      "exitCode",
      "reaping",
      "signal",
      "termination",
      "version",
    ])
  )
    return false;
  if (value.version !== 1 || !TERMINATIONS.has(value.termination)) return false;
  if (value.reaping !== "reaped" && value.reaping !== "incomplete")
    return false;
  if (
    value.exitCode !== null &&
    (!Number.isInteger(value.exitCode) || value.exitCode < 0)
  )
    return false;
  if (value.signal !== null && !signalName(value.signal)) return false;
  if (value.error !== null && typeof value.error !== "string") return false;
  if (value.exitCode !== null && value.signal !== null) return false;
  return !(
    value.exitCode === null &&
    value.signal === null &&
    value.error === null
  );
};

const parseStatusFrames = (chunks, bytes) => {
  if (bytes > STATUS_LIMIT) return null;
  const frames = Buffer.concat(chunks)
    .toString("utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  if (!frames.length) return null;
  let parsed;
  try {
    parsed = frames.map((frame) => JSON.parse(frame));
  } catch {
    return null;
  }
  if (!parsed.every(validStatus)) return null;
  // A terminal guardian failure can follow an earlier supervisor failure
  // under a shared, already-expired cleanup deadline.  Selecting it remains
  // fail-closed; a multi-frame stream may never finish successfully.
  if (parsed.length > 1 && parsed.at(-1).error === null) return null;
  return parsed.at(-1);
};

export const executeScanner = (
  command,
  args,
  cwd,
  timeoutMs = 240_000,
  {
    signal,
    maxOutputBytes = DEFAULT_LIMIT,
    graceMs = 1_000,
    cleanupDeadlineMs = Math.max(500, graceMs * 2 + 250),
    testStatusFault = null,
  } = {},
) =>
  new Promise((done) => {
    const started = Date.now();
    const stdoutChunks = [];
    const stderrChunks = [];
    const statusChunks = [];
    let ownershipLine = Buffer.alloc(0);
    let latestOwnership = null;
    let outputBytes = 0;
    let statusBytes = 0;
    let timedOut = false;
    let overflow = false;
    let interrupted = false;
    let termination = null;
    let settled = false;
    let cleanupTimer = null;
    let forceSettleTimer = null;
    let stdinError = null;
    let fallbackStarted = false;
    const child = spawn(
      "python3",
      [
        guardian,
        supervisor,
        JSON.stringify([command, ...args]),
        cwd,
        String(graceMs),
        String(cleanupDeadlineMs),
        ...(testStatusFault ? [testStatusFault] : []),
      ],
      { cwd, stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"] },
    );
    const releaseOwnedHandles = () => {
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      child.stdio[3].destroy();
      child.stdio[4].destroy();
      child.unref();
    };
    const hasRecordedProcesses = () => {
      return Boolean(
        latestOwnership?.root || latestOwnership?.descendants.length,
      );
    };
    // Node has no supported pidfd signal API. The guardian owns the stable
    // pidfds for managed descendants; after it dies this fallback must fail
    // closed rather than signal a recycled bare PID.
    const failClosedFallback = () => {};
    const settle = (
      supervisorExitCode = null,
      supervisorSignal = null,
      supervisorError = null,
      releaseHandles = false,
    ) => {
      if (settled) return;
      settled = true;
      if (releaseHandles) releaseOwnedHandles();
      clearTimeout(timer);
      clearTimeout(cleanupTimer);
      clearTimeout(forceSettleTimer);
      signal?.removeEventListener("abort", onAbort);
      const stdout = decodeBoundedUtf8(stdoutChunks);
      const stderr = decodeBoundedUtf8(stderrChunks);
      const parsed = parseStatusFrames(statusChunks, statusBytes);
      const protocolValid = validStatus(parsed);
      const supervisorNormal =
        supervisorExitCode === 0 &&
        supervisorSignal === null &&
        supervisorError === null;
      const matchesTermination =
        !termination || (protocolValid && parsed.termination === termination);
      const cleanup =
        supervisorNormal &&
        protocolValid &&
        matchesTermination &&
        parsed.reaping === "reaped" &&
        (parsed.error === null || parsed.termination === "spawn-error")
          ? "reaped"
          : "unknown";
      const protocolError =
        supervisorError ||
        stdinError ||
        (!protocolValid
          ? "SCANNER_SUPERVISOR_STATUS_INVALID"
          : !matchesTermination
            ? "SCANNER_SUPERVISOR_TERMINATION_MISMATCH"
            : parsed.error ||
              (!supervisorNormal
                ? "SCANNER_SUPERVISOR_EXIT_INVALID"
                : (termination
                    ? `SCANNER_${termination.toUpperCase().replace("-", "_")}`
                    : null) ||
                  (parsed.termination !== "none"
                    ? `SCANNER_${parsed.termination
                        .toUpperCase()
                        .replace("-", "_")}`
                    : null) ||
                  (parsed.reaping !== "reaped"
                    ? "SCANNER_CLEANUP_INCOMPLETE"
                    : null)));
      done({
        exitCode: protocolValid ? parsed.exitCode : null,
        signal: protocolValid ? parsed.signal : null,
        error: protocolError,
        timedOut,
        overflow,
        interrupted:
          interrupted ||
          (protocolValid && parsed.termination === "interrupted"),
        termination:
          protocolValid && parsed.error === null && supervisorNormal
            ? parsed.termination
            : "unknown",
        cleanup,
        stdout: stdout.text,
        stderr: stderr.text,
        stdoutBytes: stdout.bytes,
        stderrBytes: stderr.bytes,
        supervisor: {
          exitCode: supervisorExitCode,
          signal: supervisorSignal,
          normal: supervisorNormal,
        },
        durationMs: Date.now() - started,
      });
    };
    const requestTermination = (reason) => {
      if (termination || settled) return;
      termination = reason;
      const teardownBudgetMs = Math.max(1, cleanupDeadlineMs);
      // Python time.monotonic() and Node hrtime share CLOCK_MONOTONIC on
      // Linux. Transmit one absolute deadline through both reapers so their
      // grace and reap reserves cannot become sequential relative windows.
      const teardownDeadlineMs =
        Number(process.hrtime.bigint() / 1_000_000n) + teardownBudgetMs;
      child.stdin.end(`${reason} ${teardownDeadlineMs}\n`);
      // Keep the protocol descriptors only for bounded receipt delivery after
      // that shared deadline; Node performs no unproven PID fallback.
      cleanupTimer = setTimeout(() => {
        fallbackStarted = true;
        failClosedFallback();
        forceSettleTimer = setTimeout(() => {
          failClosedFallback();
          settle(null, null, "SCANNER_CLEANUP_DEADLINE", true);
        }, 100);
      }, teardownBudgetMs + 300);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      requestTermination("timeout");
    }, timeoutMs);
    const onAbort = () => {
      interrupted = true;
      requestTermination("interrupted");
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    const collect = (chunks, chunk) => {
      const remaining = Math.max(0, maxOutputBytes - outputBytes);
      outputBytes += chunk.length;
      if (remaining) chunks.push(chunk.subarray(0, remaining));
      if (outputBytes > maxOutputBytes) {
        overflow = true;
        requestTermination("overflow");
      }
    };
    child.stdout.on("data", (chunk) => collect(stdoutChunks, chunk));
    child.stderr.on("data", (chunk) => collect(stderrChunks, chunk));
    child.stdio[3].on("data", (chunk) => {
      statusBytes += chunk.length;
      if (statusBytes <= STATUS_LIMIT) statusChunks.push(chunk);
    });
    child.stdio[4].on("data", (chunk) => {
      const consumed = consumeOwnershipFrames(ownershipLine, chunk);
      ownershipLine = consumed.pending;
      for (const snapshot of consumed.frames) latestOwnership = snapshot;
    });
    child.stdin.on("error", (error) => {
      stdinError = `SCANNER_CONTROL_${error.code || "ERROR"}`;
    });
    child.on("error", (error) =>
      settle(null, null, error.code || "SCANNER_SUPERVISOR_SPAWN_ERROR"),
    );
    child.on("close", (code, childSignal) => {
      if (fallbackStarted) return;
      if (
        (code !== 0 || childSignal !== null) &&
        (hasRecordedProcesses() || termination)
      ) {
        fallbackStarted = true;
        failClosedFallback();
        forceSettleTimer = setTimeout(() => {
          failClosedFallback();
          // A guardian that exits nonzero during caller-directed termination
          // has not established a scanner exit status, even when ownership
          // was not observed before the stop/cleanup race.
          settle(null, null, null, true);
        }, 100);
        return;
      }
      settle(code, childSignal);
    });
  });
