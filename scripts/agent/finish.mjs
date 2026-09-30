import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AGENT_EVIDENCE_SCHEMA_VERSION,
  AgentError,
  assertNoSymlinkAncestors,
  collectFixtureHashes,
  collectInputFingerprint,
  readMissionState,
  readWorktreeState,
  sha256Text,
  validationIdentity,
  ensureAgentDirectory,
  writeJsonAtomic,
  commandText,
} from "./common.mjs";
import { inspectDoctor } from "./doctor.mjs";
import { runCommand } from "./run.mjs";
export const REQUIRED_FINAL_COMMANDS = [
  "npm run verify",
  "npm run test:browser -- --reuse-root-build",
  "npm run security:check",
  "node scripts/security/artifact.mjs verify --base /Wanderer/",
];
export const REQUIRED_FULL_MATRIX_COMMANDS = [
  "npm run verify",
  "npm run test:browser -- --reuse-root-build --scope matrix",
  "npm run security:check",
  "node scripts/security/artifact.mjs verify --base /Wanderer/",
];
// Outer bounds cover the existing complete matrices/scanner stages, not a
// relaxation of any individual test's assertions, retries or timeout.
const timeoutFor = (command) =>
  command.startsWith("npm run test:browser") ||
  command === REQUIRED_FINAL_COMMANDS[2]
    ? 1_800_000
    : 300_000;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const reject = (message, code) => {
  throw new AgentError(message, code);
};
const regularFile = (path) => {
  assertNoSymlinkAncestors(path);
  if (!existsSync(path) || !lstatSync(path).isFile())
    reject(
      "Required evidence file missing or nonregular.",
      "INVALID_FINAL_LOG",
    );
  return readFileSync(path);
};

const requireRecord = ({ records, command, fingerprint, cwd, identity }) => {
  const record = [...records]
    .reverse()
    .find((entry) => entry.commandText === command);
  if (!record)
    reject("Missing required final command: " + command, "MISSING_FINAL_RUN");
  if (
    record.schemaVersion !== AGENT_EVIDENCE_SCHEMA_VERSION ||
    record.status !== "passed" ||
    record.exitCode !== 0 ||
    record.signal ||
    record.timedOut ||
    record.interrupted ||
    record.refused ||
    !Number.isFinite(record.durationMs) ||
    record.durationMs < 0 ||
    !Number.isFinite(Date.parse(record.startedAt)) ||
    !Number.isFinite(Date.parse(record.finishedAt)) ||
    Date.parse(record.finishedAt) < Date.parse(record.startedAt) ||
    Date.parse(record.finishedAt) > Date.now() + 60_000 ||
    record.inputBefore?.digest !== fingerprint.digest ||
    record.inputAfter?.digest !== fingerprint.digest ||
    !same(record.identity, identity) ||
    resolve(record.workingDirectory ?? "/") !== resolve(cwd) ||
    !same(record.environment, fingerprint.env) ||
    !same(record.toolchain, fingerprint.runtime) ||
    !Array.isArray(record.command) ||
    commandText(record.command) !== command ||
    !/^[\w.-]+$/.test(record.id ?? "") ||
    record.logPath !== `.agent/runs/${record.id}.log` ||
    !/^sha256:[a-f0-9]{64}$/.test(record.logHash ?? "")
  )
    reject(
      "Required command has stale, foreign, incomplete or failed evidence: " +
        command,
      "STALE_FINAL_RUN",
    );
  const log = regularFile(join(cwd, record.logPath));
  if ("sha256:" + sha256Text(log) !== record.logHash)
    reject("Required command log changed: " + command, "INVALID_FINAL_LOG");
  let stored;
  try {
    stored = JSON.parse(
      regularFile(join(cwd, ".agent/runs", record.id + ".json")),
    );
  } catch {
    reject(
      "Required command record is missing or malformed.",
      "INVALID_FINAL_RECORD",
    );
  }
  if (!same(record, stored))
    reject(
      "Mission summary and original command record disagree.",
      "INVALID_FINAL_RECORD",
    );
  return record;
};

const reusableRecord = ({ records, command, fingerprint, cwd, identity }) => {
  try {
    return requireRecord({ records, command, fingerprint, cwd, identity });
  } catch {
    return null;
  }
};
export const validateRecordedRuns = ({
  cwd = process.cwd(),
  state = readMissionState(cwd),
  fingerprint = collectInputFingerprint({ cwd }),
  commands = REQUIRED_FINAL_COMMANDS,
} = {}) => {
  const identity = validationIdentity(cwd, state);
  return commands.map((command) =>
    requireRecord({
      records: state.runs ?? [],
      command,
      fingerprint,
      cwd,
      identity,
    }),
  );
};
const lazyExternalValidation = async (cwd) => {
  const security = await import("../security/check.mjs");
  const artifact = await import("../security/artifact.mjs");
  await security.validateSecurityEvidence({ cwd, now: new Date() });
  await artifact.verifyArtifact({
    cwd,
    basePath: "/Wanderer/",
    requireBrowser: true,
  });
};
const frozenCandidate = (cwd, state) => {
  const identity = validationIdentity(cwd, state);
  if (readWorktreeState(cwd).trackedState !== "clean")
    reject(
      "Finish requires a frozen committed candidate with no tracked changes.",
      "UNFROZEN_CANDIDATE",
    );
  const fingerprint = collectInputFingerprint({ cwd });
  if (fingerprint.untracked.length)
    reject(
      "Finish requires every relevant source/configuration/document input to be committed.",
      "UNTRACKED_FINAL_INPUT",
    );
  if (!same(state.compatibilityFixtureHashes, collectFixtureHashes(cwd)))
    reject(
      "Compatibility fixture hashes changed after mission start.",
      "FIXTURE_DRIFT",
    );
  return { identity, fingerprint };
};

// Dependency injection is for in-process tests; the CLI never accepts command,
// runner, doctor or validator overrides. The supported completion route is fixed.
export const finishMission = async ({
  cwd = process.cwd(),
  checkOnly = false,
  doctor = inspectDoctor,
  runner = runCommand,
  commands = REQUIRED_FINAL_COMMANDS,
  externalValidation = lazyExternalValidation,
  fullMatrix = false,
} = {}) => {
  const state = readMissionState(cwd);
  const before = frozenCandidate(cwd, state);
  const prerequisite = await doctor({ cwd });
  if (prerequisite.status !== "ready")
    reject(prerequisite.nextAction, "DOCTOR_BLOCKED");
  const requiredCommands =
    commands === REQUIRED_FINAL_COMMANDS && fullMatrix
      ? REQUIRED_FULL_MATRIX_COMMANDS
      : commands;
  const reusedRunIds = [];
  const executedRunIds = [];
  let browserMustRun = false;
  for (const command of requiredCommands) {
    const mustRun =
      !checkOnly &&
      (command === "npm run security:check" ||
        command ===
          "node scripts/security/artifact.mjs verify --base /Wanderer/" ||
        (command.startsWith("npm run test:browser") && browserMustRun));
    const record = mustRun
      ? null
      : reusableRecord({
          records: readMissionState(cwd).runs ?? [],
          command,
          fingerprint: before.fingerprint,
          cwd,
          identity: before.identity,
        });
    if (record) {
      reusedRunIds.push(record.id);
      continue;
    }
    if (checkOnly)
      requireRecord({
        records: readMissionState(cwd).runs ?? [],
        command,
        fingerprint: before.fingerprint,
        cwd,
        identity: before.identity,
      });
    else {
      const executed = await runner({
        cwd,
        command: command.split(" "),
        timeoutMs: timeoutFor(command),
      });
      if (executed.status !== "passed")
        reject(
          "Required final command did not pass: " + command,
          "FINAL_COMMAND_FAILED",
        );
      executedRunIds.push(executed.id);
      if (command === "npm run verify") browserMustRun = true;
    }
  }
  const after = frozenCandidate(cwd, readMissionState(cwd));
  if (
    before.fingerprint.digest !== after.fingerprint.digest ||
    !same(before.identity, after.identity)
  )
    reject("Candidate changed during final validation.", "FINAL_INPUT_DRIFT");
  const runs = validateRecordedRuns({
    cwd,
    fingerprint: after.fingerprint,
    commands: requiredCommands,
  });
  await externalValidation(cwd);
  if (collectInputFingerprint({ cwd }).digest !== after.fingerprint.digest)
    reject(
      "Inputs changed during completion evidence checks.",
      "FINAL_INPUT_DRIFT",
    );
  const result = {
    schemaVersion: AGENT_EVIDENCE_SCHEMA_VERSION,
    status: "LOCAL_PASS_REMOTE_NOT_VERIFIED",
    ...after.identity,
    head: after.fingerprint.head,
    tree: after.fingerprint.tree,
    fingerprint: after.fingerprint.digest,
    fixtures: collectFixtureHashes(cwd),
    runIds: runs.map((run) => run.id),
    verification: {
      browserScope: fullMatrix
        ? "full-two-path-matrix"
        : "primary-plus-pages-smoke",
      executedRunIds,
      reusedRunIds,
    },
    scopes: {
      local: "passed",
      remoteCi: "not-verified",
      settings: "not-verified",
      deployment: "not-performed",
    },
  };
  const directory = ensureAgentDirectory(cwd, "completions");
  const stem = after.fingerprint.digest.slice(7);
  const path = join(directory, stem + ".json");
  const markdownPath = join(directory, stem + ".md");
  assertNoSymlinkAncestors(path);
  assertNoSymlinkAncestors(markdownPath);
  writeJsonAtomic(path, result);
  writeFileSync(
    markdownPath,
    `# Local completion\n\n- Mission: ${result.missionId}\n- Candidate: ${result.head}\n- Source fingerprint: ${result.fingerprint}\n- Local required gate: passed\n- Remote CI/settings: not verified\n- Deployment: not performed\n\n## Required validation records\n\n${runs.map((run) => `- ${run.commandText}: exit ${run.exitCode}; ${run.durationMs} ms; ${run.logPath}`).join("\n")}\n\n## Verification scope\n\n- Browser: ${result.verification.browserScope}\n- Executed in this finish: ${result.verification.executedRunIds.join(", ") || "none"}\n- Reused current-candidate records: ${result.verification.reusedRunIds.join(", ") || "none"}\n\nThis repository-local record is drift detection, not an independent trust authority. Protected owner review remains necessary.\n`,
    { mode: 0o600 },
  );
  return { ...result, evidencePaths: [path, markdownPath] };
};
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  Promise.resolve()
    .then(() => {
      const args = process.argv.slice(2);
      const known = new Set(["--check-only", "--full-matrix"]);
      if (
        args.length > 2 ||
        new Set(args).size !== args.length ||
        args.some((argument) => !known.has(argument))
      )
        reject(
          "Usage: agent:finish [--check-only] [--full-matrix]",
          "INVALID_ARGUMENT",
        );
      return finishMission({
        checkOnly: args.includes("--check-only"),
        fullMatrix: args.includes("--full-matrix"),
      });
    })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
