import { expect, test, type Locator, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { defaultThreeCameraTuning } from "../../platform/render/threeRenderer";
import {
  captureFreshStationaryM5Projection,
  expectRowPosition,
  openBuild,
  openM5World,
} from "./m5-test-helpers";

// Keep each user outcome in a bounded fresh journey; the original combined
// journey exhausted its unchanged 30s watchdog before reaching relocation.
const setup = async (page: Page, project: string) => {
  await openM5World(page);
  const player = await captureFreshStationaryM5Projection(page);
  const activate = (locator: Locator) =>
    project === "touch" ? locator.tap() : locator.click();
  const placeAt = async (x: number, y: number) => {
    await expect(page.getByTestId("placement-mode")).toBeVisible();
    await expect(page.getByTestId("build-menu-panel")).toBeHidden();
    const canvas = page.getByTestId("world-canvas");
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
  const rows = page.getByTestId("building-list").locator(".building-row");
  return { activate, placeAt, rows };
};

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
    "nearest 1m tile centre",
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

test("same-tile wall placement rejects overlap and cancels without adding a row", async ({
  page,
}, testInfo) => {
  const { activate, placeAt, rows } = await setup(page, testInfo.project.name);
  await openBuild(page);
  await activate(page.getByTestId("build-WoodWall"));
  await placeAt(2.3, 1.7);
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await openBuild(page);
  const before = await rows.innerText();
  await activate(page.getByTestId("build-StoneWall"));
  await placeAt(2.3, 1.7);
  await expect(page.getByTestId("placement-message")).toContainText("overlaps");
  await expect(page.getByTestId("placement-mode")).toBeVisible();
  await activate(page.getByTestId("cancel-placement"));
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await openBuild(page);
  await expect(rows).toHaveCount(1);
  await expect.poll(() => rows.innerText()).toBe(before);
});

test("wall relocation snaps negative coordinates, retains identity, and supports cancellation", async ({
  page,
}, testInfo) => {
  const { activate, placeAt, rows } = await setup(page, testInfo.project.name);
  await openBuild(page);
  await activate(page.getByTestId("build-WoodWall"));
  await placeAt(2.3, 1.7);
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await openBuild(page);
  const wood = rows.filter({ hasText: "Wood Wall" });
  await expectRowPosition(wood, 2, 2);
  const woodId = await wood.getAttribute("data-testid");
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
