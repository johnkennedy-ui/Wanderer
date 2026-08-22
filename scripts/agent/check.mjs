import {
  AgentError,
  changedFilesSince,
  readMissionState,
  writeMissionState,
} from "./common.mjs";
import { runCommand } from "./run.mjs";
import { selectFocusedChecks } from "./checks.mjs";

const parseArguments = (argv) => {
  const options = { full: false, formatMode: "check" };
  for (const argument of argv) {
    if (argument === "--full") options.full = true;
    else if (argument === "--format") options.formatMode = "write";
    else
      throw new AgentError(`Unknown argument: ${argument}`, "INVALID_ARGUMENT");
  }
  return options;
};

export const runSelectedChecks = async ({
  cwd = process.cwd(),
  full = false,
  formatMode = "check",
} = {}) => {
  const initialState = readMissionState(cwd);
  const changedFiles = changedFilesSince(cwd, initialState.baselineCommit);
  const selection = selectFocusedChecks(changedFiles, {
    baselineCommit: initialState.baselineCommit,
    full,
    formatMode,
  });
  writeMissionState(cwd, { ...initialState, phase: "checking" });

  const results = [];
  for (const selected of selection.commands) {
    const result = await runCommand({
      cwd,
      command: selected.command,
      timeoutMs: selected.timeoutMs,
    });
    results.push({ id: selected.id, status: result.status, runId: result.id });
    if (result.status !== "passed") {
      const state = readMissionState(cwd);
      writeMissionState(cwd, { ...state, phase: "checks-failed" });
      return { ...selection, results, passed: false };
    }
  }

  const state = readMissionState(cwd);
  writeMissionState(cwd, { ...state, phase: "checks-passed" });
  return { ...selection, results, passed: true };
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const result = await runSelectedChecks(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.passed ? 0 : 1;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
