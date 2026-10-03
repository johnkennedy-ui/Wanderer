import { expect, test, type Locator, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { defaultThreeCameraTuning } from "../../platform/render/threeRenderer";
import {
  captureFreshStationaryM5Projection,
  expectRowPosition,
  openBuild,
  openKnownClosedBuild,
  openM5World,
  resolveIncidentalChoiceOverlays,
} from "./m5-test-helpers";

// Keep each user outcome in a bounded fresh journey. The full single-worker
// browser matrix can delay live rendering and combat; match the M5 watchdog
// without adding retries or weakening assertions.
test.setTimeout(150_000);

const setup = async (page: Page, project: string) => {
  await openM5World(page);
  const player = await captureFreshStationaryM5Projection(page);
  const activate = (locator: Locator) =>
    project === "touch" ? locator.tap() : locator.click();
  const canvas = page.getByTestId("world-canvas");
  const rows = page.getByTestId("building-list").locator(".building-row");
  const positionAt = async (x: number, y: number) => {
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error("World canvas has no visible bounds");
    const tuning = defaultThreeCameraTuning;
    const camera = new PerspectiveCamera(
      tuning.fieldOfViewDegrees,
      bounds.width / bounds.height,
      0.1,
      100,
    );
    camera.position.set(
      player.x + tuning.playerOffset.x,
      tuning.playerOffset.y,
      -player.y + tuning.playerOffset.z,
    );
    camera.lookAt(player.x, 0, -player.y);
    camera.updateMatrixWorld();
    const projected = new Vector3(x, 0, -y).project(camera);
    const position = {
      x: ((projected.x + 1) / 2) * bounds.width,
      y: ((1 - projected.y) / 2) * bounds.height,
    };
    expect(position.x).toBeGreaterThan(0);
    expect(position.x).toBeLessThan(bounds.width);
    expect(position.y).toBeGreaterThan(0);
    expect(position.y).toBeLessThan(bounds.height);
    return { bounds, position };
  };
  const tapAt = async (x: number, y: number) => {
    const { position } = await positionAt(x, y);
    await resolveIncidentalChoiceOverlays(page);
    if (project === "touch") await canvas.tap({ position });
    else await canvas.click({ position });
    await expect
      .poll(() =>
        page
          .getByTestId("position")
          .evaluate((node) => node.textContent?.trim()),
      )
      .toBe(player.positionText);
    await expect(canvas).toHaveAttribute("data-destination-marker", "inactive");
  };
  const previewAt = async (x: number, y: number) => {
    await expect(page.getByTestId("placement-mode")).toBeVisible();
    await expect(page.getByTestId("build-menu-panel")).toBeHidden();
    await tapAt(x, y);
  };
  const dragLine = async (
    start: Readonly<{ x: number; y: number }>,
    end: Readonly<{ x: number; y: number }>,
  ) => {
    await expect(page.getByTestId("placement-mode")).toBeVisible();
    await expect(page.getByTestId("build-menu-panel")).toBeHidden();
    const from = await positionAt(start.x, start.y);
    const to = await positionAt(end.x, end.y);
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error("World canvas has no visible bounds");
    await resolveIncidentalChoiceOverlays(page);
    await page.mouse.move(
      bounds.x + from.position.x,
      bounds.y + from.position.y,
    );
    await page.mouse.down();
    await page.mouse.move(bounds.x + to.position.x, bounds.y + to.position.y, {
      steps: 8,
    });
    await page.mouse.up();
  };
  const placeAt = async (x: number, y: number) => {
    await previewAt(x, y);
    const preview = page.getByTestId("placement-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("data-valid", "true");
    await expect(preview).toHaveAttribute("data-count", "1");
    await expect(preview).toContainText(/\b1\b/);
    await expect(preview).toContainText(/cost/i);
    await expect(preview).toContainText(/tap/i);
    await expect(page.getByTestId("confirm-placement")).toBeEnabled();
    await tapAt(x, y);
  };
  return { activate, placeAt, previewAt, dragLine, tapAt, rows, player };
};

const wallDragCases = [
  {
    name: "horizontal",
    start: { x: 1, y: 1 },
    end: { x: 3, y: 1 },
    confirm: { x: 2, y: 1 },
    tiles: [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ],
  },
  {
    name: "vertical",
    start: { x: 3, y: 1 },
    end: { x: 3, y: 3 },
    confirm: { x: 3, y: 2 },
    tiles: [
      { x: 3, y: 1 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
    ],
  },
  {
    name: "reverse-direction",
    start: { x: 4, y: 4 },
    end: { x: 2, y: 4 },
    confirm: { x: 3, y: 4 },
    tiles: [
      { x: 2, y: 4 },
      { x: 3, y: 4 },
      { x: 4, y: 4 },
    ],
  },
  {
    name: "dominant-horizontal",
    start: { x: 1, y: 3 },
    end: { x: 4, y: 4 },
    confirm: { x: 2, y: 3 },
    tiles: [
      { x: 1, y: 3 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
    ],
  },
  {
    name: "dominant-vertical",
    start: { x: 4, y: 1 },
    end: { x: 3, y: 4 },
    confirm: { x: 4, y: 2 },
    tiles: [
      { x: 4, y: 1 },
      { x: 4, y: 2 },
      { x: 4, y: 3 },
      { x: 4, y: 4 },
    ],
  },
  {
    name: "dominant-axis-tie-prefers-horizontal",
    start: { x: 0, y: 4 },
    end: { x: 1, y: 5 },
    confirm: { x: 1, y: 4 },
    tiles: [
      { x: 0, y: 4 },
      { x: 1, y: 4 },
    ],
  },
] as const;

test("first taps stage a visible wall preview; another tile repositions and Confirm commits it", async ({
  page,
}, testInfo) => {
  const { activate, previewAt, tapAt, rows, player } = await setup(
    page,
    testInfo.project.name,
  );
  const preview = page.getByTestId("placement-preview");
  const resources = page.getByTestId("resources");
  const beforeResources = await resources.textContent();
  if (beforeResources === null) throw new Error("Resources were not available");

  await openBuild(page);
  await activate(page.getByTestId("build-WoodWall"));
  await previewAt(2.3, 1.7);
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("data-valid", "true");
  await expect(preview).toHaveAttribute("data-count", "1");
  await expect(preview).toContainText(/\b1\b/);
  await expect(preview).toContainText(/cost/i);
  await expect(preview).toContainText(/tap/i);
  await expect(rows).toHaveCount(0);
  await expect(resources).toHaveText(beforeResources);
  await expect(page.getByTestId("position")).toHaveText(player.positionText);

  // A second tap elsewhere relocates the ghost instead of committing the old tile.
  await tapAt(3.2, 2.1);
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("data-valid", "true");
  await expect(rows).toHaveCount(0);
  await expect(resources).toHaveText(beforeResources);
  const confirm = page.getByTestId("confirm-placement");
  await expect(confirm).toHaveAccessibleName("Confirm placement");
  await expect(confirm).toBeEnabled();
  await activate(confirm);

  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await expect(preview).toBeHidden();
  await openBuild(page);
  await expect(rows).toHaveCount(1);
  await expectRowPosition(rows.filter({ hasText: "Wood Wall" }), 3, 2);
  await expect(resources).not.toHaveText(beforeResources);
  await expect(page.getByTestId("position")).toHaveText(player.positionText);
});

test("canceling a staged placement leaves resources, buildings, save, and movement unchanged", async ({
  page,
}, testInfo) => {
  const { activate, previewAt, rows, player } = await setup(
    page,
    testInfo.project.name,
  );
  const resources = page.getByTestId("resources");
  const beforeResources = await resources.textContent();
  const saveBefore = await page.evaluate(() =>
    localStorage.getItem("wanderer.save.primary"),
  );
  if (beforeResources === null) throw new Error("Resources were not available");
  await expect(rows).toHaveCount(0);

  await openBuild(page);
  await activate(page.getByTestId("build-WoodWall"));
  await previewAt(2.3, 1.7);
  const preview = page.getByTestId("placement-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("data-valid", "true");
  await expect(rows).toHaveCount(0);
  await expect(resources).toHaveText(beforeResources);
  await expect(page.getByTestId("position")).toHaveText(player.positionText);

  const cancel = page.getByTestId("cancel-placement");
  await expect(cancel).toBeVisible();
  await expect(cancel).toHaveAccessibleName("Cancel placement");
  await expect(cancel).toHaveText("×");
  await activate(cancel);
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await expect(preview).toBeHidden();
  await expect(rows).toHaveCount(0);
  await expect(resources).toHaveText(beforeResources);
  await expect(page.getByTestId("position")).toHaveText(player.positionText);
  expect(
    await page.evaluate(() => localStorage.getItem("wanderer.save.primary")),
  ).toBe(saveBefore);
});

for (const line of wallDragCases) {
  test(`wall drag ${line.name} previews an inclusive straight line and commits only on a later tap`, async ({
    page,
  }, testInfo) => {
    const { activate, dragLine, tapAt, rows, player } = await setup(
      page,
      testInfo.project.name,
    );
    const resources = page.getByTestId("resources");
    const beforeResources = await resources.textContent();
    if (beforeResources === null)
      throw new Error("Resources were not available");

    await openBuild(page);
    await activate(page.getByTestId("build-WoodWall"));
    await dragLine(line.start, line.end);
    const preview = page.getByTestId("placement-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("data-valid", "true");
    await expect(preview).toHaveAttribute(
      "data-count",
      String(line.tiles.length),
    );
    await expect(preview).toContainText(
      new RegExp(`\\b${line.tiles.length}\\b`),
    );
    await expect(preview).toContainText(/cost/i);
    await expect(preview).toContainText(/tap/i);
    await expect(page.getByTestId("confirm-placement")).toBeEnabled();
    await expect(rows).toHaveCount(0);
    await expect(resources).toHaveText(beforeResources);
    await expect(page.getByTestId("position")).toHaveText(player.positionText);

    await tapAt(line.confirm.x, line.confirm.y);
    await expect(page.getByTestId("placement-mode")).toBeHidden();
    await expect(preview).toBeHidden();
    await expect(rows).toHaveCount(line.tiles.length);
    const observed: string[] = [];
    for (let index = 0; index < line.tiles.length; index += 1) {
      const text = await rows.nth(index).innerText();
      const match = /@ (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)/.exec(text);
      if (match === null)
        throw new Error(`Missing visible wall position: ${text}`);
      observed.push(`${Number(match[1])},${Number(match[2])}`);
    }
    expect(observed.sort()).toEqual(
      line.tiles.map(({ x, y }) => `${x},${y}`).sort(),
    );
    await expect(resources).not.toHaveText(beforeResources);
    await expect(page.getByTestId("position")).toHaveText(player.positionText);
  });
}

test("a blocked wall line is visibly invalid and rejects every tile atomically", async ({
  page,
}, testInfo) => {
  const { activate, placeAt, dragLine, rows, player } = await setup(
    page,
    testInfo.project.name,
  );
  const resources = page.getByTestId("resources");

  await openBuild(page);
  await activate(page.getByTestId("build-WoodWall"));
  await placeAt(2.3, 1.7);
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await openBuild(page);
  await expect(rows).toHaveCount(1);
  await expectRowPosition(rows.nth(0), 2, 2);
  const beforeResources = await resources.textContent();
  const saveBefore = await page.evaluate(() =>
    localStorage.getItem("wanderer.save.primary"),
  );
  if (beforeResources === null) throw new Error("Resources were not available");

  await activate(page.getByTestId("build-WoodWall"));
  await dragLine({ x: 1.4, y: 1.7 }, { x: 3.4, y: 1.7 });
  const preview = page.getByTestId("placement-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("data-valid", "false");
  await expect(preview).toHaveAttribute("data-count", "3");
  await expect(preview).toContainText(/\b3\b/);
  await expect(preview).toContainText(/cost/i);
  await expect(preview).toContainText(/tap/i);
  await expect(preview).toContainText(/overlap/i);
  await expect(preview).toContainText(
    /Rejected: overlaps an existing building/i,
  );
  await expect(page.getByTestId("confirm-placement")).toBeDisabled();
  await expect(rows).toHaveCount(1);
  await expect(resources).toHaveText(beforeResources);
  await expect(page.getByTestId("position")).toHaveText(player.positionText);

  const screenshot = testInfo.outputPath("invalid-wall-line-preview.png");
  await page.screenshot({ path: screenshot });
  await testInfo.attach("invalid-wall-line-preview", {
    path: screenshot,
    contentType: "image/png",
  });
  const cancel = page.getByTestId("cancel-placement");
  await expect(cancel).toHaveAccessibleName("Cancel placement");
  await activate(cancel);
  await expect(preview).toBeHidden();
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await openKnownClosedBuild(page);
  await expect(rows).toHaveCount(1);
  await expectRowPosition(rows.nth(0), 2, 2);
  await expect(resources).toHaveText(beforeResources);
  expect(
    await page.evaluate(() => localStorage.getItem("wanderer.save.primary")),
  ).toBe(saveBefore);
});

test("wood and stone choices snap to adjacent tiles and remain single-tier", async ({
  page,
}, testInfo) => {
  const { activate, placeAt, rows } = await setup(page, testInfo.project.name);
  await openBuild(page);
  await expect(page.getByTestId("build-WoodWall")).toHaveAccessibleName(
    "Place Wood Wall",
  );
  await expect(page.getByTestId("build-StoneWall")).toHaveAccessibleName(
    "Place Stone Wall",
  );
  await activate(page.getByTestId("build-WoodWall"));
  await expect(page.getByTestId("placement-mode")).toContainText(
    "Placement snaps to 1m tile centres",
  );
  await placeAt(2.3, 1.7);
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await openBuild(page);
  const wood = rows.filter({ hasText: "Wood Wall" });
  await expect(wood).toHaveCount(1);
  await expectRowPosition(wood, 2, 2);
  await expect(
    wood.getByRole("button", { name: "Upgrade", exact: true }),
  ).toBeDisabled();
  await activate(page.getByTestId("build-StoneWall"));
  await placeAt(3.2, 2.1);
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await openBuild(page);
  const stone = rows.filter({ hasText: "Stone Wall" });
  await expectRowPosition(stone, 3, 2);
  await expect(
    stone.getByRole("button", { name: "Upgrade", exact: true }),
  ).toBeDisabled();
  await expect(rows).toHaveCount(2);
});

test("Archer Tower upgrades through level three", async ({
  page,
}, testInfo) => {
  const { activate, placeAt, rows } = await setup(page, testInfo.project.name);
  await openBuild(page);
  await activate(page.getByTestId("build-ArcherTower"));
  await placeAt(2.3, 1.7);
  await expect(page.getByTestId("placement-mode")).toBeHidden();

  await openBuild(page);
  const archer = rows.filter({ hasText: "Archer Tower" });
  const upgrade = archer.getByRole("button", { name: "Upgrade", exact: true });
  await expect(archer).toContainText("Archer Tower L1");
  await expect(upgrade).toBeEnabled();
  await activate(upgrade);
  await expect(archer).toContainText("Archer Tower L2");
  await expect(upgrade).toBeEnabled();
  await activate(upgrade);
  await expect(archer).toContainText("Archer Tower L3");
  await expect(upgrade).toBeDisabled();
});

test("same-tile wall preview rejects overlap and cancels without adding a row", async ({
  page,
}, testInfo) => {
  const { activate, placeAt, previewAt, rows } = await setup(
    page,
    testInfo.project.name,
  );
  await openBuild(page);
  await activate(page.getByTestId("build-WoodWall"));
  await placeAt(2.3, 1.7);
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await openBuild(page);
  const before = await rows.innerText();
  const beforeResources = await page.getByTestId("resources").textContent();
  if (beforeResources === null)
    throw new Error("Initial resources were not available");
  await activate(page.getByTestId("build-StoneWall"));
  await previewAt(2.3, 1.7);
  const preview = page.getByTestId("placement-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("data-valid", "false");
  await expect(preview).toHaveAttribute("data-count", "1");
  await expect(preview).toContainText(/\b1\b/);
  await expect(preview).toContainText(/cost/i);
  await expect(preview).toContainText(/tap/i);
  await expect(preview).toContainText(/overlap/i);
  await expect(preview).toContainText(
    /Rejected: overlaps an existing building/i,
  );
  await expect(page.getByTestId("confirm-placement")).toBeDisabled();
  await expect(page.getByTestId("placement-mode")).toBeVisible();
  await expect(page.getByTestId("resources")).toHaveText(beforeResources!);
  await activate(page.getByTestId("cancel-placement"));
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await expect(preview).toBeHidden();
  await openBuild(page);
  await expect(rows).toHaveCount(1);
  await expect.poll(() => rows.innerText()).toBe(before);
  await expect(page.getByTestId("resources")).toHaveText(beforeResources!);
});

test("wall relocation snaps negative coordinates, retains identity, and supports cancellation", async ({
  page,
}, testInfo) => {
  const { activate, placeAt, previewAt, rows, player } = await setup(
    page,
    testInfo.project.name,
  );
  await openBuild(page);
  await activate(page.getByTestId("build-WoodWall"));
  await placeAt(2.3, 1.7);
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await openBuild(page);
  const wood = rows.filter({ hasText: "Wood Wall" });
  await expectRowPosition(wood, 2, 2);
  const woodId = await wood.getAttribute("data-testid");
  const beforeResources = await page.getByTestId("resources").textContent();
  if (beforeResources === null)
    throw new Error("Initial resources were not available");
  await activate(wood.getByRole("button", { name: "Relocate on canvas" }));
  await previewAt(-1.4, -2.6);
  const relocationPreview = page.getByTestId("placement-preview");
  await expect(relocationPreview).toBeVisible();
  await expect(relocationPreview).toHaveAttribute("data-valid", "true");
  await openBuild(page);
  await expectRowPosition(wood, 2, 2);
  await expect(page.getByTestId("resources")).toHaveText(beforeResources);
  await expect(page.getByTestId("position")).toHaveText(player.positionText);
  await activate(page.getByTestId("cancel-placement"));
  await expect(relocationPreview).toBeHidden();
  await openBuild(page);
  await expectRowPosition(wood, 2, 2);
  await activate(wood.getByRole("button", { name: "Relocate on canvas" }));
  await placeAt(-1.4, -2.6);
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await openBuild(page);
  await expectRowPosition(wood, -1, -3);
  await expect(wood).toHaveAttribute("data-testid", woodId!);
  await activate(page.getByTestId("build-StoneWall"));
  await expect(page.getByTestId("placement-mode")).toContainText(
    "Stone Wall selected",
  );
  await activate(page.getByTestId("cancel-placement"));
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await expect(page.getByTestId("placement-mode")).toHaveText(
    "Placement mode inactive.",
  );
  await openBuild(page);
  await expect(rows).toHaveCount(1);
  await expectRowPosition(wood, -1, -3);
});
