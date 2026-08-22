import { existsSync } from "node:fs";

import {
  AgentError,
  REQUIRED_BASELINE,
  SUPPORTED_NODE_MAJOR,
  collectFixtureHashes,
  gitOutput,
  gitSucceeds,
  npmVersion,
  parseNodeMajor,
  readWorktreeState,
  missionStatePath,
  writeMissionState,
} from "./common.mjs";

const parseArguments = (argv) => {
  const options = {
    baselineCommit: null,
    missionId: null,
    requestedObjective: null,
    replace: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--mission") options.missionId = argv[++index] ?? null;
    else if (argument === "--objective")
      options.requestedObjective = argv[++index] ?? null;
    else if (argument === "--baseline")
      options.baselineCommit = argv[++index] ?? null;
    else if (argument === "--replace") options.replace = true;
    else
      throw new AgentError(`Unknown argument: ${argument}`, "INVALID_ARGUMENT");
  }
  return options;
};

export const evaluateMissionStart = ({
  missionId,
  requestedObjective,
  branch,
  baselineCommit,
  currentCommit,
  baselineIsDescendant,
  nodeVersion,
  npmVersion: installedNpmVersion,
  worktree,
  fixtureHashes,
  startedAt = new Date().toISOString(),
}) => {
  if (!missionId?.trim())
    throw new AgentError("--mission is required.", "MISSING_MISSION_ID");
  if (!requestedObjective?.trim())
    throw new AgentError("--objective is required.", "MISSING_OBJECTIVE");
  if (branch === "main")
    throw new AgentError(
      "agent:mission-start requires a feature branch, not main.",
      "MAIN_BRANCH_REJECTED",
    );
  if (!branch)
    throw new AgentError(
      "agent:mission-start requires a named feature branch.",
      "DETACHED_HEAD_REJECTED",
    );
  if (!baselineIsDescendant)
    throw new AgentError(
      `Baseline ${baselineCommit} is not a descendant of required hardening base ${REQUIRED_BASELINE}.`,
      "BASELINE_REJECTED",
    );
  if (parseNodeMajor(nodeVersion) !== SUPPORTED_NODE_MAJOR)
    throw new AgentError(
      `Unsupported Node version ${nodeVersion}; this repository requires Node ${SUPPORTED_NODE_MAJOR}.`,
      "NODE_VERSION_REJECTED",
    );
  if (worktree.trackedChanges.length > 0)
    throw new AgentError(
      `Mission start rejected because tracked changes are present: ${worktree.trackedChanges.join(", ")}`,
      "TRACKED_CHANGES_REJECTED",
    );

  return {
    schemaVersion: 1,
    missionId: missionId.trim(),
    requestedObjective: requestedObjective.trim(),
    branch,
    baselineCommit,
    currentCommit,
    runtime: { nodeVersion, npmVersion: installedNpmVersion },
    worktree,
    startedAt,
    compatibilityFixtureHashes: fixtureHashes,
    phase: "started",
    lastSuccessfulCheck: null,
    lastFailureSignature: null,
    repeatedFailureCount: 0,
    lastFailureCommand: null,
    lastFailureDiagnosis: null,
    runs: [],
    warnings: [],
  };
};

export const collectMissionStartFacts = ({
  cwd = process.cwd(),
  baselineCommit = null,
} = {}) => {
  const currentCommit = gitOutput(cwd, ["rev-parse", "HEAD"]).trim();
  const baseline = baselineCommit ?? currentCommit;
  return {
    branch: gitOutput(cwd, ["branch", "--show-current"]).trim(),
    baselineCommit: baseline,
    currentCommit,
    baselineIsDescendant: gitSucceeds(cwd, [
      "merge-base",
      "--is-ancestor",
      REQUIRED_BASELINE,
      baseline,
    ]),
    nodeVersion: process.version,
    npmVersion: npmVersion(cwd),
    worktree: readWorktreeState(cwd),
    fixtureHashes: collectFixtureHashes(cwd),
  };
};

export const startMission = ({ cwd = process.cwd(), ...options }) => {
  if (existsSync(missionStatePath(cwd)) && !options.replace)
    throw new AgentError(
      "A mission state already exists. Use --replace only after preserving its evidence.",
      "MISSION_STATE_EXISTS",
    );
  const facts = collectMissionStartFacts({
    cwd,
    baselineCommit: options.baselineCommit,
  });
  const state = evaluateMissionStart({ ...options, ...facts });
  writeMissionState(cwd, state);
  return state;
};

const main = () => {
  const options = parseArguments(process.argv.slice(2));
  const state = startMission(options);
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
