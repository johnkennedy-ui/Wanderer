import { expect, test } from "@playwright/test";
import {
  activeModelKeys,
  applicationPath,
  attachStableModelScreenshot,
  captureBrowserFaults,
  expectOnlyMissingModelFaults,
  expectModelsReady,
  primeModelWorld,
} from "./model-pack-helpers";

test.setTimeout(60_000);

for (const playerClass of ["knight", "wizard", "archer"] as const) {
  test(`model pack renders the chosen ${playerClass} while idle`, async ({
    page,
  }, testInfo) => {
    const faults = captureBrowserFaults(page);
    await primeModelWorld(page, playerClass);
    await page.goto(applicationPath, { waitUntil: "commit" });
    await expectModelsReady(page);
    await expect
      .poll(() => activeModelKeys(page))
      .toContain(`player-${playerClass}`);
    await expect(page.getByTestId("world-canvas")).toHaveAttribute(
      "data-projectile-count",
      "0",
    );
    await attachStableModelScreenshot(page, testInfo, `idle-${playerClass}`);
    expect(faults).toEqual([]);
  });
}

test("model pack uses mapped building assets in the live scene", async ({
  page,
}, testInfo) => {
  const faults = captureBrowserFaults(page);
  const buildings = [
    "Campfire",
    "Workshop",
    "Farm",
    "Storage",
    "Healer",
  ] as const;
  await primeModelWorld(page, "knight", buildings);
  await page.goto(applicationPath, { waitUntil: "commit" });
  await expectModelsReady(page);
  await expect
    .poll(() => activeModelKeys(page))
    .toEqual(
      expect.arrayContaining([
        "player-knight",
        ...buildings.map((kind) => `building-${kind}`),
      ]),
    );
  await attachStableModelScreenshot(page, testInfo, "mapped-buildings");
  expect(faults).toEqual([]);
});

for (const playerClass of ["knight", "wizard", "archer"] as const) {
  test(`model asset requests for ${playerClass} are base-path safe GLB responses`, async ({
    page,
  }) => {
    const faults = captureBrowserFaults(page);
    const responses: { path: string; status: number; type: string }[] = [];
    page.on("response", async (response) => {
      if (!response.url().toLowerCase().includes(".glb")) return;
      responses.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
        type: (await response.headerValue("content-type")) ?? "",
      });
    });
    await primeModelWorld(page, playerClass);
    await page.goto(applicationPath, { waitUntil: "commit" });
    await expectModelsReady(page);
    await expect.poll(() => responses.length).toBeGreaterThan(0);
    const prefix =
      applicationPath === "/" ? "/assets/models/" : "/Wanderer/assets/models/";
    for (const response of responses) {
      expect(response.path.startsWith(prefix)).toBe(true);
      expect(response.status).toBe(200);
      expect(response.type).not.toMatch(/text\/html/i);
    }
    expect(faults).toEqual([]);
  });
}

test("a missing GLB falls back without preventing active gameplay", async ({
  page,
}, testInfo) => {
  const faults = captureBrowserFaults(page);
  await page.route("**/*.glb", async (route) =>
    route.fulfill({
      status: 404,
      contentType: "text/plain",
      body: "missing test model",
    }),
  );
  await primeModelWorld(page, "wizard", ["Campfire"]);
  await page.goto(applicationPath, { waitUntil: "commit" });
  const canvas = page.getByTestId("world-canvas");
  await expect(canvas).toHaveAttribute("data-model-pending-count", "0");
  await expect(canvas).toHaveAttribute(
    "data-model-fallback-keys",
    /player-wizard/,
  );
  await expect(canvas).toHaveAttribute("data-floor-drop-count", /\d+/);
  await expect(page.getByTestId("world-player-hp")).toBeVisible();
  await page.getByTestId("character-status-toggle").click();
  const position = page.getByTestId("position");
  await expect(position).toHaveText("Position: 0.0, 0.0 · input: system");
  await page.keyboard.down("d");
  await expect(position).not.toContainText("Position: 0.0, 0.0");
  await page.keyboard.up("d");
  await attachStableModelScreenshot(page, testInfo, "missing-model-fallback");
  expectOnlyMissingModelFaults(faults);
});
