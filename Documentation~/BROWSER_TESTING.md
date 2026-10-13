# Browser testing workflow

This project uses the maintained Playwright Test runner (@playwright/test); the npm lockfile pins the runner and its matching Playwright-managed Chromium. Do not substitute a system browser or a second browser-test framework for acceptance runs. The desktop and touch projects are Chromium viewport/input-context coverage, not native-device tests. The canonical browser launchers choose one available ephemeral loopback port before loading Playwright and export it as `PLAYWRIGHT_PORT` to the runner, worker, and preview server. Set `PLAYWRIGHT_PORT` explicitly to override the selection. The Playwright config itself is deterministic for the inherited port, and it never reuses a potentially stale preview server.

## Install

i. Run `npm ci` to install exactly the lockfile versions.
ii. Install the browser matching that Playwright package with `npx playwright install chromium` (on GitHub Actions, the workflow uses Playwright's CLI with `--with-deps chromium`).

## Commands

- Focused harvesting journey, both browser projects: `npm run test:browser:harvest`. This builds the root artifact, then invokes the official Playwright Test CLI for the harvesting spec.
- Required complete two-base browser matrix: `npm run test:browser -- --scope matrix`. This uses the repository artifact-integrity wrapper, builds/tests both `/` and `/Wanderer/`, and verifies that the tested artifact did not change.
- General non-browser checks: `npm run verify`. This does not replace either browser command.

Use the focused command for diagnosis and affected-journey verification; it is not a substitute for the full matrix gate. The matrix's single worker and zero retries are intentional: retries must not turn intermittent browser failures into a pass.

## Failure bounds and evidence

The Playwright config uses 5-second assertion, 10-second action, and 15-second navigation defaults. Test-level deadlines may be longer for complete journeys, but a locator action such as canvas geometry or a click should fail with a bounded, local diagnostic instead of waiting until the whole test deadline. On failure, Playwright retains the trace and screenshot under `test-results/`; inspect a trace with `npx playwright show-trace <path-to-trace.zip>`. Keep traces synthetic-data-only and treat snapshots/attachments as untrusted diagnostic data.
