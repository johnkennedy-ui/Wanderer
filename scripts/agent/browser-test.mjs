import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyArtifact, markBrowserVerified } from "../security/artifact.mjs";

export const PAGES_SMOKE_GREP = [
  "environment clones load through the existing model cache at the deployment base",
  "model asset requests for .* base-path safe GLB responses",
  "initial browser load uses compact circular actions with accessible hidden panels",
  "visible campfire save commits and later unsaved movement rolls back on reload",
  "public keyboard play defeats the real boss, selects one upgrade, and never saves implicitly",
  "production meta CSP supports rendering/storage and blocks an injected inline script",
].join("|");

const supportedScopes = new Set([
  "primary",
  "pages-smoke",
  "release",
  "matrix",
]);

export const parseBrowserArguments = (argv) => {
  let reuseRootBuild = false;
  let scope = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--reuse-root-build") {
      if (reuseRootBuild)
        throw new Error(
          "Usage: browser-test.mjs [--reuse-root-build] [--scope <primary|pages-smoke|release|matrix>]",
        );
      reuseRootBuild = true;
      continue;
    }
    if (argument === "--scope") {
      const value = argv[index + 1];
      if (scope !== null || !value || value.startsWith("--"))
        throw new Error(
          "Usage: browser-test.mjs [--reuse-root-build] [--scope <primary|pages-smoke|release|matrix>]",
        );
      scope = value;
      index += 1;
      continue;
    }
    throw new Error(
      "Usage: browser-test.mjs [--reuse-root-build] [--scope <primary|pages-smoke|release|matrix>]",
    );
  }
  const resolvedScope = scope ?? (reuseRootBuild ? "release" : "matrix");
  if (!supportedScopes.has(resolvedScope))
    throw new Error(
      "Usage: browser-test.mjs [--reuse-root-build] [--scope <primary|pages-smoke|release|matrix>]",
    );
  return { reuseRootBuild, scope: resolvedScope };
};

const pathsForScope = (scope) => {
  if (scope === "primary") return ["/"];
  if (scope === "pages-smoke") return ["/Wanderer/"];
  return ["/", "/Wanderer/"];
};

export const runBrowserMatrix = ({
  cwd = process.cwd(),
  argv = [],
  environment = process.env,
  run = spawnSync,
  verify = verifyArtifact,
  mark = markBrowserVerified,
} = {}) => {
  const options = parseBrowserArguments(argv);
  const playwright = join(cwd, "node_modules/playwright/cli.js");
  if (!existsSync(playwright))
    throw new Error("Locked Playwright executable is missing; run npm ci");
  const execute = (command, args, basePath, timeout) => {
    const result = run(command, args, {
      cwd,
      stdio: "inherit",
      env: {
        ...environment,
        VITE_BASE_PATH: basePath,
        PLAYWRIGHT_BASE_PATH: basePath,
      },
      timeout,
    });
    if (result.error || result.signal || result.status !== 0)
      throw new Error(
        "Browser gate command failed or did not finish: " +
          command +
          " " +
          args.join(" "),
      );
  };
  const build = (basePath) => {
    // Keep the build and artifact recorder on the same Node executable as this
    // process. Calling `npm run build` can select a different PATH Node when
    // the gate itself was started with an absolute toolchain path, which makes
    // the recorded tool identity change before the browser verification.
    execute(
      process.execPath,
      ["node_modules/vite/bin/vite.js", "build"],
      basePath,
      300_000,
    );
    execute(
      process.execPath,
      ["scripts/security/artifact.mjs", "create"],
      basePath,
      300_000,
    );
  };
  for (const basePath of pathsForScope(options.scope)) {
    if (basePath !== "/" || !options.reuseRootBuild) build(basePath);
    const before = verify({ cwd, basePath });
    const usePagesSmoke =
      options.scope === "pages-smoke" ||
      (options.scope === "release" && basePath === "/Wanderer/");
    execute(
      process.execPath,
      [
        playwright,
        "test",
        ...(usePagesSmoke ? ["--grep", PAGES_SMOKE_GREP] : []),
      ],
      basePath,
      1_800_000,
    );
    const after = verify({ cwd, basePath });
    if (before.manifest.contentSha256 !== after.manifest.contentSha256)
      throw new Error("Browser-tested artifact changed");
    mark({ cwd, basePath });
  }
  const finalBasePath = pathsForScope(options.scope).at(-1);
  return verify({ cwd, basePath: finalBasePath, requireBrowser: true });
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    runBrowserMatrix({ argv: process.argv.slice(2) });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
