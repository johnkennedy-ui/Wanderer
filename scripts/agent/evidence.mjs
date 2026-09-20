import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AgentError,
  collectFixtureHashes,
  collectInputFingerprint,
  changedFilesSince,
  gitOutput,
  readMissionState,
  readWorktreeState,
  resolveWithinRepository,
  sha256Text,
} from "./common.mjs";
import { impactSummary } from "./impact-map.mjs";

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

export const impactStatements = (changedFiles) => {
  const impacts = impactSummary(changedFiles).impacts;
  return {
    save: impacts.includes("save")
      ? "Save/persistence/storage paths changed; review supported historical/current schemas in SAVE_FORMAT.md and src/domain/persistence/decodeSave.ts, bound by the collected contract hashes, plus storage-key evidence."
      : "No classified save, persistence, or storage paths changed since the mission baseline.",
    generator: impacts.includes("world")
      ? "World/generator paths changed; review WORLD_GENERATION.md, Documentation~/TERRAIN_V3.md and the current src/domain/world/generatorTypes.ts contract hashes; do not assume a historical version list is still complete."
      : "No classified world or generator paths changed since the mission baseline.",
    ids: hasPath(
      changedFiles,
      /(?:definitions|catalogue|identifier|persistent|building)/i,
    )
      ? "Persistent-ID-adjacent paths changed; review append-only identifier compatibility evidence."
      : "No persistent-ID-adjacent paths changed since the mission baseline.",
    gameplay: hasPath(changedFiles, /^src\/(?:domain|app|platform|ui)\//)
      ? "Gameplay or presentation production paths changed; review default-gameplay compatibility evidence."
      : "No production gameplay, application, platform, or UI paths changed since the mission baseline.",
  };
};

const fixtureComparison = (baseline, current) => {
  const flatten = (value) =>
    Object.fromEntries(
      Object.values(value ?? {}).flatMap((group) => Object.entries(group)),
    );
  const expected = flatten(baseline);
  const actual = flatten(current);
  const missing = Object.keys(expected).filter((path) => !(path in actual));
  const unexpected = Object.keys(actual).filter((path) => !(path in expected));
  const changed = Object.keys(expected).filter(
    (path) => actual[path] && actual[path] !== expected[path],
  );
  return {
    matches: missing.length + unexpected.length + changed.length === 0,
    missing,
    unexpected,
    changed,
  };
};

export const collectEvidence = ({ cwd = process.cwd() } = {}) => {
  const state = readMissionState(cwd);
  const currentCommit = gitOutput(cwd, ["rev-parse", "HEAD"]).trim();
  const changedFiles = changedFilesSince(cwd, state.baselineCommit);
  const runs = state.runs ?? [];
  const currentFixtureHashes = collectFixtureHashes(cwd);
  const fixtures = fixtureComparison(
    state.compatibilityFixtureHashes,
    currentFixtureHashes,
  );
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
    currentCompatibilityFixtureHashes: currentFixtureHashes,
    compatibilityContractHashes: Object.fromEntries(
      [
        "SAVE_FORMAT.md",
        "WORLD_GENERATION.md",
        "Documentation~/TERRAIN_V3.md",
        "src/domain/persistence/decodeSave.ts",
        "src/domain/world/generatorTypes.ts",
      ].map((path) => [path, sha256Text(readFileSync(join(cwd, path)))]),
    ),
    fixtureComparison: fixtures,
    inputFingerprint: collectInputFingerprint({ cwd }),
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
            `| ${run.command.replace(/\\/g, "\\\\").replace(/\|/g, "\\|")} | ${run.status} | ${run.exitCode ?? ""} | ${run.timedOut ? "yes" : "no"} |`,
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
