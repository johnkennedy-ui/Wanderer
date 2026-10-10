import { expect, test } from "@playwright/test";
import { captureBrowserFaults } from "./model-pack-helpers";
import {
  applicationPath,
  harvestableFixtureFor,
  primeTerrainWorld,
  tapWorldPosition,
  visiblePosition,
} from "./terrain-test-helpers";

// Full journey includes startup, harvest, reload rollback, and re-harvest.
test.setTimeout(60_000);

const resourceAmount = async (
  page: import("@playwright/test").Page,
  label: string,
): Promise<number> => {
  const chip = page
    .getByTestId("resources")
    .locator('.resource-chip[title="' + label + '"]');
  const ariaLabel = await chip.getAttribute("aria-label");
  const match = ariaLabel === null ? null : /: (\d+)$/.exec(ariaLabel);
  if (match === null)
    throw new Error(label + " balance was not publicly projected");
  return Number(match[1]);
};

const setHarvestPanels = async (
  page: import("@playwright/test").Page,
  open: boolean,
): Promise<void> => {
  for (const id of ["character-status-toggle", "resources-toggle"]) {
    const toggle = page.getByTestId(id);
    await expect(toggle).toBeVisible();
    if ((await toggle.getAttribute("aria-expanded")) !== String(open))
      await toggle.click();
  }
};

for (const kind of ["tree", "rock"] as const) {
  test(
    "canvas click harvests a nearby " + kind + " on desktop and touch",
    async ({ page }, testInfo) => {
      const fixture = harvestableFixtureFor(kind);
      const faults = captureBrowserFaults(page);
      const setPanels = async (open: boolean, stage: string): Promise<void> => {
        try {
          await setHarvestPanels(page, open);
        } catch (error) {
          throw new Error(
            "Harvest panel interaction failed at " +
              stage +
              ": " +
              String(error) +
              "; captured browser faults=" +
              JSON.stringify(faults),
          );
        }
      };
      await primeTerrainWorld(page, fixture.start);
      await page.goto(applicationPath, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("character-status-toggle")).toBeVisible();
      await setPanels(true, "before-first-harvest");

      const positionBefore = await visiblePosition(page);
      const before = {
        wood: await resourceAmount(page, "Wood"),
        stone: await resourceAmount(page, "Stone"),
        iron: await resourceAmount(page, "Iron"),
        scrap: await resourceAmount(page, "Metal / Scrap"),
      };
      const storedBefore = await page.evaluate(() =>
        window.localStorage.getItem("wanderer.save.primary"),
      );
      expect(storedBefore).not.toBeNull();

      // These panels cover the near-player target; close them for an actual
      // canvas tap instead of letting the DOM intercept pointer input.
      await setHarvestPanels(page, false);
      await tapWorldPosition(
        page,
        positionBefore,
        fixture.obstacle.position,
        testInfo.project.name === "touch",
      );
      await setPanels(true, "after-first-harvest");
      await expect
        .poll(() => resourceAmount(page, "Wood"))
        .toBe(before.wood + (kind === "tree" ? 24 : 0));
      await expect
        .poll(() => resourceAmount(page, "Stone"))
        .toBe(before.stone + (kind === "rock" ? 20 : 0));
      await expect
        .poll(() => resourceAmount(page, "Iron"))
        .toBe(before.iron + (kind === "rock" ? 12 : 0));
      await expect.poll(() => visiblePosition(page)).toEqual(positionBefore);
      await expect(page.getByTestId("world-canvas")).toHaveAttribute(
        "data-destination-marker",
        "inactive",
      );
      expect(await resourceAmount(page, "Wood")).toBe(
        before.wood + (kind === "tree" ? 24 : 0),
      );
      expect(await resourceAmount(page, "Stone")).toBe(
        before.stone + (kind === "rock" ? 20 : 0),
      );
      expect(await resourceAmount(page, "Iron")).toBe(
        before.iron + (kind === "rock" ? 12 : 0),
      );
      expect(await resourceAmount(page, "Metal / Scrap")).toBe(before.scrap);
      expect(
        await page.evaluate(() =>
          window.localStorage.getItem("wanderer.save.primary"),
        ),
      ).toBe(storedBefore);

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("character-status-toggle")).toBeVisible();
      await setPanels(true, "after-unsaved-reload");
      await expect.poll(() => resourceAmount(page, "Wood")).toBe(before.wood);
      expect(await resourceAmount(page, "Stone")).toBe(before.stone);
      expect(await resourceAmount(page, "Iron")).toBe(before.iron);
      expect(
        await page.evaluate(() =>
          window.localStorage.getItem("wanderer.save.primary"),
        ),
      ).toBe(storedBefore);

      // The unchanged committed save must restore both the old balance and
      // the deterministic node, so a second harvest is available after reload.
      const reloadedPosition = await visiblePosition(page);
      await setHarvestPanels(page, false);
      await tapWorldPosition(
        page,
        reloadedPosition,
        fixture.obstacle.position,
        testInfo.project.name === "touch",
      );
      await setPanels(true, "after-reharvest");
      await expect
        .poll(() => resourceAmount(page, "Wood"))
        .toBe(before.wood + (kind === "tree" ? 24 : 0));
      await expect
        .poll(() => resourceAmount(page, "Stone"))
        .toBe(before.stone + (kind === "rock" ? 20 : 0));
      await expect
        .poll(() => resourceAmount(page, "Iron"))
        .toBe(before.iron + (kind === "rock" ? 12 : 0));
      await expect.poll(() => visiblePosition(page)).toEqual(reloadedPosition);
      expect(await resourceAmount(page, "Wood")).toBe(
        before.wood + (kind === "tree" ? 24 : 0),
      );
      expect(await resourceAmount(page, "Stone")).toBe(
        before.stone + (kind === "rock" ? 20 : 0),
      );
      expect(await resourceAmount(page, "Iron")).toBe(
        before.iron + (kind === "rock" ? 12 : 0),
      );
      expect(await resourceAmount(page, "Metal / Scrap")).toBe(before.scrap);
      expect(
        await page.evaluate(() =>
          window.localStorage.getItem("wanderer.save.primary"),
        ),
      ).toBe(storedBefore);
      expect(faults).toEqual([]);
    },
  );
}

test("touch status badges stay clear of the action dock", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "touch", "responsive touch layout only");
  await page.goto(applicationPath, { waitUntil: "domcontentloaded" });
  const stats = page.getByTestId("quick-stats");
  const dock = page.locator(".hud-action-dock");
  await expect(stats).toBeVisible();
  await expect(dock).toBeVisible();
  const statsBox = await stats.boundingBox();
  const dockBox = await dock.boundingBox();
  expect(statsBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  if (statsBox === null || dockBox === null) return;
  const overlaps =
    statsBox.x < dockBox.x + dockBox.width &&
    statsBox.x + statsBox.width > dockBox.x &&
    statsBox.y < dockBox.y + dockBox.height &&
    statsBox.y + statsBox.height > dockBox.y;
  expect(overlaps).toBe(false);
});
