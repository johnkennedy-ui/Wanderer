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

/** Click only a visible, enabled, topmost public choice with real pointer input.
 * Locator clicks here re-enter the same locator handler that is resolving its
 * own modal; page.mouse preserves browser hit-testing without that recursion. */
const clickVisiblePublicChoice = async (
  page: Page,
  choiceId: string,
): Promise<void> => {
  // Resolve the current public choice without Locator.evaluate auto-waiting: the
  // locator handler may be running because that same modal intercepted a query.
  const point = await page.evaluate((testId) => {
    const matches = Array.from(
      document.querySelectorAll<HTMLElement>("[data-testid]"),
    ).filter((candidate) => candidate.dataset.testid === testId);
    const node = matches.length === 1 ? matches[0] : null;
    if (!(node instanceof HTMLButtonElement)) return null;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const target = document.elementFromPoint(x, y);
    if (
      node.matches(":disabled") ||
      node.getAttribute("aria-disabled") === "true" ||
      target === null ||
      (target !== node && !node.contains(target))
    )
      return null;
    return { x, y };
  }, choiceId);
  if (point === null)
    throw new Error(
      "Public modal choice is not an enabled, topmost hit target",
    );
  await page.mouse.click(point.x, point.y);
};

/** Resolve distinct public choices, never retry a failed selection. The class
 * container is reused for consecutive skill tiers, so identity/key progress,
 * not container disappearance, is the completion witness. */
export const choosePendingClassChoicesIfOpen = async (
  page: Page,
  options: Readonly<{ observeEffects?: boolean }> = {},
): Promise<void> => {
  const observeEffects = options.observeEffects ?? true;
  const seen = new Set<string>();
  while (
    await page.evaluate(() => {
      const currentModal = document.querySelector<HTMLElement>(
        "[data-testid=class-modal]",
      );
      return currentModal !== null && !currentModal.hidden;
    })
  ) {
    await page.waitForFunction(
      () => {
        const currentModal = document.querySelector<HTMLElement>(
          '[data-testid="class-modal"]',
        );
        const currentChoices = document.querySelector<HTMLElement>(
          '[data-testid="class-choices"]',
        );
        const key = currentChoices?.getAttribute("data-choice-key");
        const button =
          currentModal?.querySelector<HTMLButtonElement>(
            '[data-testid="class-wizard"]',
          ) ??
          currentModal?.querySelector<HTMLButtonElement>("button[data-testid]");
        return (
          currentModal !== null &&
          currentModal !== undefined &&
          !currentModal.hidden &&
          key !== null &&
          key !== undefined &&
          key.length > 0 &&
          button !== null &&
          button !== undefined
        );
      },
      undefined,
      { timeout: 5_000 },
    );
    const choice = await page.evaluate(() => {
      const currentModal = document.querySelector<HTMLElement>(
        '[data-testid="class-modal"]',
      );
      const currentChoices = document.querySelector<HTMLElement>(
        '[data-testid="class-choices"]',
      );
      const key = currentChoices?.getAttribute("data-choice-key") ?? null;
      const button =
        currentModal?.querySelector<HTMLButtonElement>(
          '[data-testid="class-wizard"]',
        ) ??
        currentModal?.querySelector<HTMLButtonElement>("button[data-testid]");
      return {
        key,
        id: button?.dataset.testid ?? null,
        label: button?.innerText.split(":")[0] ?? null,
      };
    });
    const { key, id, label } = choice;
    if (!key || seen.has(key))
      throw new Error("Class choice did not progress to a distinct public key");
    seen.add(key);
    if (!id || !label) throw new Error("Class choice lacks public identity");
    await clickVisiblePublicChoice(page, id);
    // Locator assertions on this still-open modal can re-enter its own
    // Playwright locator handler. Observe the same UI progress without a
    // locator action: either the modal closes or a distinct choice key appears.
    await page.waitForFunction(
      ({ choiceId, previousKey }) => {
        const currentModal = document.querySelector<HTMLElement>(
          '[data-testid="class-modal"]',
        );
        if (currentModal === null) return false;
        if (currentModal.hidden) return true;
        const selectedChoiceStillExists = Array.from(
          currentModal.querySelectorAll<HTMLElement>("[data-testid]"),
        ).some((candidate) => candidate.dataset.testid === choiceId);
        if (selectedChoiceStillExists) return false;
        const currentChoices = document.querySelector<HTMLElement>(
          '[data-testid="class-choices"]',
        );
        const nextKey = currentChoices?.getAttribute("data-choice-key");
        return (
          nextKey !== null &&
          nextKey !== undefined &&
          nextKey.length > 0 &&
          nextKey !== previousKey
        );
      },
      { choiceId: id, previousKey: key },
      { timeout: 5_000 },
    );
    if (observeEffects)
      await expect(page.getByTestId("effects")).toContainText(label);
  }
};

/** Only opt in where modals are incidental. Predictable class/boss acceptance
 * tests keep their own selections. No visibility-check/action retry wrapper,
 * arbitrary global choice cap, hidden click or swallowed failure. */
const pagesWithIncidentalChoiceHandlers = new WeakSet<Page>();

export const installIncidentalChoiceHandlers = async (
  page: Page,
): Promise<void> => {
  if (pagesWithIncidentalChoiceHandlers.has(page)) return;
  await page.addLocatorHandler(
    page.getByTestId("class-modal"),
    // The class modal remains visible through its sequential skill choices.
    // Keep handler work inside that overlay so an external effects assertion
    // cannot re-enter this same handler between choices.
    async () =>
      choosePendingClassChoicesIfOpen(page, { observeEffects: false }),
    { noWaitAfter: true },
  );
  await page.addLocatorHandler(page.getByTestId("upgrade-modal"), async () => {
    // A just-opened upgrade overlay can be observed before its three choices
    // are projected. Wait on DOM state directly to avoid re-entering this
    // locator handler while its own overlay is visible.
    await page.waitForFunction(
      () => {
        const modal = document.querySelector<HTMLElement>(
          '[data-testid="upgrade-modal"]',
        );
        if (modal === null) return false;
        if (modal.hidden) return true;
        const choices = document.querySelector<HTMLElement>(
          '[data-testid="upgrade-choices"]',
        );
        const key = choices?.getAttribute("data-choice-key");
        return (
          key !== null &&
          key !== undefined &&
          key.length > 0 &&
          modal.querySelectorAll("button").length === 3
        );
      },
      undefined,
      { timeout: 5_000 },
    );
    const choice = await page.evaluate(() => {
      const modal = document.querySelector<HTMLElement>(
        '[data-testid="upgrade-modal"]',
      );
      if (modal === null || modal.hidden) return { visible: false, id: null };
      return {
        visible: true,
        id:
          modal.querySelector<HTMLButtonElement>("button")?.dataset.testid ??
          null,
      };
    });
    if (!choice.visible) return;
    if (choice.id === null)
      throw new Error("Boss choice lacks public identity");
    await clickVisiblePublicChoice(page, choice.id);
    // Returning lets Playwright wait for its intercepted overlay to close.
    // Do not perform locator assertions against the still-visible overlay.
  });
  pagesWithIncidentalChoiceHandlers.add(page);
};

/** Page.mouse gestures bypass locator auto-handlers, so drain any already-open
 * incidental choice overlay immediately before a raw canvas interaction. */
export const resolveIncidentalChoiceOverlays = async (
  page: Page,
): Promise<void> => {
  await installIncidentalChoiceHandlers(page);
  await expect(page.getByTestId("class-modal")).toBeHidden();
  await expect(page.getByTestId("upgrade-modal")).toBeHidden();
};

export const openM5World = async (page: Page): Promise<void> => {
  await installIncidentalChoiceHandlers(page);
  await page.goto(process.env.PLAYWRIGHT_BASE_PATH ?? "/");
  const canvas = page.getByTestId("world-canvas");
  // Use the first public player-state projection as the startup signal;
  // the destination marker is input state, not a page-load signal.
  await page.waitForFunction(
    () => {
      const currentPosition = document.querySelector<HTMLElement>(
        '[data-testid="position"]',
      );
      return currentPosition?.textContent?.startsWith("Position: ") === true;
    },
    undefined,
    { timeout: 15_000 },
  );
  await expect(canvas).toHaveAttribute("data-destination-marker", "inactive", {
    timeout: 15_000,
  });
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

export type FreshStationaryM5Projection = Readonly<{
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
const projectWorldPosition = async (
  page: Page,
  player: FreshStationaryM5Projection,
  x: number,
  y: number,
): Promise<{
  canvas: Locator;
  bounds: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;
  position: { x: number; y: number };
}> => {
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
  return { canvas, bounds, position };
};

/** Send one ordinary canvas tap. In placement mode that only stages or repositions
 * the public preview; confirmation is a separate user action. */
export const tapWorldPosition = async (
  page: Page,
  player: FreshStationaryM5Projection,
  x: number,
  y: number,
  touch = false,
): Promise<void> => {
  await expect(page.getByTestId("placement-mode")).toBeVisible();
  await expect(page.getByTestId("character-status-panel")).toBeHidden();
  await expect(page.getByTestId("build-menu-panel")).toBeHidden();
  const { canvas, position } = await projectWorldPosition(page, player, x, y);
  await resolveIncidentalChoiceOverlays(page);
  await expect(canvas).toHaveAttribute("data-destination-marker", "inactive");
  if (touch) await canvas.tap({ position });
  else await canvas.click({ position });
  await expect
    .poll(() =>
      page
        .getByTestId("position")
        .evaluate((node) => node.textContent?.trim() ?? ""),
    )
    .toBe(player.positionText);
  await expect(canvas).toHaveAttribute("data-destination-marker", "inactive");
};

/** A genuine pointer drag releases into a staged line; it never commits. */
export const dragWorldLine = async (
  page: Page,
  player: FreshStationaryM5Projection,
  start: Readonly<{ x: number; y: number }>,
  end: Readonly<{ x: number; y: number }>,
): Promise<void> => {
  await expect(page.getByTestId("placement-mode")).toBeVisible();
  await expect(page.getByTestId("build-menu-panel")).toBeHidden();
  const from = await projectWorldPosition(page, player, start.x, start.y);
  const to = await projectWorldPosition(page, player, end.x, end.y);
  await from.canvas.scrollIntoViewIfNeeded();
  await resolveIncidentalChoiceOverlays(page);
  await page.mouse.move(
    from.bounds.x + from.position.x,
    from.bounds.y + from.position.y,
  );
  await page.mouse.down();
  await page.mouse.move(
    to.bounds.x + to.position.x,
    to.bounds.y + to.position.y,
    {
      steps: 8,
    },
  );
  await page.mouse.up();
};

/** The initial tap stages; the following tap is the distinct commit action. */
export const placeWorldPosition = async (
  page: Page,
  player: FreshStationaryM5Projection,
  x: number,
  y: number,
  touch = false,
): Promise<void> => {
  await tapWorldPosition(page, player, x, y, touch);
  const preview = page.getByTestId("placement-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("data-valid", "true");
  await expect(preview).toHaveAttribute("data-count", "1");
  await expect(preview).toContainText(/\b1\b/);
  await expect(preview).toContainText(/cost/i);
  await expect(preview).toContainText(/tap/i);
  await tapWorldPosition(page, player, x, y, touch);
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
