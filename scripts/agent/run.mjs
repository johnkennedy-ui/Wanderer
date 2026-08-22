import { openSync, closeSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

import {
  AgentError,
  agentPath,
  commandText,
  ensureAgentDirectory,
  failureSignature,
  lastLogLines,
  readMissionState,
  writeJsonAtomic,
  writeMissionState,
} from "./common.mjs";

export const DEFAULT_TIMEOUT_MS = 300_000;

const runIdentifier = () =>
  `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;

const parseArguments = (argv) => {
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let diagnosis = "";
  let commandStart = -1;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      commandStart = index + 1;
      break;
    }
    if (argument === "--timeout") {
      const seconds = Number(argv[++index]);
      if (!Number.isFinite(seconds) || seconds <= 0)
        throw new AgentError(
          "--timeout must be a positive number of seconds.",
          "INVALID_TIMEOUT",
        );
      timeoutMs = Math.round(seconds * 1_000);
      continue;
    }
    if (argument === "--force-after-diagnosis") {
      diagnosis = argv[++index] ?? "";
      continue;
    }
    throw new AgentError(`Unknown argument: ${argument}`, "INVALID_ARGUMENT");
  }
  const command = commandStart === -1 ? [] : argv.slice(commandStart);
  if (command.length === 0)
    throw new AgentError(
      "Usage: agent:run [--timeout seconds] [--force-after-diagnosis text] -- command args...",
      "MISSING_COMMAND",
    );
  if (diagnosis !== "" && diagnosis.trim() === "")
    throw new AgentError(
      "--force-after-diagnosis requires a non-empty diagnosis.",
      "MISSING_DIAGNOSIS",
    );
  return { command, timeoutMs, diagnosis: diagnosis.trim() };
};

const terminateChildTree = (child, signal = "SIGTERM") => {
  if (!child?.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The child may already have exited between the process-group and direct kill attempts.
    }
  }
};

const recordRun = (state, record) => ({
  ...state,
  runs: [...(state.runs ?? []), record].slice(-50),
});

const writeRunRecord = (cwd, id, record) => {
  ensureAgentDirectory(cwd, "runs");
  const path = agentPath(cwd, "runs", `${id}.json`);
  writeJsonAtomic(path, record);
  return path;
};

const refusalRecord = ({ id, command, timeoutMs, state, now }) => ({
  schemaVersion: 1,
  id,
  command,
  commandText: commandText(command),
  timeoutMs,
  status: "failed",
  failureKind: "repeat-refused",
  refused: true,
  startedAt: now,
  finishedAt: now,
  exitCode: null,
  signal: null,
  timedOut: false,
  failureTail:
    "Refused before execution: two consecutive materially identical failures require --force-after-diagnosis with a non-empty diagnosis.",
  failureSignature: state.lastFailureSignature,
  logPath: null,
});

export const runCommand = async ({
  cwd = process.cwd(),
  command,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  diagnosis = "",
  now = () => new Date().toISOString(),
  spawnChild = spawn,
} = {}) => {
  if (!Array.isArray(command) || command.length === 0)
    throw new AgentError(
      "runCommand requires a non-empty command array.",
      "MISSING_COMMAND",
    );
  const state = readMissionState(cwd);
  const id = runIdentifier();
  const renderedCommand = commandText(command);
  const startedAt = now();
  const repeatedCommand =
    state.lastFailureCommand === renderedCommand &&
    state.repeatedFailureCount >= 2;

  if (repeatedCommand && !diagnosis.trim()) {
    const record = refusalRecord({
      id,
      command,
      timeoutMs,
      state,
      now: startedAt,
    });
    writeRunRecord(cwd, id, record);
    writeMissionState(cwd, recordRun(state, record));
    return record;
  }

  ensureAgentDirectory(cwd, "runs");
  const logPath = agentPath(cwd, "runs", `${id}.log`);
  const statusPath = agentPath(cwd, "runs", `${id}.json`);
  const runningRecord = {
    schemaVersion: 1,
    id,
    command,
    commandText: renderedCommand,
    timeoutMs,
    status: "running",
    startedAt,
    finishedAt: null,
    exitCode: null,
    signal: null,
    timedOut: false,
    failureTail: "",
    failureSignature: null,
    logPath: join(AGENT_LOG_ROOT, `${id}.log`),
  };
  writeJsonAtomic(statusPath, runningRecord);

  const logDescriptor = openSync(logPath, "w");
  let timedOut = false;
  let interruptedBy = null;
  let child = null;
  let forceKillTimer = null;
  let timeoutTimer = null;
  const interruptionHandler = (signal) => {
    interruptedBy = signal;
    terminateChildTree(child);
  };

  const completed = await new Promise((resolveResult) => {
    const settle = (result) => {
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      if (forceKillTimer !== null) clearTimeout(forceKillTimer);
      process.removeListener("SIGINT", interruptionHandler);
      process.removeListener("SIGTERM", interruptionHandler);
      resolveResult(result);
    };

    try {
      child = spawnChild(command[0], command.slice(1), {
        cwd,
        detached: process.platform !== "win32",
        stdio: ["ignore", logDescriptor, logDescriptor],
      });
    } catch (error) {
      settle({ code: null, signal: null, spawnError: error });
      return;
    }

    process.once("SIGINT", interruptionHandler);
    process.once("SIGTERM", interruptionHandler);
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminateChildTree(child);
      forceKillTimer = setTimeout(
        () => terminateChildTree(child, "SIGKILL"),
        1_000,
      );
    }, timeoutMs);
    child.once("error", (spawnError) =>
      settle({ code: null, signal: null, spawnError }),
    );
    child.once("close", (code, signal) =>
      settle({ code, signal, spawnError: null }),
    );
  });

  closeSync(logDescriptor);
  const failureTail = lastLogLines(logPath);
  const status = timedOut
    ? "timed-out"
    : completed.code === 0 && !completed.signal && !completed.spawnError
      ? "passed"
      : "failed";
  const exitCode = completed.code ?? (interruptedBy ? 130 : 1);
  const signature =
    status === "passed"
      ? null
      : failureSignature({
          command,
          exitCode,
          tail:
            failureTail || String(completed.spawnError ?? interruptedBy ?? ""),
        });
  const record = {
    ...runningRecord,
    status,
    finishedAt: now(),
    exitCode,
    signal: completed.signal ?? interruptedBy,
    timedOut,
    interrupted: interruptedBy !== null,
    failureTail: status === "passed" ? "" : failureTail,
    failureSignature: signature,
  };
  writeJsonAtomic(statusPath, record);

  const nextState = recordRun(state, record);
  if (status === "passed") {
    nextState.lastSuccessfulCheck = {
      command: renderedCommand,
      completedAt: record.finishedAt,
      runId: id,
    };
    nextState.lastFailureSignature = null;
    nextState.repeatedFailureCount = 0;
    nextState.lastFailureCommand = null;
    nextState.lastFailureDiagnosis = null;
  } else {
    const equivalent = state.lastFailureSignature === signature;
    nextState.lastFailureSignature = signature;
    nextState.repeatedFailureCount = equivalent
      ? state.repeatedFailureCount + 1
      : 1;
    nextState.lastFailureCommand = renderedCommand;
    nextState.lastFailureDiagnosis = diagnosis || null;
  }
  writeMissionState(cwd, nextState);
  return record;
};

const AGENT_LOG_ROOT = ".agent/runs";

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const record = await runCommand(options);
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  process.exitCode = record.status === "passed" ? 0 : 1;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
