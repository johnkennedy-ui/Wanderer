import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AGENT_POLICY_VERSION,
  AgentError,
  collectInputFingerprint,
  parseNodeMajor,
  readMissionState,
  runtimeIdentity,
  SUPPORTED_NODE_MAJOR,
  readWorktreeState,
  validationIdentity,
  readRegularFile,
} from "./common.mjs";
const check = (id, passed, detail) => ({
  id,
  status: passed ? "passed" : "blocked",
  detail,
});
export const inspectDoctor = async ({
  cwd = process.cwd(),
  fingerprint = collectInputFingerprint,
  probeBrowser = async () => {
    try {
      const { chromium } = await import("@playwright/test");
      const browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      });
      await browser.close();
      return {
        available: true,
        detail: "Configured Chromium and libraries launch successfully.",
      };
    } catch {
      return {
        available: false,
        detail:
          "Configured Chromium could not launch; inspect the locked Playwright install and host libraries (environment failure, not a code-test verdict).",
      };
    }
  },
} = {}) => {
  const state = readMissionState(cwd);
  const runtime = runtimeIdentity(cwd);
  const pinned = existsSync(join(cwd, ".nvmrc"))
    ? readRegularFile(join(cwd, ".nvmrc"), "utf8").trim().replace(/^v/, "")
    : null;
  const checks = [
    check(
      "node",
      parseNodeMajor(runtime.nodeVersion) === SUPPORTED_NODE_MAJOR &&
        (!pinned || runtime.nodeVersion === "v" + pinned),
      "Observed " +
        runtime.nodeVersion +
        "; use the repository .nvmrc Node " +
        SUPPORTED_NODE_MAJOR +
        " toolchain.",
    ),
    check(
      "npm",
      /^10\./.test(runtime.npmVersion),
      "Observed npm " + runtime.npmVersion + "; npm 10.x is required.",
    ),
    check(
      "mission-policy",
      state.schemaVersion === 2 && state.policyVersion === AGENT_POLICY_VERSION,
      "Mission record must use policy " +
        AGENT_POLICY_VERSION +
        "; upgrade historical metadata, never discard it.",
    ),
    check(
      "fixture-baseline",
      Boolean(state.compatibilityFixtureHashes?.saves) &&
        Boolean(state.compatibilityFixtureHashes?.world),
      "Historical fixture baselines must exist.",
    ),
    check(
      "frozen-candidate",
      readWorktreeState(cwd).trackedState === "clean",
      "Commit reviewed source changes before final completion; focused iteration remains available.",
    ),
  ];
  try {
    validationIdentity(cwd, state);
    checks.push(
      check(
        "identity",
        true,
        "Mission, repository and baseline ancestry match.",
      ),
    );
  } catch (error) {
    checks.push(check("identity", false, error.message));
  }
  let current;
  try {
    current = fingerprint({ cwd });
    checks.push(
      check(
        "inputs",
        current.untracked.length === 0,
        current.untracked.length
          ? "Relevant untracked inputs must be reviewed and committed before finish."
          : "Tracked, installed and ignored inputs have admissible identities.",
      ),
    );
  } catch (error) {
    checks.push(check("inputs", false, error.message));
  }
  try {
    if (
      !existsSync(join(cwd, "node_modules/.package-lock.json")) ||
      !runtime.lockfileHash
    )
      throw new Error("Missing locked install");
    execFileSync("npm", ["ls", "--all", "--json"], {
      cwd,
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    checks.push(
      check(
        "locked-dependencies",
        true,
        "Installed dependency tree passes npm ls against the current package requirements; finish still binds its actual bytes.",
      ),
    );
  } catch {
    checks.push(
      check(
        "locked-dependencies",
        false,
        "Missing, invalid or extraneous locked dependencies: run npm ci with the supported toolchain.",
      ),
    );
  }
  try {
    execFileSync("python3", ["--version"], {
      cwd,
      timeout: 5_000,
      stdio: "pipe",
    });
    checks.push(
      check(
        "scanner-bootstrap",
        process.platform === "linux" && process.arch === "x64",
        "Pinned scanner bundles currently support Linux x64 with Python 3 safe archive extraction.",
      ),
    );
  } catch {
    checks.push(
      check(
        "scanner-bootstrap",
        false,
        "Python 3 is required for verified local scanner archive extraction; no global installation is performed by doctor.",
      ),
    );
  }
  const browser = await probeBrowser();
  checks.push(check("browser", browser.available, browser.detail));
  const runs = state.runs ?? [];
  const currentRuns = runs.filter(
    (run) =>
      run.status === "passed" && run.inputAfter?.digest === current?.digest,
  );
  checks.push({
    id: "validation-evidence",
    status: "information",
    detail: `${currentRuns.length} current passing records; ${runs.length - currentRuns.length} historical, incomplete or stale records. This count is not completion; finish checks each mandatory command.`,
  });
  const blocked = checks.filter((entry) => entry.status === "blocked");
  return {
    schemaVersion: 2,
    status: blocked.length ? "blocked" : "ready",
    runtime,
    checks,
    nextAction:
      blocked[0]?.detail ??
      "Run agent:finish for fresh mandatory validation; readiness is not PASS.",
  };
};
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  inspectDoctor()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.status === "ready" ? 0 : 1;
    })
    .catch((error) => {
      console.error(
        error instanceof AgentError
          ? error.message
          : "Doctor failed; inspect local prerequisites.",
      );
      process.exitCode = 1;
    });
}
