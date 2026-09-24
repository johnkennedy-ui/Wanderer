import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { decodeSave } from "../../domain/save";
import {
  choosePendingClassChoicesIfOpen,
  installIncidentalChoiceHandlers,
} from "./m5-test-helpers";

const applicationPath = process.env.PLAYWRIGHT_BASE_PATH ?? "/";

// Handlers run at Playwright actionability/assertion boundaries, including
// direct spec actions. They never consume either modal under acceptance test.
test.beforeEach(async ({ page }, testInfo) => {
  if (!testInfo.tags.includes("@manual-choices"))
    await installIncidentalChoiceHandlers(page);
});

const primeClassChoice = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "wanderer.save.primary",
      JSON.stringify({
        schemaVersion: 2,
        world: {
          seed: "wanderer-known-seed",
          generatorVersion: "wanderer-web-v2",
        },
        player: { position: { x: 0, y: 0 }, hp: 100, maxHp: 100 },
        resources: {
          wood: 120,
          stone: 120,
          scrap: 120,
          essence: 20,
          bossCore: 0,
        },
        buildings: [],
        defeatedBossIds: [],
        upgrades: [],
        nextBuildingSerial: 1,
        committedAt: 0,
        savePointId: "campfire:home",
        savePointPosition: { x: 0, y: 0 },
        classProgression: {
          experience: 6,
          level: 1,
          playerClass: null,
          skillIds: [],
        },
      }),
    );
  });
};

const primeRankedClass = async (
  page: Page,
  playerClass: "knight" | "wizard" | "archer",
  weaponRank: number,
): Promise<void> => {
  await page.addInitScript(
    ({ playerClass: savedClass, weaponRank: savedRank }) => {
      window.localStorage.setItem(
        "wanderer.save.primary",
        JSON.stringify({
          schemaVersion: 2,
          world: {
            seed: "wanderer-known-seed",
            generatorVersion: "wanderer-web-v2",
          },
          player: { position: { x: 0, y: 0 }, hp: 100, maxHp: 100 },
          resources: {
            wood: 120,
            stone: 120,
            scrap: 120,
            essence: 20,
            bossCore: 0,
          },
          buildings: [],
          defeatedBossIds: [],
          upgrades: [],
          nextBuildingSerial: 1,
          committedAt: 0,
          savePointId: "campfire:home",
          savePointPosition: { x: 0, y: 0 },
          classProgression: {
            experience: 300,
            level: 5,
            playerClass: savedClass,
            skillIds: [],
            weaponRank: savedRank,
          },
        }),
      );
    },
    { playerClass, weaponRank },
  );
};

test(
  "gameplay earns the class threshold from a valid 5 XP level-0 save fixture",
  {
    tag: "@manual-choices",
  },
  async ({ page }) => {
    // A supported below-threshold save, NOT a fresh 0-to-6 claim and NOT an
    // already-earned class. No runtime state is written after application boot.
    const saved = JSON.stringify({
      schemaVersion: 2,
      world: {
        seed: "wanderer-known-seed",
        generatorVersion: "wanderer-web-v1",
      },
      player: { position: { x: 0, y: 0 }, hp: 100, maxHp: 100 },
      resources: {
        wood: 120,
        stone: 120,
        scrap: 120,
        essence: 20,
        bossCore: 0,
      },
      buildings: [],
      defeatedBossIds: [],
      upgrades: [],
      nextBuildingSerial: 1,
      committedAt: 1700000000000,
      savePointId: "campfire:home",
      savePointPosition: { x: 0, y: 0 },
      classProgression: {
        experience: 5,
        level: 0,
        playerClass: null,
        skillIds: [],
      },
    });
    const decoded = decodeSave(saved);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error(decoded.message);
    expect(decoded.document.classProgression).toEqual({
      experience: 5,
      level: 0,
      playerClass: null,
      skillIds: [],
      allocatedStats: {
        strength: 0,
        agility: 0,
        vitality: 0,
        magic: 0,
        dexterity: 0,
        luck: 0,
      },
      weaponRank: 0,
    });
    await page.addInitScript(
      ({ key, value }) => window.localStorage.setItem(key, value),
      { key: "wanderer.save.primary", value: saved },
    );
    await page.goto(applicationPath, { waitUntil: "commit" });
    // Start observing at navigation commit rather than waiting for every asset.
    // Observe the visible, below-threshold HUD before waiting for real combat.
    // Missing this precondition fails; the test never reloads/retries until green.
    await expect(
      page.locator('[data-testid="quick-level"]:visible'),
    ).toHaveText("✦ L0 · 5 XP");
    const classModal = page.getByTestId("class-modal");
    await expect(classModal).toBeVisible({ timeout: 8_000 });
    const earned = /L(\d+) · (\d+) XP/.exec(
      await page.getByTestId("quick-level").innerText(),
    );
    if (earned === null) throw new Error("Missing public earned-XP witness");
    expect(Number(earned[1])).toBeGreaterThanOrEqual(1);
    expect(Number(earned[2])).toBeGreaterThanOrEqual(6);
    await expect(page.getByTestId("world-canvas")).toHaveAttribute(
      "data-floor-drop-count",
      /[1-9]/,
    );
    await classModal.getByTestId("class-wizard").click();
    await expect(classModal.getByTestId("class-wizard")).toHaveCount(0);
    await expect(classModal).toBeHidden();
    await openStatus(page);
    await expect(page.getByTestId("class-progression")).toContainText("Wizard");
    await expect(page.getByTestId("save-message")).toContainText(
      "Recovered last explicit campfire save",
    );
    expect(
      await page.evaluate(() => localStorage.getItem("wanderer.save.primary")),
    ).toBe(saved);
  },
);

test("HUD reports the deterministic next-wave schedule", async ({ page }) => {
  await page.goto(applicationPath);
  await openStatus(page);
  await expect(page.getByTestId("wave-status")).toContainText(
    /Next wave in 1(?:[01]\d|20)s/,
  );
});

test(
  "earned experience opens a class choice and the selected class is visible",
  { tag: "@manual-choices" },
  async ({ page }) => {
    await primeClassChoice(page);
    await page.goto(applicationPath);
    const classModal = page.getByTestId("class-modal");
    await expect(classModal).toBeVisible({ timeout: 8_000 });
    await classModal.getByTestId("class-wizard").click();
    await expect(classModal).toBeHidden();
    await openStatus(page);
    await expect(page.getByTestId("class-progression")).toContainText("Wizard");
  },
);

test(
  "Knight attacks render as crescents instead of projectiles",
  { tag: "@manual-choices" },
  async ({ page }) => {
    await primeClassChoice(page);
    await page.goto(applicationPath);
    const classModal = page.getByTestId("class-modal");
    await expect(classModal).toBeVisible({ timeout: 8_000 });
    await classModal.getByTestId("class-knight").click();
    const canvas = page.getByTestId("world-canvas");
    await expect(canvas).toHaveAttribute(
      "data-crescent-attack-count",
      /[1-9]/,
      {
        timeout: 8_000,
      },
    );
    await expect(canvas).toHaveAttribute("data-knight-slash-count", /[1-9]/);
    await expect(canvas).toHaveAttribute("data-projectile-count", "0");
  },
);

test(
  "Mage attacks animate a fireball in flight and an explosion on impact",
  { tag: "@manual-choices" },
  async ({ page }) => {
    await primeClassChoice(page);
    await page.goto(applicationPath);
    const classModal = page.getByTestId("class-modal");
    await expect(classModal).toBeVisible({ timeout: 8_000 });
    await classModal.getByTestId("class-wizard").click();
    const canvas = page.getByTestId("world-canvas");
    await expect(canvas).toHaveAttribute("data-mage-fireball-count", /[1-9]/, {
      timeout: 8_000,
    });
    await expect(canvas).toHaveAttribute("data-mage-explosion-count", /[1-9]/, {
      timeout: 8_000,
    });
  },
);

test(
  "ranked class weapon relics are visible in status and project their attack abilities",
  { tag: "@manual-choices" },
  async ({ page }) => {
    await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
    // Freeze before boot so the level-five Archer cannot clear the nearby
    // deterministic home encounter during a large virtual-time jump.
    await page.clock.pauseAt(new Date("2026-01-01T00:00:00Z"));
    await primeRankedClass(page, "archer", 1);
    await page.goto(applicationPath);
    await page.clock.runFor(16);
    await openStatus(page);
    await expect(page.getByTestId("weapon-relic-status")).toContainText(
      "Twinwind Relic rank 1",
    );
    // Observe actual rendered frames: both arrows may hit between wall-time polls.
    const canvas = page.getByTestId("world-canvas");
    let projectileCount = await canvas.getAttribute("data-projectile-count");
    for (
      let elapsed = 0;
      projectileCount !== "2" && elapsed < 8_000;
      elapsed += 16
    ) {
      await page.clock.runFor(16);
      projectileCount = await canvas.getAttribute("data-projectile-count");
    }
    await expect(canvas).toHaveAttribute("data-projectile-count", "2", {
      timeout: 8_000,
    });
  },
);

test("the icon HUD exposes compact uncapped resources and the current skill tree", async ({
  page,
}) => {
  await page.goto(applicationPath);

  await expect(page.getByTestId("build-Storage")).toHaveCount(0);

  const resourcesToggle = page.getByTestId("resources-toggle");
  await expect(resourcesToggle).toHaveAttribute("aria-label", "Resources");
  await resourcesToggle.click();
  await expect(page.getByTestId("resources-panel")).toBeVisible();
  await expect(page.getByTestId("resources")).toContainText("◫");
  await expect(page.getByTestId("resource-capacity")).toHaveCount(0);

  const skillTreeToggle = page.getByTestId("skill-tree-toggle");
  await expect(skillTreeToggle).toHaveAttribute("aria-label", "Skill Tree");
  await skillTreeToggle.click();
  await expect(page.getByTestId("skill-tree-panel")).toBeVisible();
  await expect(page.getByTestId("skill-tree-summary")).toContainText("Level 0");
  await expect(page.getByTestId("quick-stats")).toContainText("L0");
});

test("the Stats button shows only the eight character stats", async ({
  page,
}) => {
  await page.goto(applicationPath);
  const toggle = page.getByTestId("stats-toggle");
  await expect(toggle).toHaveAttribute("aria-label", "Stats");
  await expect(toggle).toHaveAttribute("aria-controls", "stats-panel");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.getByTestId("stats-panel")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("stats-list")).toHaveText(
    /Strength.*Dexterity.*Agility.*Luck.*Vitality.*Magic.*Defense.*Magic Defense/s,
  );
});

test(
  "stat points are allocated through six primary controls without an implicit save",
  { tag: "@manual-choices" },
  async ({ page }) => {
    await primeClassChoice(page);
    await page.goto(applicationPath);
    const classModal = page.getByTestId("class-modal");
    await expect(classModal).toBeVisible({ timeout: 8_000 });
    await classModal.getByTestId("class-knight").click();
    await expect(classModal).toBeHidden();
    await installIncidentalChoiceHandlers(page);

    const savedBeforeAllocation = await page.evaluate(() =>
      localStorage.getItem("wanderer.save.primary"),
    );
    await page.getByTestId("stats-toggle").click();
    const controls = page.getByTestId("stat-allocation-controls");
    await expect(page.getByTestId("stat-points")).toHaveText(
      "Stat points available: 3",
    );
    await expect(controls.getByRole("button")).toHaveCount(6);
    await expect(page.getByTestId("allocate-stat-defense")).toHaveCount(0);
    const strength = page.getByTestId("allocate-stat-strength");
    await expect(strength).toBeEnabled();
    await expect(strength).toHaveAttribute("data-allocation", "0");
    await strength.click();
    await expect(page.getByTestId("stat-points")).toHaveText(
      "Stat points available: 2",
    );
    await expect(strength).toHaveAttribute("data-allocation", "1");
    await expect(
      page.evaluate(() => localStorage.getItem("wanderer.save.primary")),
    ).resolves.toBe(savedBeforeAllocation);
  },
);

const clickWithPendingUpgradeResolution = async (
  _page: Page,
  target: Locator,
): Promise<void> => {
  await target.click({ timeout: 12_000 });
};

const openStatus = async (page: Page): Promise<void> => {
  const toggle = page.getByTestId("character-status-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  await expect(page.getByTestId("character-status-panel")).toBeVisible();
};

const openBuildMenu = async (page: Page): Promise<void> => {
  const toggle = page.getByTestId("build-menu-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await clickWithPendingUpgradeResolution(page, toggle);
  await expect(page.getByTestId("build-menu-panel")).toBeVisible();
};

const tapCanvas = async (
  page: Page,
  xRatio: number,
  yRatio: number,
  useTouchPointer = false,
): Promise<void> => {
  const canvas = page.getByTestId("world-canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("World canvas was not laid out");
  const position = { x: box.width * xRatio, y: box.height * yRatio };
  if (useTouchPointer) await canvas.tap({ position, timeout: 5_000 });
  else await canvas.click({ position, timeout: 5_000 });
};

test("initial browser load uses compact circular actions with accessible hidden panels", async ({
  page,
}) => {
  await page.goto(applicationPath);
  const canvas = page.getByTestId("world-canvas");
  const buildToggle = page.getByTestId("build-menu-toggle");
  const statusToggle = page.getByTestId("character-status-toggle");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("world-player-hp")).toHaveText("100 / 100 HP");
  await expect(page.getByTestId("virtual-stick")).toHaveCount(0);
  await expect(buildToggle).toHaveAttribute("aria-expanded", "false");
  await expect(statusToggle).toHaveAttribute("aria-expanded", "false");
  await expect(buildToggle).toHaveAttribute(
    "aria-controls",
    "build-menu-panel",
  );
  await expect(statusToggle).toHaveAttribute(
    "aria-controls",
    "character-status-panel",
  );
  await expect(buildToggle).toHaveAccessibleName("Build");
  await expect(statusToggle).toHaveAccessibleName("Character Status");
  // Capture both initial panels in one public DOM read, without observing
  // independent frames between their visibility and native hidden state.
  const initialPanels = await page.evaluate(() =>
    ["build-menu-panel", "character-status-panel"].map((id) => {
      const matches = document.querySelectorAll<HTMLElement>(
        `[data-testid="${id}"]`,
      );
      const panel = matches[0];
      return {
        id,
        count: matches.length,
        hidden: panel?.hidden ?? null,
        display: panel ? getComputedStyle(panel).display : null,
        renderedBoxes: panel?.getClientRects().length ?? null,
      };
    }),
  );
  expect(initialPanels).toEqual(
    ["build-menu-panel", "character-status-panel"].map((id) => ({
      id,
      count: 1,
      hidden: true,
      display: "none",
      renderedBoxes: 0,
    })),
  );
  await expect(page.getByTestId("toggle-status-panel")).toHaveCount(0);
  await expect(page.getByTestId("toggle-world-controls-panel")).toHaveCount(0);
  await expect(page.getByTestId("building-x")).toHaveCount(0);
  await expect(page.getByTestId("building-y")).toHaveCount(0);

  const buildBox = await buildToggle.boundingBox();
  const statusBox = await statusToggle.boundingBox();
  if (buildBox === null || statusBox === null)
    throw new Error("Circular action buttons were not laid out");
  expect(buildBox.width).toBeGreaterThanOrEqual(44);
  expect(buildBox.height).toBeGreaterThanOrEqual(44);
  expect(statusBox.width).toBeGreaterThanOrEqual(44);
  expect(statusBox.height).toBeGreaterThanOrEqual(44);

  await openStatus(page);
  await expect(page.getByTestId("seed")).toContainText("wanderer-known-seed");
  await expect(page.getByTestId("tap-to-move-toggle")).toHaveCount(0);
  await expect(page.getByTestId("save-button")).toBeEnabled();
  await expect(
    page.getByTestId("resources").getByTitle("Wood", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByTestId("resources").getByTitle("Boss Core", { exact: true }),
  ).toHaveCount(1);
  await expect(page.getByTestId("boss-route-cue")).toContainText(
    "boss is 6m east of the home Campfire",
  );
  await expect(page.getByTestId("native-truth-boundary")).toHaveText(
    "Browser MVP evidence only: native Android wrapper/device, APK/AAB, and Google Play evidence are unverified.",
  );

  await openBuildMenu(page);
  await expect(page.getByTestId("build-radius")).toContainText("6m/9m/12m");
  await expect(page.getByTestId("build-radius")).toContainText("3m/4m/5m");
  await expect(page.getByTestId("build-Healer")).toHaveAccessibleName(
    "Place Healing Hut",
  );
});

test("Settings exposes 1×, 2×, and 5× runtime speed controls beneath its tile", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(applicationPath);
  const settings = page.getByTestId("settings-toggle");
  const controls = page.getByTestId("settings-speed-controls");
  const atOne = page.getByTestId("speed-1x");
  const atTwo = page.getByTestId("speed-2x");
  const atFive = page.getByTestId("speed-5x");
  const savedBefore = await page.evaluate(() =>
    localStorage.getItem("wanderer.save.primary"),
  );

  await expect(settings).toHaveAccessibleName("Settings");
  await expect(settings).toHaveAttribute(
    "aria-controls",
    "settings-speed-controls",
  );
  await expect(settings).toHaveAttribute("aria-expanded", "false");
  await expect(controls).toBeHidden();
  const settingsBox = await settings.boundingBox();
  if (settingsBox === null) throw new Error("Settings tile was not laid out");
  expect(settingsBox.width).toBeGreaterThanOrEqual(44);
  expect(settingsBox.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(settingsBox.width - settingsBox.height)).toBeLessThanOrEqual(
    1,
  );

  await settings.click();
  await expect(controls).toBeVisible();
  await expect(settings).toHaveAttribute("aria-expanded", "true");
  await expect(controls).toHaveAccessibleName("Game speed");
  const controlsBox = await controls.boundingBox();
  if (controlsBox === null)
    throw new Error("Settings speed controls were not laid out");
  expect(controlsBox.y).toBeGreaterThanOrEqual(
    settingsBox.y + settingsBox.height,
  );
  await expect(atOne).toHaveAttribute("aria-pressed", "true");
  await expect(atTwo).toHaveAttribute("aria-pressed", "false");
  await expect(atFive).toHaveAttribute("aria-pressed", "false");

  await atTwo.click();
  await expect(atOne).toHaveAttribute("aria-pressed", "false");
  await expect(atTwo).toHaveAttribute("aria-pressed", "true");
  await atFive.click();
  await expect(atTwo).toHaveAttribute("aria-pressed", "false");
  await expect(atFive).toHaveAttribute("aria-pressed", "true");
  await atOne.click();
  await expect(atOne).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(() => localStorage.getItem("wanderer.save.primary")),
  ).toBe(savedBefore);

  await page.getByTestId("character-status-toggle").click();
  await expect(page.getByTestId("character-status-panel")).toBeVisible();
  await page.getByTestId("close-character-status").click();
  await expect(page.getByTestId("character-status-panel")).toBeHidden();
  await page.getByTestId("build-menu-toggle").click();
  await expect(page.getByTestId("build-menu-panel")).toBeVisible();
  await page.getByTestId("close-build-menu").click();
  await expect(page.getByTestId("build-menu-panel")).toBeHidden();
});

test("a present corrupt save is surfaced and left untouched on built-output boot", async ({
  page,
}) => {
  const corruptPrimary = "{not valid JSON";
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: "wanderer.save.primary", value: corruptPrimary },
  );

  await page.goto(applicationPath);
  await openStatus(page);
  await expect(page.getByTestId("save-message")).toContainText(
    "Save was not loaded: Save data is not valid JSON.",
  );
  await expect(
    page.evaluate(
      (key) => window.localStorage.getItem(key),
      "wanderer.save.primary",
    ),
  ).resolves.toBe(corruptPrimary);
});

test("ordinary primary canvas taps travel to a marked destination when no build mode is active", async ({
  page,
}, testInfo: TestInfo) => {
  await page.goto(applicationPath);
  await openStatus(page);
  const position = page.getByTestId("position");
  const initialPosition = await position.textContent();
  if (initialPosition === null)
    throw new Error("World position text was not available");
  const initialCoordinates =
    /^Position: (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)/.exec(initialPosition);
  if (initialCoordinates === null)
    throw new Error("World position coordinates were not available");

  await clickWithPendingUpgradeResolution(
    page,
    page.getByTestId("close-character-status"),
  );
  // Capture public DOM changes before the real tap without giving the observer
  // an independent deadline that can reject while the action is still settling.
  const movingTapObserver = await page.evaluateHandle(
    (initial) => {
      const state: {
        witness: null | {
          readonly marker: string | null;
          readonly input: string;
          readonly combat: string;
          readonly x: number;
          readonly y: number;
        };
        resolve?: (witness: NonNullable<typeof state.witness>) => void;
        observer: MutationObserver;
      } = {
        witness: null,
        observer: new MutationObserver(() => capture()),
      };
      const capture = () => {
        const canvas = document.querySelector('[data-testid="world-canvas"]');
        const position = document.querySelector('[data-testid="position"]');
        const combat = document.querySelector('[data-testid="combat-status"]');
        const input = position?.textContent ?? "";
        const match = /^Position: (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)/.exec(
          input,
        );
        if (
          state.witness === null &&
          canvas?.getAttribute("data-destination-marker") === "active" &&
          input.includes("input: tap-to-move") &&
          combat?.textContent?.includes("suppressed") &&
          match !== null &&
          (Number(match[1]) !== initial.x || Number(match[2]) !== initial.y)
        ) {
          state.witness = {
            marker: canvas.getAttribute("data-destination-marker"),
            input,
            combat: combat.textContent,
            x: Number(match[1]),
            y: Number(match[2]),
          };
          state.resolve?.(state.witness);
        }
      };
      state.observer.observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      capture();
      return state;
    },
    { x: Number(initialCoordinates[1]), y: Number(initialCoordinates[2]) },
  );
  try {
    await tapCanvas(page, 0.4, 0.62);
    const witness = await movingTapObserver.evaluate(
      (state) =>
        new Promise<NonNullable<typeof state.witness>>((resolve, reject) => {
          if (state.witness !== null) return resolve(state.witness);
          const timeout = window.setTimeout(
            () => reject(new Error("Moving tap frame was not observed")),
            5_000,
          );
          state.resolve = (captured) => {
            window.clearTimeout(timeout);
            resolve(captured);
          };
        }),
    );
    expect(witness.marker).toBe("active");
    expect(witness.input).toContain("input: tap-to-move");
    expect(witness.combat).toContain("suppressed");
    expect(
      witness.x !== Number(initialCoordinates[1]) ||
        witness.y !== Number(initialCoordinates[2]),
    ).toBe(true);
    await testInfo.attach("moving-tap-public-witness.json", {
      body: JSON.stringify({
        initial: {
          x: Number(initialCoordinates[1]),
          y: Number(initialCoordinates[2]),
        },
        witness,
      }),
      contentType: "application/json",
    });
    console.log(
      `moving-tap public witness: ${JSON.stringify({
        initial: {
          x: Number(initialCoordinates[1]),
          y: Number(initialCoordinates[2]),
        },
        witness,
      })}`,
    );
  } finally {
    await movingTapObserver.evaluate((state) => state.observer.disconnect());
    await movingTapObserver.dispose();
  }
  await expect(position).not.toHaveText(initialPosition);
});

test("completed lethal projectiles leave visible renderer-owned floor drops without an implicit save", async ({
  page,
}) => {
  await page.goto(applicationPath);
  await openStatus(page);
  const canvas = page.getByTestId("world-canvas");
  await expect(canvas).toHaveAttribute("data-floor-drop-count", /[1-9]/, {
    timeout: 4_000,
  });
  await expect(
    page.getByTestId("resources").getByTitle("Wood", { exact: true }),
  ).toHaveAttribute("aria-label", "Wood: 120");
  await expect(page.getByTestId("save-message")).toContainText(
    "Fresh runtime: no committed save loaded.",
  );
});

test("enemy hits visibly flash the player during a finite recovery window", async ({
  page,
}) => {
  // GameSession caps frame deltas: wall time cannot measure simulation expiry.
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.goto(applicationPath);
  await page.clock.pauseAt(new Date("2026-01-01T00:01:00Z"));
  const canvas = page.getByTestId("world-canvas");
  const recoveryState = () =>
    canvas.evaluate(
      (element) =>
        `${element.getAttribute("data-player-hit-recovery")}:${element.getAttribute("data-player-hit-flash")}`,
    );
  let state = await recoveryState();
  for (
    let elapsed = 0;
    state !== "active:on" && elapsed < 12_000;
    elapsed += 50
  ) {
    await page.clock.runFor(50);
    state = await recoveryState();
  }
  expect(state).toBe("active:on");
  for (
    let elapsed = 0;
    state !== "inactive:off" && elapsed < 1_000;
    elapsed += 50
  ) {
    await page.clock.runFor(50);
    state = await recoveryState();
  }
  expect(state).toBe("inactive:off");
});

test("a Healing Hut is selected and placed through the canvas without moving the player", async ({
  page,
}, testInfo: TestInfo) => {
  test.setTimeout(60_000);
  await page.goto(applicationPath);
  await openStatus(page);
  await openBuildMenu(page);
  const resources = page.getByTestId("resources");
  const position = page.getByTestId("position");
  const beforePosition = await position.textContent();
  const beforeResources = await resources.textContent();
  if (beforePosition === null || beforeResources === null)
    throw new Error("Initial player state was not available");

  await clickWithPendingUpgradeResolution(
    page,
    page.getByTestId("build-Healer"),
  );
  await expect(page.getByTestId("character-status-panel")).toBeHidden();
  await expect(page.getByTestId("placement-mode")).toContainText(
    "Healing Hut selected",
  );
  await expect(page.getByTestId("cancel-placement")).toBeVisible();
  await tapCanvas(page, 0.5, 0.5, testInfo.project.name === "touch");

  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await expect(page.getByTestId("placement-message")).toContainText(
    "Healing Hut placed",
  );
  await expect(page.getByTestId("building-list")).toContainText(
    "Healing Hut L1",
  );
  await expect(page.getByTestId("building-list")).toContainText(
    "Healing aura: 3m radius",
  );
  await expect(resources).not.toHaveText(beforeResources);
  await expect(position).toHaveText(beforePosition);
  await expect(page.getByTestId("world-canvas")).toHaveAttribute(
    "data-healing-hut-aura-count",
    "1",
  );
  await expect(page.getByTestId("world-canvas")).toHaveAttribute(
    "data-healing-hut-aura-radii",
    "3",
  );

  await openBuildMenu(page);
  const hutRow = page
    .getByTestId("building-list")
    .locator(".building-row")
    .filter({ hasText: "Healing Hut" });
  await clickWithPendingUpgradeResolution(
    page,
    hutRow.getByRole("button", { name: "Upgrade" }),
  );
  await expect(hutRow).toContainText("Healing aura: 4m radius");
  await expect(page.getByTestId("world-canvas")).toHaveAttribute(
    "data-healing-hut-aura-radii",
    "4",
  );
  await clickWithPendingUpgradeResolution(
    page,
    hutRow.getByRole("button", { name: "Upgrade" }),
  );
  await expect(hutRow).toContainText("Healing aura: 5m radius");
  await expect(page.getByTestId("world-canvas")).toHaveAttribute(
    "data-healing-hut-aura-radii",
    "5",
  );

  await page.reload();
  await openBuildMenu(page);
  await expect(page.getByTestId("building-list")).toBeEmpty();
});

test("invalid canvas placement remains selected, non-mutating, and explains the rejection", async ({
  page,
}, testInfo: TestInfo) => {
  test.setTimeout(60_000);
  await page.goto(applicationPath);
  await openStatus(page);
  await openBuildMenu(page);
  const resources = page.getByTestId("resources");
  await clickWithPendingUpgradeResolution(
    page,
    page.getByTestId("build-Workshop"),
  );
  await tapCanvas(page, 0.5, 0.5, testInfo.project.name === "touch");
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  const before = await resources.textContent();
  if (before === null)
    throw new Error("Workshop placement did not update resources");

  await openBuildMenu(page);
  await clickWithPendingUpgradeResolution(
    page,
    page.getByTestId("build-Healer"),
  );
  await expect(page.getByTestId("character-status-panel")).toBeHidden();
  await tapCanvas(page, 0.5, 0.5, testInfo.project.name === "touch");
  await expect(page.getByTestId("placement-message")).toContainText(
    "Building action rejected",
  );
  await expect(page.getByTestId("placement-message")).toContainText(
    "overlaps an existing building",
  );
  await expect(page.getByTestId("placement-mode")).toContainText(
    "Healing Hut selected",
  );
  await expect(page.getByTestId("building-list")).toContainText("Workshop L1");
  await expect(page.getByTestId("building-list")).not.toContainText(
    "Healing Hut L1",
  );
  await expect(resources).toHaveText(before);
});

test("status and build circle actions independently open and close their panels", async ({
  page,
}) => {
  await page.goto(applicationPath);
  const statusPanel = page.getByTestId("character-status-panel");
  const buildPanel = page.getByTestId("build-menu-panel");
  const statusToggle = page.getByTestId("character-status-toggle");
  const buildToggle = page.getByTestId("build-menu-toggle");

  await statusToggle.click();
  await expect(statusPanel).toBeVisible();
  await expect(statusToggle).toHaveAttribute("aria-expanded", "true");
  await buildToggle.click();
  await expect(buildPanel).toBeVisible();
  await expect(buildToggle).toHaveAttribute("aria-expanded", "true");

  await statusToggle.click();
  await expect(statusPanel).toBeHidden();
  await expect(buildPanel).toBeVisible();
  await buildToggle.click();
  await expect(buildPanel).toBeHidden();
  await expect(page.getByTestId("world-canvas")).toBeVisible();
  await expect(page.getByTestId("virtual-stick")).toHaveCount(0);
});

test("new Storage is unavailable while released legacy Storage remains visible and inactive", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "wanderer.save.primary",
      JSON.stringify({
        schemaVersion: 2,
        world: {
          seed: "wanderer-known-seed",
          generatorVersion: "wanderer-web-v2",
        },
        player: { position: { x: 0, y: 0 }, hp: 100, maxHp: 100 },
        resources: {
          wood: 480,
          stone: 180,
          scrap: 180,
          essence: 180,
          bossCore: 4,
        },
        buildings: [
          {
            id: "building:legacy:0001",
            kind: "Storage",
            position: { x: 1, y: 1 },
            level: 1,
          },
        ],
        defeatedBossIds: [],
        upgrades: [],
        nextBuildingSerial: 2,
        committedAt: 0,
        savePointId: "campfire:home",
        savePointPosition: { x: 0, y: 0 },
      }),
    );
  });
  await page.goto(applicationPath);
  await openBuildMenu(page);
  await expect(page.getByTestId("build-Storage")).toHaveCount(0);
  const legacyRow = page
    .getByTestId("building-list")
    .locator(".building-row")
    .filter({ hasText: "Legacy Storage L1" });
  await expect(legacyRow).toHaveCount(1);
  await expect(
    legacyRow.getByRole("button", { name: "Upgrade" }),
  ).toBeDisabled();
  await expect(
    legacyRow.getByRole("button", { name: "Relocate on canvas" }),
  ).toBeDisabled();
  await expect(
    legacyRow.getByRole("button", { name: "Demolish" }),
  ).toBeEnabled();
  await expect(
    page.getByTestId("resources").getByTitle("Wood", { exact: true }),
  ).toHaveAttribute("aria-label", "Wood: 480");
  await expect(page.getByTestId("resource-capacity")).toHaveCount(0);
});

test("keyboard movement retains the stationary auto-attack gate", async ({
  page,
}) => {
  await page.goto(applicationPath);
  await openStatus(page);
  const combat = page.getByTestId("combat-status");
  await page.keyboard.down("d");
  await page.waitForTimeout(180);
  await expect(combat).toContainText("suppressed");
  await page.keyboard.up("d");
  await page.waitForTimeout(650);
  await expect(combat).toContainText("Auto-attacking");
});

test("visible campfire save commits and later unsaved movement rolls back on reload", async ({
  page,
}) => {
  await page.goto(applicationPath);
  await openStatus(page);
  await clickWithPendingUpgradeResolution(
    page,
    page.getByTestId("save-button"),
  );
  await expect(page.getByTestId("save-message")).toContainText(
    "Saved explicitly",
  );

  await page.keyboard.down("d");
  await page.waitForTimeout(500);
  await page.keyboard.up("d");
  await expect(page.getByTestId("position")).not.toContainText(
    "Position: 0.0, 0.0",
  );
  await page.reload();
  await openStatus(page);
  await expect(page.getByTestId("save-message")).toContainText(
    "Recovered last explicit campfire save",
  );
  await expect(page.getByTestId("position")).toContainText(
    "Position: 0.0, 0.0",
  );
});

test(
  "a valid V4 level-25 save exposes its chosen class route",
  { tag: "@manual-choices" },
  async ({ page }) => {
    const level25BossRouteSave = {
      schemaVersion: 4,
      world: {
        seed: "wanderer-known-seed",
        generatorVersion: "wanderer-web-v2",
      },
      player: { position: { x: 0, y: 0 }, hp: 100, maxHp: 100 },
      resources: {
        wood: 120,
        stone: 120,
        scrap: 120,
        essence: 20,
        bossCore: 0,
      },
      buildings: [],
      defeatedBossIds: [],
      upgrades: [],
      nextBuildingSerial: 1,
      committedAt: 0,
      savePointId: "campfire:home",
      savePointPosition: { x: 0, y: 0 },
      classProgression: {
        experience: 6100,
        level: 25,
        playerClass: "wizard",
        skillIds: [
          "wizard-flame-orb",
          "wizard-arcane-haste",
          "wizard-nova",
          "wizard-meteor",
          "wizard-boss-5",
        ],
        allocatedStats: {
          strength: 0,
          dexterity: 0,
          agility: 0,
          luck: 0,
          vitality: 0,
          magic: 0,
        },
        weaponRank: 0,
      },
    };
    expect(decodeSave(JSON.stringify(level25BossRouteSave)).ok).toBe(true);
    await page.addInitScript(
      ({ key, value }) => window.localStorage.setItem(key, value),
      {
        key: "wanderer.save.primary",
        value: JSON.stringify(level25BossRouteSave),
      },
    );

    await page.goto(applicationPath);
    const classModal = page.getByTestId("class-modal");
    await expect(classModal).toBeVisible();
    await expect(page.getByTestId("class-modal-description")).toContainText(
      "Continue your Boss route",
    );
    await expect(
      classModal.getByTestId("class-skill-wizard-boss-6"),
    ).toHaveCount(1);
    await expect(
      classModal.getByTestId("class-skill-wizard-aoe-6"),
    ).toHaveCount(0);
    await classModal.getByTestId("class-skill-wizard-boss-6").click();
    await expect(
      classModal.getByTestId("class-skill-wizard-boss-7"),
    ).toHaveCount(1);
    await expect(
      classModal.getByTestId("class-skill-wizard-aoe-7"),
    ).toHaveCount(0);
  },
);

test(
  "a complete V4 level-25 route saves and reloads without reopening a choice",
  { tag: "@manual-choices" },
  async ({ page }) => {
    const skillIds = [
      "wizard-flame-orb",
      "wizard-arcane-haste",
      "wizard-nova",
      "wizard-meteor",
      ...Array.from({ length: 20 }, (_, index) => `wizard-boss-${index + 5}`),
    ];
    const completeLevel25BossRouteSave = {
      schemaVersion: 4,
      world: {
        seed: "wanderer-known-seed",
        generatorVersion: "wanderer-web-v2",
      },
      player: { position: { x: 0, y: 0 }, hp: 100, maxHp: 100 },
      resources: {
        wood: 120,
        stone: 120,
        scrap: 120,
        essence: 20,
        bossCore: 0,
      },
      buildings: [],
      defeatedBossIds: [],
      upgrades: [],
      nextBuildingSerial: 1,
      committedAt: 0,
      savePointId: "campfire:home",
      savePointPosition: { x: 0, y: 0 },
      classProgression: {
        experience: 6100,
        level: 25,
        playerClass: "wizard",
        skillIds,
        allocatedStats: {
          strength: 0,
          dexterity: 0,
          agility: 0,
          luck: 0,
          vitality: 0,
          magic: 0,
        },
        weaponRank: 0,
      },
    };
    expect(decodeSave(JSON.stringify(completeLevel25BossRouteSave)).ok).toBe(
      true,
    );
    await page.addInitScript(
      ({ key, value }) => window.localStorage.setItem(key, value),
      {
        key: "wanderer.save.primary",
        value: JSON.stringify(completeLevel25BossRouteSave),
      },
    );

    await page.goto(applicationPath);
    await expect(page.getByTestId("class-modal")).toBeHidden();
    const upgradeModal = page.getByTestId("upgrade-modal");
    await page.addLocatorHandler(
      upgradeModal,
      async (modal) => {
        const choices = modal.getByRole("button");
        await expect(choices).toHaveCount(3);
        const choice = choices.first();
        await choice.click();
      },
      { noWaitAfter: true },
    );
    await openStatus(page);
    await expect(page.getByTestId("class-progression")).toContainText(
      "level 25 · Wizard",
    );
    await page.getByTestId("save-button").click();
    await expect(upgradeModal).toBeHidden();
    await expect(page.getByTestId("save-message")).toContainText(
      "Saved explicitly",
    );
    const committed = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("wanderer.save.primary") ?? "{}"),
    );
    expect(committed).toMatchObject({
      schemaVersion: 4,
      classProgression: {
        level: 25,
        playerClass: "wizard",
        skillIds,
      },
    });
    await page.getByTestId("skill-tree-toggle").click();
    await expect(page.getByTestId("skill-tree-summary")).toContainText(
      "24/24 class skills selected · Boss route",
    );
    await expect(page.getByTestId("skill-tree-skills")).toContainText(
      "T24 · Boss · Worldfire Meteor: selected",
    );
    await page.reload();
    await expect(page.getByTestId("class-modal")).toBeHidden();
    await openStatus(page);
    await page.getByTestId("skill-tree-toggle").click();
    await expect(page.getByTestId("skill-tree-summary")).toContainText(
      "24/24 class skills selected · Boss route",
    );
  },
);

test(
  "an explicit campfire save reloads the XP-derived level, chosen class, and exact skills",
  { tag: "@manual-choices" },
  async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      if (window.localStorage.getItem("wanderer.save.primary") !== null) return;
      window.localStorage.setItem(
        "wanderer.save.primary",
        JSON.stringify({
          schemaVersion: 2,
          world: {
            seed: "wanderer-known-seed",
            generatorVersion: "wanderer-web-v2",
          },
          player: { position: { x: 0, y: 0 }, hp: 100, maxHp: 100 },
          resources: {
            wood: 120,
            stone: 120,
            scrap: 120,
            essence: 20,
            bossCore: 0,
          },
          buildings: [],
          defeatedBossIds: [],
          upgrades: [],
          nextBuildingSerial: 1,
          committedAt: 0,
          savePointId: "campfire:home",
          savePointPosition: { x: 0, y: 0 },
          classProgression: {
            experience: 50,
            level: 0,
            playerClass: null,
            skillIds: [],
          },
        }),
      );
    });
    await page.goto(applicationPath);
    const classModal = page.getByTestId("class-modal");
    await expect(classModal).toBeVisible();
    await classModal.getByTestId("class-wizard").click();
    await classModal.getByTestId("class-skill-wizard-flame-orb").click();
    await classModal.getByTestId("class-skill-wizard-arcane-haste").click();
    await expect(classModal).toBeHidden();

    // Class and skill selections above are the manual choices under test. A
    // live boss reward can surface immediately afterwards, so resolve only
    // that incidental public choice before it can block the explicit save.
    const upgradeModal = page.getByTestId("upgrade-modal");
    await page.addLocatorHandler(
      upgradeModal,
      async (modal) => {
        const choices = page.getByTestId("upgrade-choices");
        const key = await choices.getAttribute("data-choice-key");
        if (!key) throw new Error("Boss choice lacks public key");
        await expect(modal.getByRole("button")).toHaveCount(3);
        const choice = modal.getByRole("button").first();
        const id = await choice.getAttribute("data-testid");
        if (!id) throw new Error("Boss choice lacks public identity");
        await choice.click();
      },
      { noWaitAfter: true },
    );

    await openStatus(page);
    await expect(page.getByTestId("class-progression")).toContainText(
      "level 3 · Wizard",
    );
    await clickWithPendingUpgradeResolution(
      page,
      page.getByTestId("save-button"),
    );
    await expect(upgradeModal).toBeHidden();
    await expect(page.getByTestId("save-message")).toContainText(
      "Saved explicitly",
    );
    const committed = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("wanderer.save.primary") ?? "{}"),
    );
    expect(committed.classProgression).toMatchObject({
      level: 3,
      playerClass: "wizard",
      skillIds: ["wizard-flame-orb", "wizard-arcane-haste"],
      weaponRank: 0,
    });
    expect(committed.classProgression.experience).toBeGreaterThanOrEqual(50);

    await page.reload();
    await openStatus(page);
    await expect(page.getByTestId("class-progression")).toContainText(
      "level 3 · Wizard",
    );
    await page.getByTestId("skill-tree-toggle").click();
    await expect(page.getByTestId("skill-tree-summary")).toContainText("2/24");
    await expect(page.getByTestId("skill-tree-skills")).toContainText(
      "Flame Orb: selected",
    );
    await expect(page.getByTestId("skill-tree-skills")).toContainText(
      "Arcane Haste: selected",
    );
    await expect(
      page.evaluate(() =>
        JSON.parse(
          window.localStorage.getItem("wanderer.save.primary") ?? "{}",
        ),
      ),
    ).resolves.toMatchObject({ classProgression: committed.classProgression });
  },
);

test(
  "public keyboard play defeats the real boss, selects one upgrade, and never saves implicitly",
  { tag: "@manual-choices" },
  async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(applicationPath);
    await openStatus(page);
    const saveMessage = page.getByTestId("save-message");
    const position = page.getByTestId("position");
    const combat = page.getByTestId("combat-status");
    const modal = page.getByTestId("upgrade-modal");
    const resources = page.getByTestId("resources");

    await expect(saveMessage).toContainText(
      "Fresh runtime: no committed save loaded.",
    );
    await page.keyboard.down("d");
    await expect(position).toContainText("input: keyboard");
    await page.waitForTimeout(1_000);
    await page.keyboard.up("d");
    await expect(combat).toContainText("Auto-attacking");

    await expect
      .poll(
        async () => {
          await choosePendingClassChoicesIfOpen(page);
          return modal.isVisible();
        },
        { timeout: 30_000, intervals: [100, 250, 500] },
      )
      .toBe(true);
    const choices = modal.getByRole("button");
    await expect(choices).toHaveCount(3);
    const choiceIds = await choices.evaluateAll((buttons) =>
      buttons.map((button) => button.dataset.testid),
    );
    expect(new Set(choiceIds).size).toBe(3);
    await page.mouse.click(8, 8);
    await expect(modal).toBeVisible();
    const selectedUpgradeLabel = (await choices.first().innerText()).split(
      ":",
    )[0];

    await choices.first().click();
    await expect(modal).toBeHidden();
    await openBuildMenu(page);
    await expect(page.getByTestId("effects")).toContainText(
      selectedUpgradeLabel,
    );
    await expect(
      resources.getByTitle("Boss Core", { exact: true }),
    ).toHaveCount(1);
    await expect(saveMessage).toContainText(
      "Fresh runtime: no committed save loaded.",
    );

    await page.reload();
    await openStatus(page);
    await expect(saveMessage).toContainText(
      "Fresh runtime: no committed save loaded.",
    );
    await expect(
      resources.getByTitle("Boss Core", { exact: true }),
    ).toHaveAttribute("aria-label", "Boss Core: 0");
    await expect(modal).toBeHidden();
  },
);
