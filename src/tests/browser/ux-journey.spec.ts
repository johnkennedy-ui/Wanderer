import { expect, test } from "@playwright/test";
import { HARVEST_INTERACTION_DISTANCE } from "../../domain/resourceHarvesting";
import { terrainBlocksPosition } from "../../domain/world/terrainCollision";
import { captureBrowserFaults } from "./model-pack-helpers";
import {
  openBuild,
  openM5World,
  expectRowPosition,
  type FreshStationaryM5Projection,
} from "./m5-test-helpers";
import {
  harvestableFixtureFor,
  primeTerrainWorld,
  terrainWorld,
  visiblePosition,
  tapWorldPosition,
} from "./terrain-test-helpers";

// One end-to-end interaction journey replaces duplicated isolated journeys in
// the release browser matrix. It still exercises real input, committed UI
// projections, the two harvest rewards, and the no-implicit-save contract.
test.setTimeout(120_000);

test("player moves, builds, places a wall, and harvests a tree and rock in one journey", async ({
  page,
}, testInfo) => {
  const touch = testInfo.project.name === "touch";
  const tree = harvestableFixtureFor("tree");
  const rock = harvestableFixtureFor("rock");
  const start = {
    x: (tree.obstacle.position.x + rock.obstacle.position.x) / 2,
    y: (tree.obstacle.position.y + rock.obstacle.position.y) / 2,
  };
  expect(terrainBlocksPosition(terrainWorld, start)).toBe(false);
  expect(
    Math.hypot(
      start.x - tree.obstacle.position.x,
      start.y - tree.obstacle.position.y,
    ),
  ).toBeLessThan(HARVEST_INTERACTION_DISTANCE);
  expect(
    Math.hypot(
      start.x - rock.obstacle.position.x,
      start.y - rock.obstacle.position.y,
    ),
  ).toBeLessThan(HARVEST_INTERACTION_DISTANCE);

  await primeTerrainWorld(page, start);
  const faults = captureBrowserFaults(page);
  await openM5World(page);
  const originalPosition = await visiblePosition(page);
  const saveBefore = await page.evaluate(() =>
    localStorage.getItem("wanderer.save.primary"),
  );
  expect(saveBefore).not.toBeNull();

  // Move through the ordinary keyboard control before using the world canvas.
  await page.keyboard.down("d");
  await page.waitForTimeout(180);
  await page.keyboard.up("d");
  await expect.poll(() => visiblePosition(page)).not.toEqual(originalPosition);
  const positionAfterMove = await visiblePosition(page);
  for (const obstacle of [tree.obstacle, rock.obstacle])
    expect(
      Math.hypot(
        positionAfterMove.x - obstacle.position.x,
        positionAfterMove.y - obstacle.position.y,
      ),
    ).toBeLessThan(HARVEST_INTERACTION_DISTANCE);
  const positionText = (await page.getByTestId("position").innerText()).trim();
  const player: FreshStationaryM5Projection = {
    ...positionAfterMove,
    positionText,
  };

  const activate = async (locator: import("@playwright/test").Locator) => {
    if (touch) await locator.tap();
    else await locator.click();
  };
  const resources = page.getByTestId("resources");
  const amount = async (title: string): Promise<number> => {
    const label = await resources
      .getByTitle(title, { exact: true })
      .getAttribute("aria-label");
    const match = label === null ? null : /: (\d+)$/.exec(label);
    if (match === null)
      throw new Error("Missing public resource balance: " + title);
    return Number(match[1]);
  };
  const balances = async () => ({
    wood: await amount("Wood"),
    stone: await amount("Stone"),
    iron: await amount("Iron"),
    scrap: await amount("Metal / Scrap"),
  });
  const placeAt = async (
    kind: "ArcherTower" | "WoodWall",
    x: number,
    y: number,
  ) => {
    await openBuild(page);
    await expect(page.getByTestId("build-menu-panel")).toBeVisible();
    await activate(page.getByTestId("build-" + kind));
    await expect(page.getByTestId("placement-mode")).toBeVisible();
    await expect(page.getByTestId("build-menu-panel")).toBeHidden();
    await tapWorldPosition(page, player, { x, y }, touch);
    const preview = page.getByTestId("placement-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("data-valid", "true");
    await expect(preview).toHaveAttribute("data-count", "1");
    const confirm = page.getByTestId("confirm-placement");
    await expect(confirm).toBeEnabled();
    await activate(confirm);
    await expect(page.getByTestId("placement-mode")).toBeHidden();
    await expect(page.getByTestId("world-canvas")).toHaveAttribute(
      "data-destination-marker",
      "inactive",
    );
    await expect.poll(() => visiblePosition(page)).toEqual(positionAfterMove);
  };

  // Generated-world V3 deterministic cells are clear of terrain and separated.
  await placeAt("ArcherTower", -117, -124);
  await placeAt("WoodWall", -117, -123);
  await openBuild(page);
  const rows = page.getByTestId("building-list").locator(".building-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Archer Tower" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "Wood Wall" })).toHaveCount(1);
  await expectRowPosition(rows.filter({ hasText: "Archer Tower" }), -117, -124);
  await expectRowPosition(rows.filter({ hasText: "Wood Wall" }), -117, -123);
  await expect(page.getByTestId("position")).toHaveText(positionText);
  await expect(page.getByTestId("build-menu-panel")).toBeVisible();
  await activate(page.getByTestId("build-menu-toggle"));
  await expect(page.getByTestId("build-menu-panel")).toBeHidden();

  const beforeHarvest = await balances();
  await tapWorldPosition(page, player, tree.obstacle.position, touch);
  await expect
    .poll(() => balances())
    .toEqual({
      ...beforeHarvest,
      wood: beforeHarvest.wood + 24,
    });
  await expect.poll(() => visiblePosition(page)).toEqual(positionAfterMove);
  await expect(page.getByTestId("world-canvas")).toHaveAttribute(
    "data-destination-marker",
    "inactive",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("wanderer.save.primary")),
  ).toBe(saveBefore);
  const afterTree = await balances();
  await tapWorldPosition(page, player, rock.obstacle.position, touch);
  await expect
    .poll(() => balances())
    .toEqual({
      ...afterTree,
      stone: afterTree.stone + 20,
      iron: afterTree.iron + 12,
    });
  await expect.poll(() => visiblePosition(page)).toEqual(positionAfterMove);
  await expect(page.getByTestId("world-canvas")).toHaveAttribute(
    "data-destination-marker",
    "inactive",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("wanderer.save.primary")),
  ).toBe(saveBefore);
  expect(faults).toEqual([]);
});
