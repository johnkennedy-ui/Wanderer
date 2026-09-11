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
          experience: 30,
          level: 1,
          playerClass: null,
          skillIds: [],
        },
      }),
    );
  });
};

const checkWithPendingClassResolution = async (
  _page: Page,
  target: Locator,
): Promise<void> => {
  await target.check({ timeout: 5_000 });
};

test(
  "gameplay earns the class threshold from a valid 29 XP level-0 save fixture",
  {
    tag: "@manual-choices",
  },
  async ({ page }) => {
    // A supported below-threshold save, NOT a fresh 0-to-30 claim and NOT an
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
        experience: 29,
        level: 0,
        playerClass: null,
        skillIds: [],
      },
    });
    const decoded = decodeSave(saved);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error(decoded.message);
    expect(decoded.document.classProgression).toEqual({
      experience: 29,
      level: 0,
      playerClass: null,
      skillIds: [],
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
    ).toHaveText("✦ L0 · 29 XP");
    const classModal = page.getByTestId("class-modal");
    await expect(classModal).toBeVisible({ timeout: 8_000 });
    const earned = /L(\d+) · (\d+) XP/.exec(
      await page.getByTestId("quick-level").innerText(),
    );
    if (earned === null) throw new Error("Missing public earned-XP witness");
    expect(Number(earned[1])).toBeGreaterThanOrEqual(1);
    expect(Number(earned[2])).toBeGreaterThanOrEqual(30);
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
  "earned experience opens a class choice and the selected class is visible after reload",
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
    await expect(canvas).toHaveAttribute("data-projectile-count", "0");
  },
);

test("the icon HUD exposes compact resources and the current skill tree", async ({
  page,
}) => {
  await page.goto(applicationPath);

  const storage = page.getByTestId("build-Storage");
  await expect(storage).toHaveAttribute("aria-label", "Place Storage");
  await expect(storage).toHaveText("▣");

  const resourcesToggle = page.getByTestId("resources-toggle");
  await expect(resourcesToggle).toHaveAttribute("aria-label", "Resources");
  await resourcesToggle.click();
  await expect(page.getByTestId("resources-panel")).toBeVisible();
  await expect(page.getByTestId("resources")).toContainText("◫");
  await expect(page.getByTestId("resource-capacity")).toContainText("Capacity");

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

const clickWithPendingUpgradeResolution = async (
  _page: Page,
  target: Locator,
): Promise<void> => {
  await target.click({ timeout: 5_000 });
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
  await expect(page.getByTestId("virtual-stick")).toBeVisible();
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
  await expect(page.getByTestId("build-menu-panel")).toBeHidden();
  await expect(page.getByTestId("character-status-panel")).toBeHidden();
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
  await expect(page.getByTestId("tap-to-move-toggle")).not.toBeChecked();
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

test("enabled primary canvas taps travel to a destination when no build mode is active", async ({
  page,
}) => {
  await page.goto(applicationPath);
  await openStatus(page);
  const position = page.getByTestId("position");
  const toggle = page.getByTestId("tap-to-move-toggle");
  const initialPosition = await position.textContent();
  if (initialPosition === null)
    throw new Error("World position text was not available");

  await checkWithPendingClassResolution(page, toggle);
  await clickWithPendingUpgradeResolution(
    page,
    page.getByTestId("close-character-status"),
  );
  await tapCanvas(page, 0.4, 0.62);
  // The incidental Boss Core handler may legitimately run after the tap. Read
  // the public position text without another locator action so that handler
  // does not delay observation until the short tap-to-move interval has ended.
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="position"]')
        ?.textContent?.includes("input: tap-to-move") ?? false,
    undefined,
    { timeout: 5_000 },
  );
  await expect(page.getByTestId("combat-status")).toContainText("suppressed");
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
  await page.goto(applicationPath);
  const canvas = page.getByTestId("world-canvas");
  await expect
    .poll(
      async () =>
        `${await canvas.getAttribute("data-player-hit-recovery")}:${await canvas.getAttribute("data-player-hit-flash")}`,
      {
        intervals: [50, 50, 100],
        timeout: 12_000,
      },
    )
    .toBe("active:on");
  await expect
    .poll(() => canvas.getAttribute("data-player-hit-recovery"), {
      intervals: [50, 50, 100],
      timeout: 1_000,
    })
    .toBe("inactive");
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

  await checkWithPendingClassResolution(
    page,
    page.getByTestId("tap-to-move-toggle"),
  );
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
    page.getByTestId("build-Storage"),
  );
  await tapCanvas(page, 0.5, 0.5, testInfo.project.name === "touch");
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  const before = await resources.textContent();
  if (before === null)
    throw new Error("Storage placement did not update resources");

  await openBuildMenu(page);
  await clickWithPendingUpgradeResolution(
    page,
    page.getByTestId("build-Workshop"),
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
    "Workshop selected",
  );
  await expect(page.getByTestId("building-list")).toContainText("Storage L1");
  await expect(page.getByTestId("building-list")).not.toContainText(
    "Workshop L1",
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
  await expect(page.getByTestId("virtual-stick")).toBeVisible();
});

test("Storage exposes an enforced common-material capacity while Boss Core is exempt", async ({
  page,
}) => {
  await page.goto(applicationPath);
  await openStatus(page);
  await openBuildMenu(page);
  await clickWithPendingUpgradeResolution(
    page,
    page.getByTestId("build-Storage"),
  );
  await tapCanvas(page, 0.5, 0.5);
  await expect(page.getByTestId("resource-capacity")).toHaveText(
    "Capacity 180 each; Boss Core is exempt.",
  );
  await expect(page.getByTestId("effects")).toContainText(
    "Boss Core is exempt",
  );
});

test("keyboard movement and touch-stick movement share the stationary auto-attack gate", async ({
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

  const stick = page.getByTestId("virtual-stick");
  const box = await stick.boundingBox();
  if (box === null) throw new Error("Virtual stick was not laid out");
  await stick.dispatchEvent("pointerdown", {
    pointerId: 1,
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
  });
  await stick.dispatchEvent("pointermove", {
    pointerId: 1,
    clientX: box.x + box.width - 8,
    clientY: box.y + box.height / 2,
  });
  await page.waitForTimeout(100);
  await expect(stick).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("position")).toContainText("virtual-stick");
  await expect(combat).toContainText("suppressed");
  await stick.dispatchEvent("pointerup", {
    pointerId: 1,
    clientX: box.x + box.width - 8,
    clientY: box.y + box.height / 2,
  });
  await expect(stick).toHaveAttribute("data-active", "false");
  await expect(combat).toContainText("Auto-attacking");
});

test("virtual-stick short drag, cancellation, capture loss, and blur safely clear movement", async ({
  page,
}) => {
  await page.goto(applicationPath);
  await openStatus(page);
  const combat = page.getByTestId("combat-status");
  const stick = page.getByTestId("virtual-stick");
  const box = await stick.boundingBox();
  if (box === null) throw new Error("Virtual stick was not laid out");
  const right = {
    clientX: box.x + box.width - 8,
    clientY: box.y + box.height / 2,
  };
  const center = {
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
  };
  const shortRight = {
    clientX: box.x + box.width * 0.55,
    clientY: box.y + box.height / 2,
  };

  await stick.dispatchEvent("pointerdown", { pointerId: 11, ...shortRight });
  await expect(stick).toHaveAttribute("data-active", "true");
  await expect(combat).toContainText("suppressed");
  await stick.dispatchEvent("pointerup", { pointerId: 11, ...shortRight });
  await expect(stick).toHaveAttribute("data-active", "false");
  await expect(combat).toContainText("Auto-attacking");

  await stick.dispatchEvent("pointerdown", { pointerId: 12, ...center });
  await expect(stick).toHaveAttribute("data-active", "false");
  await stick.dispatchEvent("pointermove", { pointerId: 12, ...right });
  await expect(stick).toHaveAttribute("data-active", "true");
  await expect(combat).toContainText("suppressed");
  await stick.dispatchEvent("pointercancel", { pointerId: 12, ...right });
  await expect(stick).toHaveAttribute("data-active", "false");
  await expect(combat).toContainText("Auto-attacking");

  await stick.dispatchEvent("pointerdown", { pointerId: 13, ...right });
  await expect(stick).toHaveAttribute("data-active", "true");
  await stick.dispatchEvent("lostpointercapture", {
    pointerId: 13,
    ...right,
  });
  await expect(stick).toHaveAttribute("data-active", "false");
  await expect(combat).toContainText("Auto-attacking");

  await stick.dispatchEvent("pointerdown", { pointerId: 14, ...right });
  await expect(stick).toHaveAttribute("data-active", "true");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(stick).toHaveAttribute("data-active", "false");
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
