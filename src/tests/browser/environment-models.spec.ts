import { expect, test } from "@playwright/test";
import {
  applicationPath,
  attachStableModelScreenshot,
  captureBrowserFaults,
  expectModelsReady,
  primeModelWorld,
} from "./model-pack-helpers";

test("environment clones load through the existing model cache at the deployment base", async ({ page }, testInfo) => {
  const faults = captureBrowserFaults(page);
  await primeModelWorld(page, "knight");
  await page.goto(applicationPath, { waitUntil: "commit" });
  await expectModelsReady(page);
  const canvas = page.getByTestId("world-canvas");
  await expect(canvas).toHaveAttribute("data-environment-pending-count", "0");
  await expect(canvas).toHaveAttribute("data-environment-loaded-count", /[1-9]\d*/);
  await expect(canvas).toHaveAttribute("data-environment-fallback-count", "0");
  await expect(canvas).toHaveAttribute("data-environment-asset-keys", /environment-rock-/);
  await attachStableModelScreenshot(page, testInfo, "environment-normal-zoom");
  expect(faults).toEqual([]);
});

test("missing environment models retain obstacle fallback without retry loops or input interception", async ({ page }) => {
  const faults = captureBrowserFaults(page);
  const missing = new Set<string>();
  let requests = 0;
  await page.route("**/assets/models/expansion-v1/rock_*.glb", async (route) => {
    missing.add(route.request().url());
    requests += 1;
    await route.fulfill({ status: 404, contentType: "text/plain", body: "missing environment fixture" });
  });
  await primeModelWorld(page, "knight");
  await page.goto(applicationPath, { waitUntil: "commit" });
  const canvas = page.getByTestId("world-canvas");
  await expect(canvas).toHaveAttribute("data-environment-pending-count", "0");
  await expect(canvas).toHaveAttribute("data-environment-fallback-count", /[1-9]\d*/);
  const count = requests;
  expect(count).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  expect(requests).toBe(count);
  await page.getByTestId("character-status-toggle").click();
  const position = page.getByTestId("position");
  await expect(position).toContainText("Position: 0.0, 0.0");
  await page.keyboard.down("d");
  try { await expect(position).not.toContainText("Position: 0.0, 0.0"); }
  finally { await page.keyboard.up("d"); }
  for (const fault of faults) {
    expect([...missing].some((url) => fault.startsWith(`console: ${url} `))).toBe(true);
    expect(fault).toMatch(/Failed to load resource:.*\b404\b/i);
  }
});
