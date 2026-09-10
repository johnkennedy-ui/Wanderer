import { expect, type Page, type Locator } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { defaultThreeCameraTuning } from "../../platform/render/threeRenderer";

export const openStatus = async (page: Page): Promise<void> => {
  const toggle = page.getByTestId("character-status-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  await expect(page.getByTestId("character-status-panel")).toBeVisible();
};
export const openBuild = async (page: Page): Promise<void> => {
  const toggle = page.getByTestId("build-menu-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  await expect(page.getByTestId("build-menu-panel")).toBeVisible();
};

export const openM5World = async (page: Page): Promise<void> => {
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH ?? "/");
  await expect(page.getByTestId("world-canvas")).toBeVisible();
  await openStatus(page);
  // Complete the real pursuit route, not just a currently open modal. Polls
  // observe progress; no click retries, sleeps or gameplay injection.
  await page.keyboard.down("d");
  try {
    await expect
      .poll(async () => {
        const match = /^Position: (-?\d+(?:\.\d+)?),/.exec(
          await page.getByTestId("position").innerText(),
        );
        return match === null ? Number.NaN : Number(match[1]);
      })
      .toBeGreaterThanOrEqual(3);
  } finally {
    await page.keyboard.up("d");
  }
  const classModal = page.getByTestId("class-modal");
  const bossModal = page.getByTestId("upgrade-modal");
  // At most one class and four distinct earned tiers precede the boss choice.
  // This is bounded progression through different choices, not retrying an action.
  for (let choice = 0; choice < 6; choice += 1) {
    await expect(
      page.locator(
        '[data-testid="class-modal"]:visible, [data-testid="upgrade-modal"]:visible',
      ),
    ).toHaveCount(1, { timeout: 30_000 });
    if (await classModal.isVisible()) {
      await expect(bossModal).toBeHidden();
      const wizard = classModal.getByTestId("class-wizard");
      const button =
        (await wizard.count()) === 1
          ? wizard
          : classModal.getByRole("button").first();
      const chosen = await button.getAttribute("data-testid");
      if (chosen === null)
        throw new Error("Class choice lacks public identity");
      await button.click();
      await expect(classModal.getByTestId(chosen)).toHaveCount(0);
      continue;
    }
    await expect(bossModal.getByRole("button")).toHaveCount(3);
    await bossModal.getByRole("button").first().click();
    await expect(bossModal).toBeHidden();
    await expect(classModal).toBeHidden();
    await openStatus(page);
    await page.getByTestId("close-character-status").click();
    return;
  }
  throw new Error(
    "Real boss-route modal precondition did not finish within the class/tier bound",
  );
};

/** Project a desired world point to a trusted canvas click using the released
 * camera constants and visible position text. This is not a gameplay hook or
 * coordinate-entry UI. Rounded public player text introduces <=0.05m/axis. */
export const tapWorldPosition = async (
  page: Page,
  x: number,
  y: number,
): Promise<void> => {
  await openStatus(page);
  const match = /^Position: (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)/.exec(
    await page.getByTestId("position").innerText(),
  );
  if (match === null) throw new Error("Missing visible player coordinates");
  const playerX = Number(match[1]),
    playerY = Number(match[2]);
  await page.getByTestId("close-character-status").click();
  const buildToggle = page.getByTestId("build-menu-toggle");
  if ((await buildToggle.getAttribute("aria-expanded")) === "true")
    await page.getByTestId("close-build-menu").click();
  const canvas = page.getByTestId("world-canvas");
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("World canvas was not laid out");
  const tuning = defaultThreeCameraTuning;
  const camera = new PerspectiveCamera(
    tuning.fieldOfViewDegrees,
    bounds.width / bounds.height,
    0.1,
    100,
  );
  camera.position.set(
    playerX + tuning.playerOffset.x,
    tuning.playerOffset.y,
    -playerY + tuning.playerOffset.z,
  );
  camera.lookAt(playerX, 0, -playerY);
  camera.updateMatrixWorld();
  const point = new Vector3(x, 0, -y).project(camera);
  const position = {
    x: ((point.x + 1) / 2) * bounds.width,
    y: ((1 - point.y) / 2) * bounds.height,
  };
  expect(position.x).toBeGreaterThan(0);
  expect(position.x).toBeLessThan(bounds.width);
  expect(position.y).toBeGreaterThan(0);
  expect(position.y).toBeLessThan(bounds.height);
  await canvas.click({ position });
};

export const expectRowPosition = async (
  row: Locator,
  x: number,
  y: number,
): Promise<void> => {
  await expect(row).toBeVisible();
  const match = /@ (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)/.exec(
    await row.innerText(),
  );
  if (match === null) throw new Error("Missing visible building coordinates");
  expect(Math.abs(Number(match[1]) - x)).toBeLessThanOrEqual(0.11);
  expect(Math.abs(Number(match[2]) - y)).toBeLessThanOrEqual(0.11);
};
