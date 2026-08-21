import { expect, test } from "@playwright/test";

test("initial browser load exposes a known seed, WebGL world, and visible touch stick", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("world-canvas")).toBeVisible();
  await expect(page.getByTestId("world-player-hp")).toHaveText("100 / 100 HP");
  await expect(page.getByTestId("seed")).toContainText("wanderer-known-seed");
  await expect(page.getByTestId("virtual-stick")).toBeVisible();
  await expect(page.getByTestId("tap-to-move-toggle")).not.toBeChecked();
  await expect(page.getByTestId("projectile-status")).toContainText(
    "in flight",
  );
  await expect(page.getByTestId("save-button")).toBeEnabled();
  await expect(page.getByTestId("resources")).toContainText("Wood");
  await expect(page.getByTestId("resources")).toContainText("Stone");
  await expect(page.getByTestId("resources")).toContainText("Metal / Scrap");
  await expect(page.getByTestId("resources")).toContainText("Essence");
  await expect(page.getByTestId("resources")).toContainText("Boss Core");
  await expect(page.getByTestId("build-radius")).toContainText("6m/9m/12m");
  await expect(page.getByTestId("boss-route-cue")).toContainText(
    "boss is 6m east of the home Campfire",
  );
  await expect(page.getByTestId("native-truth-boundary")).toHaveText(
    "Browser MVP evidence only: native Android wrapper/device, APK/AAB, and Google Play evidence are unverified.",
  );
});

test("enabled primary canvas taps travel to a destination while disabled taps do nothing", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.getByTestId("world-canvas");
  const position = page.getByTestId("position");
  const toggle = page.getByTestId("tap-to-move-toggle");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("World canvas was not laid out");

  await toggle.check();
  await canvas.click({
    position: { x: box.width * 0.4, y: box.height * 0.55 },
  });
  await expect(page.getByTestId("combat-status")).toContainText("suppressed");
  await page.waitForTimeout(1_500);
  const settledPosition = await position.textContent();
  await page.waitForTimeout(250);
  await expect(position).toHaveText(settledPosition ?? "");

  await toggle.uncheck();
  await canvas.click({
    position: { x: box.width * 0.6, y: box.height * 0.55 },
  });
  await page.waitForTimeout(250);
  await expect(position).toHaveText(settledPosition ?? "");
});

test("completed lethal projectiles leave visible renderer-owned floor drops without an implicit save", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.getByTestId("world-canvas");
  await expect(canvas).toHaveAttribute("data-floor-drop-count", /[1-9]/, {
    timeout: 4_000,
  });
  await expect(page.getByTestId("resources")).toContainText("Wood 120");
  await expect(page.getByTestId("save-message")).toContainText(
    "Fresh runtime: no committed save loaded.",
  );
});

test("status and world-control panels independently hide and reopen while play stays visible", async ({
  page,
}) => {
  await page.goto("/");
  const statusPanel = page.getByTestId("status-panel");
  const worldControlsPanel = page.getByTestId("world-controls-panel");
  const statusToggle = page.getByTestId("toggle-status-panel");
  const worldControlsToggle = page.getByTestId("toggle-world-controls-panel");

  await expect(statusToggle).toHaveAttribute("aria-expanded", "true");
  await expect(worldControlsToggle).toHaveAttribute("aria-expanded", "true");
  await statusToggle.click();
  await expect(statusPanel).toBeHidden();
  await expect(statusToggle).toHaveText("Show status");
  await expect(statusToggle).toHaveAttribute("aria-expanded", "false");

  await worldControlsToggle.click();
  await expect(worldControlsPanel).toBeHidden();
  await expect(worldControlsToggle).toHaveText("Show controls");
  await expect(worldControlsToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("world-canvas")).toBeVisible();
  await expect(page.getByTestId("virtual-stick")).toBeVisible();

  await statusToggle.click();
  await worldControlsToggle.click();
  await expect(statusPanel).toBeVisible();
  await expect(worldControlsPanel).toBeVisible();
  await expect(statusToggle).toHaveText("Hide status");
  await expect(worldControlsToggle).toHaveText("Hide controls");
});

test("Storage exposes an enforced common-material capacity while Boss Core is exempt", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("build-Storage").click();
  await expect(page.getByTestId("resources")).toContainText(
    "capacity 180 each",
  );
  await expect(page.getByTestId("effects")).toContainText(
    "Boss Core is exempt",
  );
});

test("keyboard movement and touch-stick movement share the stationary auto-attack gate", async ({
  page,
}) => {
  await page.goto("/");
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
  await page.goto("/");
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
  await page.goto("/");
  await page.getByTestId("save-button").click();
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
  await expect(page.getByTestId("save-message")).toContainText(
    "Recovered last explicit campfire save",
  );
  await expect(page.getByTestId("position")).toContainText(
    "Position: 0.0, 0.0",
  );
});

test("invalid normal-building placement rejects without adding a record", async ({
  page,
}) => {
  await page.goto("/");
  const resources = page.getByTestId("resources");
  await page.keyboard.down("d");
  await expect(page.getByTestId("combat-status")).toContainText("suppressed");
  await page.getByTestId("building-x").fill("48.1");
  await page.getByTestId("building-y").fill("48.1");
  const before = await resources.textContent();
  await page.getByTestId("build-Workshop").click();
  await expect(page.getByTestId("placement-message")).toContainText(
    "outside the 6m campfire settlement radius",
  );
  await expect(page.getByTestId("building-list")).toBeEmpty();
  await expect(resources).toHaveText(before ?? "");
  await page.keyboard.up("d");
});

test("public keyboard play defeats the real boss, selects one upgrade, and never saves implicitly", async ({
  page,
}) => {
  await page.goto("/");
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

  await expect(modal).toBeVisible({ timeout: 8_000 });
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
  await expect(page.getByTestId("effects")).toContainText(selectedUpgradeLabel);
  await expect(resources).toContainText("Boss Core 0");
  await expect(saveMessage).toContainText(
    "Fresh runtime: no committed save loaded.",
  );

  await page.reload();
  await expect(saveMessage).toContainText(
    "Fresh runtime: no committed save loaded.",
  );
  await expect(resources).toContainText("Boss Core 0");
  await expect(modal).toBeHidden();
});
