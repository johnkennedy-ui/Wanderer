import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  AgentError,
  changedFilesSince,
  gitOutput,
  readMissionState,
  readWorktreeState,
  resolveWithinRepository,
} from "./common.mjs";

const parseArguments = (argv) => {
  if (argv.length === 0) return { outputDirectory: ".agent/evidence" };
  if (argv.length === 2 && argv[0] === "--output-dir")
    return { outputDirectory: argv[1] };
  throw new AgentError(
    "Usage: agent:evidence [--output-dir path-inside-repository]",
    "INVALID_ARGUMENT",
  );
};

const hasPath = (paths, expression) =>
  paths.some((path) => expression.test(path));

export const impactStatements = (changedFiles) => ({
  save: hasPath(
    changedFiles,
    /(?:^|\/)(?:save|persistence|storage)(?:\/|\.|$)|^SAVE_FORMAT\.md$/i,
  )
    ? "Save/persistence/storage paths changed; review schema-v2 and storage-key compatibility evidence."
    : "No save, persistence, or storage paths changed since the mission baseline.",
  generator: hasPath(
    changedFiles,
    /(?:^|\/)(?:world|generator|generation)(?:\/|\.|$)/i,
  )
    ? "World/generator paths changed; review wanderer-web-v1 fixture compatibility evidence."
    : "No world or generator paths changed since the mission baseline.",
  ids: hasPath(
    changedFiles,
    /(?:definitions|catalogue|identifier|persistent|building)/i,
  )
    ? "Persistent-ID-adjacent paths changed; review append-only identifier compatibility evidence."
    : "No persistent-ID-adjacent paths changed since the mission baseline.",
  gameplay: hasPath(changedFiles, /^src\/(?:domain|app|platform|ui)\//)
    ? "Gameplay or presentation production paths changed; review default-gameplay compatibility evidence."
    : "No production gameplay, application, platform, or UI paths changed since the mission baseline.",
});

export const collectEvidence = ({ cwd = process.cwd() } = {}) => {
  const state = readMissionState(cwd);
  const currentCommit = gitOutput(cwd, ["rev-parse", "HEAD"]).trim();
  const changedFiles = changedFilesSince(cwd, state.baselineCommit);
  const runs = state.runs ?? [];
  const unresolvedWarnings = [
    ...(state.warnings ?? []),
    ...runs
      .filter((run) => run.status !== "passed")
      .map(
        (run) =>
          `${run.commandText}: ${run.status}${run.failureSignature ? ` (${run.failureSignature})` : ""}`,
      ),
  ];

  return {
    schemaVersion: 1,
    missionId: state.missionId,
    requestedObjective: state.requestedObjective,
    baselineCommit: state.baselineCommit,
    currentCommit,
    branch: gitOutput(cwd, ["branch", "--show-current"]).trim(),
    commitsInMission: gitOutput(cwd, [
      "log",
      "--format=%H %s",
      `${state.baselineCommit}..${currentCommit}`,
    ])
      .trim()
      .split("\n")
      .filter(Boolean),
    changedFiles,
    diffStat: gitOutput(cwd, ["diff", "--stat", state.baselineCommit]).trim(),
    validationCommands: runs.map((run) => ({
      id: run.id,
      command: run.commandText,
      status: run.status,
      exitCode: run.exitCode,
      signal: run.signal,
      timedOut: run.timedOut,
      failureSignature: run.failureSignature,
      completedAt: run.finishedAt,
    })),
    timeouts: runs.filter((run) => run.timedOut).map((run) => run.id),
    repeatedFailures: {
      signature: state.lastFailureSignature,
      count: state.repeatedFailureCount,
    },
    compatibilityFixtureHashes: state.compatibilityFixtureHashes,
    impact: impactStatements(changedFiles),
    unresolvedWarnings,
    trackedWorktree: readWorktreeState(cwd),
  };
};

const markdown = (evidence) => {
  const validationRows = evidence.validationCommands.length
    ? evidence.validationCommands
        .map(
          (run) =>
            `| ${run.command.replace(/\|/g, "\\|")} | ${run.status} | ${run.exitCode ?? ""} | ${run.timedOut ? "yes" : "no"} |`,
        )
        .join("\n")
    : "| No commands recorded | n/a | n/a | n/a |";
  const warnings = evidence.unresolvedWarnings.length
    ? evidence.unresolvedWarnings.map((warning) => `- ${warning}`).join("\n")
    : "- None";
  const changedFiles = evidence.changedFiles.length
    ? evidence.changedFiles.map((path) => `- ${path}`).join("\n")
    : "- None";

  return `# Agent mission evidence\n\n- Mission: ${evidence.missionId}\n- Objective: ${evidence.requestedObjective}\n- Branch: ${evidence.branch}\n- Baseline: ${evidence.baselineCommit}\n- Current: ${evidence.currentCommit}\n\n## Changed files\n\n${changedFiles}\n\n## Diff stat\n\n\`\`\`text\n${evidence.diffStat || "No tracked diff since baseline."}\n\n\`\`\`\n\n## Validation commands\n\n| Command | Status | Exit code | Timed out |\n| --- | --- | --- | --- |\n${validationRows}\n\n## Failure tracking\n\n- Repeated failure signature: ${evidence.repeatedFailures.signature ?? "none"}\n- Repeated failure count: ${evidence.repeatedFailures.count}\n- Timed-out run IDs: ${evidence.timeouts.length ? evidence.timeouts.join(", ") : "none"}\n\n## Compatibility impact\n\n- Save: ${evidence.impact.save}\n- Generator: ${evidence.impact.generator}\n- IDs: ${evidence.impact.ids}\n- Gameplay: ${evidence.impact.gameplay}\n\n## Warnings\n\n${warnings}\n\n## Worktree\n\n- Tracked state: ${evidence.trackedWorktree.trackedState}\n- Overall state: ${evidence.trackedWorktree.state}\n`;
};

export const writeEvidence = ({
  cwd = process.cwd(),
  outputDirectory = ".agent/evidence",
} = {}) => {
  const evidence = collectEvidence({ cwd });
  const directory = resolveWithinRepository(cwd, outputDirectory);
  mkdirSync(directory, { recursive: true });
  const jsonPath = join(directory, "mission-evidence.json");
  const markdownPath = join(directory, "mission-evidence.md");
  writeFileSync(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, markdown(evidence), "utf8");
  return { evidence, jsonPath, markdownPath };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = writeEvidence(parseArguments(process.argv.slice(2)));
    process.stdout.write(
      `${JSON.stringify({ jsonPath: result.jsonPath, markdownPath: result.markdownPath }, null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
