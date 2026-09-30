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
    scope = "development",
  } = {},
) => {
  if (!["development", "completion"].includes(scope))
    throw new Error("Check scope must be development or completion.");
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
  const documentationOnly =
    impactMap.length > 0 &&
    [...categories].every((category) => category === "documentation");
  const requiresFullBrowserMatrix = impactMap.some(
    (entry) => entry.requiresFullBrowserMatrix,
  );
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

  if (scope === "completion" && (!documentationOnly || full)) {
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
        "local completion retains the full inexpensive verification suite",
        ["npm", "run", "verify"],
        600_000,
      ),
    );
    mergeCommand(
      commands,
      command(
        requiresFullBrowserMatrix || forcedFull
          ? "browser-matrix"
          : "browser-release",
        requiresFullBrowserMatrix || forcedFull
          ? "cross-cutting deployment-path risk requires the retained full two-base browser matrix"
          : "completed executable changes receive the full primary suite plus the focused Pages smoke suite",
        requiresFullBrowserMatrix || forcedFull
          ? [
              "npm",
              "run",
              "test:browser",
              "--",
              "--reuse-root-build",
              "--scope",
              "matrix",
            ]
          : ["npm", "run", "test:browser", "--", "--reuse-root-build"],
        browserCheckTimeoutMs,
      ),
    );
    return {
      mode: requiresFullBrowserMatrix || forcedFull ? "full" : "completion",
      scope,
      changedFiles,
      classifications,
      browserCoverage:
        requiresFullBrowserMatrix || forcedFull
          ? "full-two-path-matrix"
          : "primary-plus-pages-smoke",
      commands: [...commands.values()],
      commandTexts: [...commands.values()].map((entry) =>
        commandText(entry.command),
      ),
    };
  }

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
        "development scope is broad for configuration or unknown changes, without a browser matrix",
        ["npm", "run", "verify"],
        600_000,
      ),
    );
    return {
      mode: "full",
      scope,
      changedFiles,
      classifications,
      browserCoverage: "none",
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
        "save-session-integration",
        "persistence changes require existing session integration coverage",
        ["npm", "run", "test", "--", "src/tests/domain/session-"],
        240_000,
      ),
    );
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
        "presentation-tests",
        "presentation changes use existing app, platform, and UI integration suites",
        [
          "npm",
          "run",
          "test",
          "--",
          "src/tests/app",
          "src/tests/platform",
          "src/tests/ui",
        ],
        240_000,
      ),
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
    scope,
    changedFiles,
    classifications,
    browserCoverage: "none",
    commands: [...commands.values()],
    commandTexts: [...commands.values()].map((entry) =>
      commandText(entry.command),
    ),
  };
};
