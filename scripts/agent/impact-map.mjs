import { existsSync } from "node:fs";

const normalise = (path) => path.replace(/\\/g, "/").replace(/^\.\//, "");

const fullPaths = [
  /^package\.json$/,
  /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/,
  /(?:^|\/)(?:vite|vitest|playwright|capacitor)\.config\.[cm]?[jt]s$/,
  /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/,
  /^\.github\//,
  /^(?:scripts\/agent|scripts\/security|scripts\/ci)\//,
  /^src\/tests\/agent\//,
  /^AGENTS\.md$/,
  /^TEST_MATRIX\.md$/,
  /^Documentation~\/(?:agent-workflow|CI_SECURITY_CONTRACT)\.md$/,
];

// A prefixed deployment can diverge from root serving only when the build,
// browser harness, URL/base-path plumbing, or published assets change. Keep
// this list intentionally small and conservative: it controls whether a local
// completed-change check requests the retained full two-base browser matrix.
const fullBrowserMatrixPaths = [
  /^package\.json$/,
  /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/,
  /(?:^|\/)(?:vite|playwright|capacitor)\.config\.[cm]?[jt]s$/,
  /^\.github\//,
  /^scripts\/agent\/(?:browser-test|browser-preview)\.mjs$/,
  /^scripts\/security\/artifact\.mjs$/,
  /^(?:index\.html|src\/main\.ts|public\/)/,
  /^src\/.*\.css$/i,
  /(?:^|\/)(?:asset|assets|routing|router|url)(?:\/|\.|$)/i,
];

const has = (path, expression) => expression.test(path);

export const classifyImpactPath = (inputPath) => {
  const path = normalise(inputPath);
  const lower = path.toLowerCase();
  if (fullPaths.some((expression) => has(path, expression)))
    return ["full", "harness"];
  if (/saveprojection\./.test(lower)) return ["save", "session"];
  if (
    path === "SAVE_FORMAT.md" ||
    /(?:^|\/)(?:save|persistence|storage)(?:\/|\.|$)/.test(lower)
  )
    return ["save"];
  if (
    path === "WORLD_GENERATION.md" ||
    /(?:^|\/)(?:world|generator|generation)(?:\/|\.|$)/.test(lower)
  )
    return ["world"];
  if (path.includes("architecture-guard") || path === "ARCHITECTURE.md")
    return ["architecture"];
  if (/(?:^|\/)(?:input|inputpolicy)(?:\/|\.|$)/.test(lower)) return ["input"];
  const impacts = [];
  if (
    /(?:^|\/)(?:gamesession|session)(?:\/|[.-]|$)/.test(lower) ||
    /(?:^|\/)(?:economy|settlement|combat|progression)(?:\/|\.|$)/.test(lower)
  )
    impacts.push("session");
  if (/(?:^|\/)(?:ui|rendering|renderer|app|lifecycle)(?:\/|\.|$)/.test(lower))
    impacts.push("presentation");
  if (impacts.length > 0) return impacts;
  if (/^(?:Documentation~\/|.*\.md$)/.test(path)) return ["documentation"];
  return ["unknown"];
};

export const normaliseChange = (change) => {
  if (typeof change === "string")
    return { status: "modified", path: normalise(change), previousPath: null };
  return {
    status: change.status ?? "modified",
    path: normalise(change.path),
    previousPath: change.previousPath ? normalise(change.previousPath) : null,
  };
};

export const buildImpactMap = (changes, { exists = existsSync } = {}) =>
  changes.map(normaliseChange).map((change) => {
    const impactPaths =
      change.status === "deleted" && change.previousPath
        ? [change.previousPath]
        : [change.path, change.previousPath].filter(Boolean);
    const impacts = [...new Set(impactPaths.flatMap(classifyImpactPath))];
    const isTest = /^src\/tests\/.*\.test\.ts$/.test(change.path);
    const deletedTest = change.status === "deleted" && isTest;
    return {
      ...change,
      impacts,
      requiresFullBrowserMatrix:
        impacts.includes("harness") ||
        impactPaths.some((path) =>
          fullBrowserMatrixPaths.some((expression) => has(path, expression)),
        ),
      isTest,
      deletedTest,
      executableTest: isTest && !deletedTest && exists(change.path),
      coverageWarning: deletedTest
        ? `Deleted test ${change.path} requires owning-suite coverage review.`
        : null,
    };
  });

export const impactSummary = (changes) => {
  const map = buildImpactMap(changes);
  return {
    map,
    impacts: [...new Set(map.flatMap((entry) => entry.impacts))],
    warnings: map.flatMap((entry) =>
      entry.coverageWarning ? [entry.coverageWarning] : [],
    ),
    requiresFullBrowserMatrix: map.some(
      (entry) => entry.requiresFullBrowserMatrix,
    ),
  };
};
