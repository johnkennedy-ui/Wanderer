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

/** Resolve distinct public choices, never retry a failed selection. The class
 * container is reused for consecutive skill tiers, so identity/key progress,
 * not container disappearance, is the completion witness. */
export const choosePendingClassChoicesIfOpen = async (
  page: Page,
): Promise<void> => {
  const modal = page.getByTestId("class-modal");
  const choices = page.getByTestId("class-choices");
  const seen = new Set<string>();
  while (await modal.isVisible()) {
    const key = await choices.getAttribute("data-choice-key");
    if (!key || seen.has(key))
      throw new Error("Class choice did not progress to a distinct public key");
    seen.add(key);
    const wizard = modal.getByTestId("class-wizard");
    const button =
      (await wizard.count()) === 1 ? wizard : modal.getByRole("button").first();
    const id = await button.getAttribute("data-testid");
    const label = (await button.innerText()).split(":")[0];
    if (!id || !label) throw new Error("Class choice lacks public identity");
    await button.click();
    await expect(modal.getByTestId(id)).toHaveCount(0);
    await expect(choices).not.toHaveAttribute("data-choice-key", key);
    await expect(page.getByTestId("effects")).toContainText(label);
  }
};

/** Only opt in where modals are incidental. Predictable class/boss acceptance
 * tests keep their own selections. No visibility-check/action retry wrapper,
 * arbitrary global choice cap, hidden click or swallowed failure. */
export const installIncidentalChoiceHandlers = async (
  page: Page,
): Promise<void> => {
  await page.addLocatorHandler(
    page.getByTestId("class-modal"),
    async () => choosePendingClassChoicesIfOpen(page),
    { noWaitAfter: true },
  );
  await page.addLocatorHandler(
    page.getByTestId("upgrade-modal"),
    async (modal) => {
      const choices = page.getByTestId("upgrade-choices");
      const key = await choices.getAttribute("data-choice-key");
      if (!key) throw new Error("Boss choice lacks public key");
      await expect(modal.getByRole("button")).toHaveCount(3);
      const button = modal.getByRole("button").first();
      const id = await button.getAttribute("data-testid");
      const label = (await button.innerText()).split(":")[0];
      if (!id || !label) throw new Error("Boss choice lacks public identity");
      await button.click();
      await expect(modal.getByTestId(id)).toHaveCount(0);
      await expect(choices).not.toHaveAttribute("data-choice-key", key);
      await expect(page.getByTestId("effects")).toContainText(label);
    },
    { noWaitAfter: true },
  );
};

export const openM5World = async (page: Page): Promise<void> => {
  await installIncidentalChoiceHandlers(page);
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH ?? "/");
  await expect(page.getByTestId("world-canvas")).toBeVisible();
  // These are fresh placement/retention scenarios, not a second boss-route
  // test. Live combat remains enabled. Fixed-input zero writes is separately
  // exercised against the real DOM consumer, including an explicit XP value.
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
