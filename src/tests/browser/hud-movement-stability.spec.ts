import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { applicationPath, captureBrowserFaults } from "./model-pack-helpers";

test("movement keeps fixed HUD controls in the viewport without document overflow", async ({
  page,
}, testInfo) => {
  const faults = captureBrowserFaults(page);
  const response = await page.goto(applicationPath, { waitUntil: "commit" });
  expect(response).not.toBeNull();
  expect(response?.ok()).toBe(true);
  const servedAssets = await page.evaluate(() =>
    [...document.scripts].map((script) => script.src),
  );
  expect(servedAssets.some((src) => src.includes("/assets/"))).toBe(true);
  const canvas = page.getByTestId("world-canvas");
  const statusToggle = page.getByTestId("character-status-toggle");
  const resourcesToggle = page.getByTestId("resources-toggle");
  await expect(canvas).toBeVisible();
  await expect(statusToggle).toBeVisible();
  const initial = await statusToggle.boundingBox();
  if (initial === null) throw new Error("Missing status toggle bounds");

  const measure = async (phase: string) =>
    page.evaluate((currentPhase) => {
      const status = document.querySelector<HTMLElement>(
        '[data-testid="character-status-toggle"]',
      );
      const player = document.querySelector<HTMLElement>(
        '[data-testid="world-player-hp"]',
      );
      const statusBounds = status?.getBoundingClientRect();
      const playerBounds = player?.getBoundingClientRect();
      return {
        phase: currentPhase,
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        playerHidden: player?.hidden ?? true,
        playerBounds: playerBounds && {
          x: playerBounds.x,
          y: playerBounds.y,
          width: playerBounds.width,
          height: playerBounds.height,
        },
        statusBounds: statusBounds && {
          x: statusBounds.x,
          y: statusBounds.y,
          width: statusBounds.width,
          height: statusBounds.height,
        },
        offscreenEnemyBars: [
          ...document.querySelectorAll<HTMLElement>(
            '[data-testid="world-enemy-hp"]',
          ),
        ].filter((bar) => bar.hidden).length,
      };
    }, phase);
  const baseline = await measure("baseline");
  const measured = [baseline];
  for (const key of ["a", "d", "w", "s"]) {
    await page.keyboard.down(key);
    await page.waitForTimeout(750);
    await page.keyboard.up(key);
    await page.waitForTimeout(100);
    measured.push(await measure(`movement-${key}`));
  }
  const current = await statusToggle.boundingBox();
  if (current === null) throw new Error("Lost status toggle bounds");
  for (const frame of measured) {
    expect(frame.documentWidth).toBeLessThanOrEqual(frame.viewportWidth);
    expect(frame.documentHeight).toBeLessThanOrEqual(frame.viewportHeight);
    expect(frame.playerHidden).toBe(false);
  }
  expect(current.x).toBe(initial.x);
  expect(current.y).toBe(initial.y);
  expect(baseline.statusBounds).toEqual({
    x: initial.x,
    y: initial.y,
    width: initial.width,
    height: initial.height,
  });

  await resourcesToggle.click();
  await expect(page.getByTestId("resources-panel")).toBeVisible();
  await testInfo.attach("hud-movement-measurements", {
    body: JSON.stringify(measured),
    contentType: "application/json",
  });
  await writeFile(
    testInfo.outputPath("hud-movement-measurements.json"),
    JSON.stringify(
      { applicationPath, servedAssets, measured, faults },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: testInfo.outputPath("hud-movement-final.png"),
  });
  await testInfo.attach("hud-movement-final", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  expect(faults).toEqual([]);
});
