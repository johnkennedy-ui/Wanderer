import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { choosePlaywrightPort } from "./playwright-port.mjs";

const cwd = process.cwd();
const playwright = join(cwd, "node_modules/playwright/cli.js");
const port = await choosePlaywrightPort();
const result = spawnSync(
  process.execPath,
  [playwright, ...process.argv.slice(2)],
  {
    cwd,
    stdio: "inherit",
    env: { ...process.env, PLAYWRIGHT_PORT: String(port) },
  },
);
if (result.error) throw result.error;
if (result.signal) throw new Error(`Playwright exited with ${result.signal}`);
process.exitCode = result.status ?? 1;
