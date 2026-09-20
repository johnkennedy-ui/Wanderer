import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyArtifact, markBrowserVerified } from "../security/artifact.mjs";

export const runBrowserMatrix = ({
  cwd = process.cwd(),
  argv = [],
  environment = process.env,
  run = spawnSync,
  verify = verifyArtifact,
  mark = markBrowserVerified,
} = {}) => {
  if (
    argv.length > 1 ||
    (argv.length === 1 && argv[0] !== "--reuse-root-build")
  )
    throw new Error("Usage: browser-test.mjs [--reuse-root-build]");
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
  for (const basePath of ["/", "/Wanderer/"]) {
    if (basePath !== "/" || argv.length === 0) build(basePath);
    const before = verify({ cwd, basePath });
    execute(process.execPath, [playwright, "test"], basePath, 1_800_000);
    const after = verify({ cwd, basePath });
    if (before.manifest.contentSha256 !== after.manifest.contentSha256)
      throw new Error("Browser-tested artifact changed");
    mark({ cwd, basePath });
  }
  return verify({ cwd, basePath: "/Wanderer/", requireBrowser: true });
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
