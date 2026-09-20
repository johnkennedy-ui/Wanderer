import { commandText } from "./common.mjs";
import { buildImpactMap, classifyImpactPath } from "./impact-map.mjs";

export const classifyChangedPath = (path) => {
  return classifyImpactPath(path)[0];
};

export const isFormattingEligiblePath = (path) => {
  const normalized = path.replace(/\\/g, "/");
  if (/^src\/.*\.(?:ts|mjs|css)$/.test(normalized)) return true;
  if (/^scripts\/.*\.(?:mjs|json)$/.test(normalized)) return true;
  if (/^\.github\/.*\.(?:yml|yaml)$/.test(normalized)) return true;
  if (/^Documentation~\/.*\.md$/.test(normalized)) return true;
  if (/^(?:package-lock\.json|npm-shrinkwrap\.json)$/.test(normalized))
    return false;
  return !normalized.includes("/") && /\.(?:ts|json|md|html)$/.test(normalized);
};

const command = (id, reason, commandLine, timeoutMs) => ({
  id,
  reasons: [reason],
  command: commandLine,
  timeoutMs,
});

const browserCheckTimeoutMs = 1_800_000;

const mergeCommand = (commands, next) => {
  const existing = commands.get(next.id);
  if (existing) {
    if (!existing.reasons.includes(next.reasons[0]))
      existing.reasons.push(next.reasons[0]);
    return;
  }
  commands.set(next.id, next);
};

const addTypecheckAndArchitecture = (commands, reason) => {
  mergeCommand(
    commands,
    command("typecheck", reason, ["npm", "run", "typecheck"], 180_000),
  );
  mergeCommand(
    commands,
    command(
      "architecture",
      reason,
      ["npm", "run", "check:architecture"],
      180_000,
    ),
  );
};

export const selectFocusedChecks = (
  changedFiles,
  {
    baselineCommit = "HEAD",
    full = false,
    formatMode = "check",
    nodePath = process.execPath,
  } = {},
) => {
  const impactMap = buildImpactMap(changedFiles);
  const classifications = impactMap.map((entry) => ({
    path: entry.path,
    category: entry.impacts[0],
    impacts: entry.impacts,
    status: entry.status,
  }));
  const categories = new Set(impactMap.flatMap((entry) => entry.impacts));
  const forcedFull =
    full || categories.has("full") || categories.has("unknown");
  const commands = new Map();
  const changedEligibleFiles = impactMap
    .map((entry) => entry.path)
    .filter(isFormattingEligiblePath);
  const formatAction = formatMode === "write" ? "--write" : "--check";

  mergeCommand(
    commands,
    command(
      "git-diff-check",
      "all changed files require whitespace validation",
      ["git", "diff", "--check", baselineCommit],
      60_000,
    ),
  );

  if (forcedFull) {
    if (formatMode === "write" && changedEligibleFiles.length > 0)
      mergeCommand(
        commands,
        command(
          "format-changed",
          "--format is restricted to changed eligible tracked files",
          [
            nodePath,
            "scripts/agent/format.mjs",
            formatAction,
            "--files",
            ...changedEligibleFiles,
          ],
          180_000,
        ),
      );
    mergeCommand(
      commands,
      command(
        "verify",
        "full mode was requested or forced by configuration",
        ["npm", "run", "verify"],
        600_000,
      ),
    );
    mergeCommand(
      commands,
      command(
        "browser",
        "full mode includes the built-output browser matrix",
        ["npm", "run", "test:browser"],
        browserCheckTimeoutMs,
      ),
    );
    return {
      mode: "full",
      changedFiles,
      classifications,
      commands: [...commands.values()],
      commandTexts: [...commands.values()].map((entry) =>
        commandText(entry.command),
      ),
    };
  }

  if (changedEligibleFiles.length > 0)
    mergeCommand(
      commands,
      command(
        "format-changed",
        "formatting is limited to changed eligible tracked files",
        [
          nodePath,
          "scripts/agent/format.mjs",
          formatAction,
          "--files",
          ...changedEligibleFiles,
        ],
        180_000,
      ),
    );

  const changedTests = impactMap
    .filter((entry) => entry.executableTest)
    .map((entry) => entry.path);
  if (changedTests.length > 0)
    mergeCommand(
      commands,
      command(
        "changed-tests",
        "changed tests must execute themselves or a proven present-file superset",
        ["npm", "run", "test", "--", ...changedTests],
        240_000,
      ),
    );

  if (impactMap.some((entry) => entry.deletedTest))
    mergeCommand(
      commands,
      command(
        "deleted-test-owner-suite",
        "deleted tests require their current owning suite and coverage review",
        ["npm", "run", "test", "--", "src/tests"],
        240_000,
      ),
    );

  if (categories.has("save")) {
    mergeCommand(
      commands,
      command(
        "save-tests",
        "save, persistence, or storage changed",
        ["npm", "run", "test", "--", "src/tests/domain/save.test.ts"],
        180_000,
      ),
    );
    addTypecheckAndArchitecture(commands, "save boundary changed");
  }

  if (categories.has("world")) {
    mergeCommand(
      commands,
      command(
        "world-tests",
        "world or generator changed",
        ["npm", "run", "test", "--", "src/tests/domain/world.test.ts"],
        180_000,
      ),
    );
    addTypecheckAndArchitecture(commands, "world/generator boundary changed");
  }

  if (categories.has("session")) {
    mergeCommand(
      commands,
      command(
        "session-tests",
        "session, economy, settlement, combat, or progression changed",
        ["npm", "run", "test", "--", "src/tests/domain/session-"],
        240_000,
      ),
    );
    addTypecheckAndArchitecture(commands, "session boundary changed");
  }

  if (categories.has("input")) {
    mergeCommand(
      commands,
      command(
        "input-tests",
        "input changed",
        ["npm", "run", "test", "--", "src/tests/domain/tapToMoveInput.test.ts"],
        180_000,
      ),
    );
    addTypecheckAndArchitecture(commands, "input boundary changed");
  }

  if (categories.has("presentation")) {
    addTypecheckAndArchitecture(
      commands,
      "UI, renderer, app, or lifecycle changed",
    );
    mergeCommand(
      commands,
      command(
        "build",
        "presentation changes require a production build",
        ["npm", "run", "build"],
        300_000,
      ),
    );
    mergeCommand(
      commands,
      command(
        "browser",
        "presentation changes require built-output browser checks",
        ["npm", "run", "test:browser"],
        browserCheckTimeoutMs,
      ),
    );
  }

  if (categories.has("architecture")) {
    mergeCommand(
      commands,
      command(
        "architecture-tests",
        "architecture guard changed",
        ["npm", "run", "test", "--", "src/tests/architecture-guard.test.ts"],
        180_000,
      ),
    );
    addTypecheckAndArchitecture(commands, "architecture guard changed");
  }

  if (categories.has("agent")) {
    mergeCommand(
      commands,
      command(
        "agent-tests",
        "agent tooling changed",
        ["npm", "run", "test", "--", "src/tests/agent"],
        180_000,
      ),
    );
    addTypecheckAndArchitecture(commands, "agent tooling changed");
  }

  return {
    mode: "focused",
    changedFiles,
    classifications,
    commands: [...commands.values()],
    commandTexts: [...commands.values()].map((entry) =>
      commandText(entry.command),
    ),
  };
};
