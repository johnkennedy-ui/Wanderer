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

/** M5 paths that synchronously establish a closed Build panel can avoid a
 * redundant read before the normal user-facing toggle click. An unexpected
 * open panel fails the explicit postcondition rather than silently passing. */
export const openKnownClosedBuild = async (page: Page): Promise<void> => {
  const toggle = page.getByTestId("build-menu-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("build-menu-panel")).not.toHaveAttribute(
    "hidden",
  );
};

/** Resolve distinct public choices, never retry a failed selection. The class
 * container is reused for consecutive skill tiers, so identity/key progress,
 * not container disappearance, is the completion witness. */
export const choosePendingClassChoicesIfOpen = async (
  page: Page,
  options: Readonly<{ observeEffects?: boolean }> = {},
): Promise<void> => {
  const observeEffects = options.observeEffects ?? true;
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
    const { id, label } = await button.evaluate((node) => ({
      id: node.getAttribute("data-testid"),
      label: (node as HTMLElement).innerText.split(":")[0],
    }));
    if (!id || !label) throw new Error("Class choice lacks public identity");
    await button.click();
    await expect(modal.getByTestId(id)).toHaveCount(0);
    await expect(choices).not.toHaveAttribute("data-choice-key", key);
    if (observeEffects)
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
    // The class modal remains visible through its sequential skill choices.
    // Keep handler work inside that overlay so an external effects assertion
    // cannot re-enter this same handler between choices.
    async () =>
      choosePendingClassChoicesIfOpen(page, { observeEffects: false }),
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
      if (!id) throw new Error("Boss choice lacks public identity");
      await button.click();
      // Returning lets Playwright wait for its intercepted overlay to close.
      // Post-click locators here would re-enter this same handler while the
      // modal remains visible, so behavior-specific assertions live in their
      // dedicated manual-choice acceptance scenarios instead.
    },
  );
};

export const openM5World = async (page: Page): Promise<void> => {
  await installIncidentalChoiceHandlers(page);
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH ?? "/");
  const canvas = page.getByTestId("world-canvas");
  await expect(canvas).toHaveAttribute("data-destination-marker", "inactive");
  await expect(canvas).toHaveCSS("visibility", "visible");
  const bounds = await canvas.boundingBox();
  if (
    bounds === null ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  )
    throw new Error("World canvas did not have a nonzero visible layout box");
  // These are fresh placement/retention scenarios, not a second boss-route
  // test. Live combat remains enabled. Fixed-input zero writes is separately
  // exercised against the real DOM consumer, including an explicit XP value.
};

type FreshStationaryM5Projection = Readonly<{
  x: number;
  y: number;
  positionText: string;
}>;

/** Fresh M5 placement scenarios begin at a public, stationary origin. Capture
 * that real UI witness once; do not derive it from test-owned state. */
export const captureFreshStationaryM5Projection = async (
  page: Page,
): Promise<FreshStationaryM5Projection> => {
  await openStatus(page);
  const position = page.getByTestId("position");
  const positionText = await position.innerText();
  expect(positionText).toBe("Position: 0.0, 0.0 · input: system");
  await page.getByTestId("close-character-status").click();
  await expect(page.getByTestId("character-status-panel")).toBeHidden();
  return Object.freeze({ x: 0, y: 0, positionText });
};

/** Project a desired world point to a trusted canvas click using the released
 * camera constants and a fresh, visibly observed player position. This is not
 * a gameplay hook or coordinate-entry UI. */
export const tapWorldPosition = async (
  page: Page,
  player: FreshStationaryM5Projection,
  x: number,
  y: number,
): Promise<void> => {
  await expect(page.getByTestId("placement-mode")).toBeVisible();
  await expect(page.getByTestId("character-status-panel")).toBeHidden();
  await expect(page.getByTestId("build-menu-panel")).toBeHidden();
  const canvas = page.getByTestId("world-canvas");
  await expect(canvas).toHaveAttribute("data-destination-marker", "inactive");
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
    player.x + tuning.playerOffset.x,
    tuning.playerOffset.y,
    -player.y + tuning.playerOffset.z,
  );
  camera.lookAt(player.x, 0, -player.y);
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
  await expect
    .poll(() =>
      page
        .getByTestId("position")
        .evaluate((node) => node.textContent?.trim() ?? ""),
    )
    .toBe(player.positionText);
  await expect(canvas).toHaveAttribute("data-destination-marker", "inactive");
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
