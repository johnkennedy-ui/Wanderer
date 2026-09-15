import { expect, test } from "@playwright/test";
import { captureBrowserFaults } from "./model-pack-helpers";
import {
  applicationPath,
  attachTerrainScreenshot,
  primeTerrainWorld,
  terrainFixtureFor,
  terrainFordFixture,
  terrainWorld,
  tapWorldPosition,
  visiblePosition,
} from "./terrain-test-helpers";

test.setTimeout(60_000);

for (const kind of ["tree", "mountain"] as const) {
  test(`${kind} terrain blocks keyboard approach and permits reverse retreat`, async ({
    page,
  }, testInfo) => {
    const fixture = terrainFixtureFor(kind);
    const faults = captureBrowserFaults(page);
    await primeTerrainWorld(page, fixture.start);
    await page.goto(applicationPath, { waitUntil: "commit" });
    await page.getByTestId("character-status-toggle").click();
    await expect(page.getByTestId("position")).toContainText("input: system");
    const key =
      fixture.obstacle.position.x > fixture.start.x
        ? "d"
        : fixture.obstacle.position.x < fixture.start.x
          ? "a"
          : fixture.obstacle.position.y > fixture.start.y
            ? "w"
            : "s";
    await page.keyboard.down(key);
    await page.waitForTimeout(900);
    await page.keyboard.up(key);
    const stopped = await visiblePosition(page);
    expect(
      Math.hypot(
        stopped.x - fixture.obstacle.position.x,
        stopped.y - fixture.obstacle.position.y,
      ),
    ).toBeGreaterThanOrEqual(fixture.obstacle.radius + 0.2);
    expect(
      Math.hypot(
        stopped.x - fixture.obstacle.position.x,
        stopped.y - fixture.obstacle.position.y,
      ),
    ).toBeLessThan(fixture.obstacle.radius + 0.4);
    expect(
      (stopped.x - fixture.obstacle.position.x) *
        (fixture.start.x - fixture.obstacle.position.x) +
        (stopped.y - fixture.obstacle.position.y) *
          (fixture.start.y - fixture.obstacle.position.y),
    ).toBeGreaterThan(0);
    const reverseKey =
      key === "d" ? "a" : key === "a" ? "d" : key === "w" ? "s" : "w";
    await page.keyboard.down(reverseKey);
    await page.waitForTimeout(350);
    await page.keyboard.up(reverseKey);
    const retreated = await visiblePosition(page);
    expect(
      Math.hypot(
        retreated.x - fixture.obstacle.position.x,
        retreated.y - fixture.obstacle.position.y,
      ),
    ).toBeGreaterThan(
      Math.hypot(
        stopped.x - fixture.obstacle.position.x,
        stopped.y - fixture.obstacle.position.y,
      ),
    );
    await attachTerrainScreenshot(page, testInfo, kind);
    expect(faults).toEqual([]);
  });
}

test("a generated river ford permits deliberate canvas crossing", async ({
  page,
}, testInfo) => {
  const fixture = terrainFordFixture();
  const faults = captureBrowserFaults(page);
  await primeTerrainWorld(page, fixture.start);
  await page.goto(applicationPath, { waitUntil: "commit" });
  await page.getByTestId("character-status-toggle").click();
  await expect(page.getByTestId("position")).toContainText("input: system");
  await page.getByTestId("character-status-toggle").click();
  for (const target of [fixture.midpoint, fixture.end]) {
    const player = await visiblePosition(page);
    await tapWorldPosition(
      page,
      player,
      target,
      testInfo.project.name === "touch",
    );
    await expect
      .poll(async () => {
        const actual = await visiblePosition(page);
        return Math.hypot(actual.x - target.x, actual.y - target.y);
      })
      .toBeLessThan(0.2);
    await expect(page.getByTestId("world-canvas")).toHaveAttribute(
      "data-destination-marker",
      "inactive",
    );
  }
  await attachTerrainScreenshot(page, testInfo, "water");
  expect(faults).toEqual([]);
});

test("water terrain rejects canvas placement and touch tap movement stops at its footprint", async ({
  page,
}, testInfo) => {
  const fixture = terrainFixtureFor("water");
  const faults = captureBrowserFaults(page);
  await primeTerrainWorld(page, fixture.start);
  await page.goto(applicationPath, { waitUntil: "commit" });
  await page.getByTestId("character-status-toggle").click();
  const player = await visiblePosition(page);
  await page.getByTestId("build-menu-toggle").click();
  await page.getByTestId("build-Workshop").click();
  await tapWorldPosition(
    page,
    player,
    fixture.obstacle.position,
    testInfo.project.name === "touch",
  );
  await expect(page.getByTestId("placement-message")).toContainText("terrain");
  await expect(page.getByTestId("placement-mode")).toContainText(
    "Workshop selected",
  );
  await page.getByTestId("cancel-placement").click();
  await tapWorldPosition(
    page,
    player,
    fixture.obstacle.position,
    testInfo.project.name === "touch",
  );
  // A nearby blocked tap may finish before the next DOM assertion. Observe
  // actual movement and terminal clearance rather than a transient marker.
  await expect.poll(() => visiblePosition(page)).not.toEqual(player);
  await expect(page.getByTestId("world-canvas")).toHaveAttribute(
    "data-destination-marker",
    "inactive",
  );
  const stopped = await visiblePosition(page);
  expect(
    Math.hypot(
      stopped.x - fixture.obstacle.position.x,
      stopped.y - fixture.obstacle.position.y,
    ),
  ).toBeGreaterThanOrEqual(fixture.obstacle.radius + 0.2);
  expect(
    Math.hypot(
      stopped.x - fixture.obstacle.position.x,
      stopped.y - fixture.obstacle.position.y,
    ),
  ).toBeLessThan(fixture.obstacle.radius + 0.45);
  expect(
    (stopped.x - fixture.obstacle.position.x) *
      (fixture.start.x - fixture.obstacle.position.x) +
      (stopped.y - fixture.obstacle.position.y) *
        (fixture.start.y - fixture.obstacle.position.y),
  ).toBeGreaterThan(0);
  expect(terrainWorld.generatorVersion).toBe("wanderer-web-v3");
  await attachTerrainScreenshot(page, testInfo, "water");
  expect(faults).toEqual([]);
});
