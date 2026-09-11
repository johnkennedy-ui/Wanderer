import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

const applicationPath = process.env.PLAYWRIGHT_BASE_PATH ?? "/";

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

const choosePendingClassChoicesIfOpen = async (
  page: Page,
): Promise<boolean> => {
  const classModal = page.getByTestId("class-modal");
  let selected = false;
  for (let selection = 0; selection < 4; selection += 1) {
    if (!(await classModal.isVisible())) return selected;
    const wizard = classModal.getByTestId("class-wizard");
    if ((await wizard.count()) === 1) await wizard.click();
    else await classModal.getByRole("button").first().click();
    selected = true;
    await page.waitForTimeout(25);
  }
  return selected;
};

const choosePendingUpgradeIfOpen = async (page: Page): Promise<boolean> => {
  const modal = page.getByTestId("upgrade-modal");
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await choosePendingClassChoicesIfOpen(page)) continue;
    if (!(await modal.isVisible())) return false;
    try {
      await modal.getByRole("button").first().click({ timeout: 1_000 });
      await expect(modal).toBeHidden({ timeout: 1_000 });
      return true;
    } catch {
      await page.waitForTimeout(25);
    }
  }
  return false;
};

const hasPendingChoice = async (page: Page): Promise<boolean> =>
  (await page.getByTestId("class-modal").isVisible()) ||
  (await page.getByTestId("upgrade-modal").isVisible());

test("HUD reports the deterministic next-wave schedule", async ({ page }) => {
  await page.goto(applicationPath);
  await openStatus(page);
  await expect(page.getByTestId("wave-status")).toContainText(
    /Next wave in 1(?:[01]\d|20)s/,
  );
});

test("earned experience opens a class choice and the selected class is visible", async ({
  page,
}) => {
  await primeClassChoice(page);
  await page.goto(applicationPath);
  const classModal = page.getByTestId("class-modal");
  await expect(classModal).toBeVisible({ timeout: 8_000 });
  await classModal.getByTestId("class-wizard").click();
  await expect(classModal).toBeHidden();
  await openStatus(page);
  await expect(page.getByTestId("class-progression")).toContainText("Wizard");
});

test("Knight attacks render as crescents instead of projectiles", async ({
  page,
}) => {
  await primeClassChoice(page);
  await page.goto(applicationPath);
  const classModal = page.getByTestId("class-modal");
  await expect(classModal).toBeVisible({ timeout: 8_000 });
  await classModal.getByTestId("class-knight").click();
  const canvas = page.getByTestId("world-canvas");
  await expect(canvas).toHaveAttribute("data-crescent-attack-count", /[1-9]/, {
    timeout: 8_000,
  });
  await expect(canvas).toHaveAttribute("data-projectile-count", "0");
});

test("ranked class weapon relics are visible in status and project their attack abilities", async ({
  page,
}) => {
  await primeRankedClass(page, "archer", 1);
  await page.goto(applicationPath);
  await openStatus(page);
  await expect(page.getByTestId("weapon-relic-status")).toContainText(
    "Twinwind Relic rank 1",
  );
  await expect(page.getByTestId("world-canvas")).toHaveAttribute(
    "data-projectile-count",
    "2",
    { timeout: 8_000 },
  );
});

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

const clickWithPendingUpgradeResolution = async (
  page: Page,
  target: Locator,
): Promise<void> => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await choosePendingUpgradeIfOpen(page);
    try {
      await target.click({ timeout: 5_000 });
      return;
    } catch (error) {
      if (!(await hasPendingChoice(page))) throw error;
    }
  }
  throw new Error(
    "A pending class or Boss Core choice kept the action blocked.",
  );
};

const openStatus = async (page: Page): Promise<void> => {
  const toggle = page.getByTestId("character-status-toggle");
  await choosePendingUpgradeIfOpen(page);
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  await expect(page.getByTestId("character-status-panel")).toBeVisible();
};

const openBuildMenu = async (page: Page): Promise<void> => {
  await choosePendingClassChoicesIfOpen(page);
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
  const clientX = box.x + box.width * xRatio;
  const clientY = box.y + box.height * yRatio;
  if (useTouchPointer) {
    await choosePendingUpgradeIfOpen(page);
    await canvas.dispatchEvent("pointerdown", {
      pointerId: 41,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX,
      clientY,
    });
    await canvas.dispatchEvent("pointerup", {
      pointerId: 41,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX,
      clientY,
    });
    return;
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await choosePendingUpgradeIfOpen(page);
    try {
      await canvas.click({
        position: { x: box.width * xRatio, y: box.height * yRatio },
        timeout: 5_000,
      });
      return;
    } catch (error) {
      if (!(await hasPendingChoice(page))) throw error;
    }
  }
  throw new Error(
    "A pending class or Boss Core choice kept the world canvas blocked.",
  );
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
  await expect(page.getByTestId("tap-to-move-toggle")).toHaveCount(0);
  await expect(page.getByTestId("save-button")).toBeEnabled();
  await expect(page.locator('[aria-label="Wood: 120"]')).toHaveCount(1);
  await expect(page.locator('[aria-label="Boss Core: 0"]')).toHaveCount(1);
  await expect(page.getByTestId("boss-route-cue")).toContainText(
    "boss is 6m east of the home Campfire",
  );
  await expect(page.getByTestId("native-truth-boundary")).toHaveText(
    "Browser MVP evidence only: native Android wrapper/device, APK/AAB, and Google Play evidence are unverified.",
  );

  await openBuildMenu(page);
  await expect(page.getByTestId("build-radius")).toContainText("6m/9m/12m");
  await expect(page.getByTestId("build-radius")).toContainText("3m/4m/5m");
  await expect(page.getByTestId("build-Healer")).toHaveAttribute(
    "aria-label",
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

test("ordinary primary canvas taps travel to a marked destination when no build mode is active", async ({
  page,
}) => {
  await page.goto(applicationPath);
  await openStatus(page);
  const position = page.getByTestId("position");
  const canvas = page.getByTestId("world-canvas");
  const initialPosition = await position.textContent();
  if (initialPosition === null)
    throw new Error("World position text was not available");

  await clickWithPendingUpgradeResolution(
    page,
    page.getByTestId("close-character-status"),
  );
  await tapCanvas(page, 0.4, 0.62);
  await expect(position).toContainText("input: tap-to-move");
  await expect(canvas).toHaveAttribute("data-destination-marker", "active");
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
  await expect(page.locator('[aria-label="Wood: 120"]')).toHaveCount(1);
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
  await expect(page.locator('[aria-label="Wood: 480"]')).toHaveCount(1);
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
  await choosePendingClassChoicesIfOpen(page);
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

test("an explicit campfire save reloads the XP-derived level, chosen class, and exact skills", async ({
  page,
}) => {
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

  await openStatus(page);
  await expect(page.getByTestId("class-progression")).toContainText(
    "level 3 · Wizard",
  );
  await clickWithPendingUpgradeResolution(
    page,
    page.getByTestId("save-button"),
  );
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
  await expect(page.getByTestId("skill-tree-summary")).toContainText("2/4");
  await expect(page.getByTestId("skill-tree-skills")).toContainText(
    "Flame Orb: selected",
  );
  await expect(page.getByTestId("skill-tree-skills")).toContainText(
    "Arcane Haste: selected",
  );
  await expect(
    page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("wanderer.save.primary") ?? "{}"),
    ),
  ).resolves.toMatchObject({ classProgression: committed.classProgression });
});

test("public keyboard play defeats the real boss, selects one upgrade, and never saves implicitly", async ({
  page,
}) => {
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
  await expect(page.getByTestId("effects")).toContainText(selectedUpgradeLabel);
  await expect(page.locator('[aria-label^="Boss Core:"]')).toHaveCount(1);
  await expect(saveMessage).toContainText(
    "Fresh runtime: no committed save loaded.",
  );

  await page.reload();
  await openStatus(page);
  await expect(saveMessage).toContainText(
    "Fresh runtime: no committed save loaded.",
  );
  await expect(page.locator('[aria-label="Boss Core: 0"]')).toHaveCount(1);
  await expect(modal).toBeHidden();
});
