import { expect, test } from "@playwright/test";
import {
  expectRowPosition,
  openBuild,
  openM5World,
  openStatus,
  tapWorldPosition,
} from "./m5-test-helpers";

// Failure watchdog only; there are no sleep-based progression or retry loops.
test.setTimeout(60_000);

test("M5 real DOM retains rows/effects through updates and current next-tap relocation, removing only departed rows", async ({
  page,
}) => {
  await openM5World(page);
  await openBuild(page);
  await page.getByTestId("build-Campfire").click();
  await tapWorldPosition(page, 1, 1);
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await openBuild(page);
  const list = page.getByTestId("building-list");
  await expect(list.locator(".building-row")).toHaveCount(1);
  await page.getByTestId("build-Campfire").click();
  await tapWorldPosition(page, 4, 0);
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await openBuild(page);
  const rows = list.locator(".building-row");
  await expect(rows).toHaveCount(2);
  const first = await rows.nth(0).elementHandle();
  const second = await rows.nth(1).elementHandle();
  const move = await rows
    .nth(0)
    .getByRole("button", { name: "Relocate on canvas", exact: true })
    .elementHandle();
  if (first === null || second === null || move === null)
    throw new Error("Missing retained building rows/buttons");
  const secondLabel = await rows.nth(1).locator("span").first().innerText();
  await page.getByTestId("close-build-menu").click();
  await openStatus(page);
  await expect(page.getByTestId("effects")).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  // Observe actual simulation frames, retaining all authored M5 zero-write and
  // DOM identity assertions. No globals or gameplay state are injected.
  const stable = await list.evaluate(async (element) => {
    const rowsBefore = [...element.children];
    const effects = document.querySelector('[data-testid="effects"]');
    if (effects === null) throw new Error("Missing effects");
    const effectsBefore = [...effects.children];
    let writes = 0;
    const observer = new MutationObserver((records) => {
      writes += records.length;
    });
    for (const target of [element, effects])
      observer.observe(target, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
    for (let frame = 0; frame < 8; frame += 1)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    writes += observer.takeRecords().length;
    observer.disconnect();
    return {
      writes,
      rowsStable: rowsBefore.every(
        (row, index) => element.children[index] === row,
      ),
      effectsStable: effectsBefore.every(
        (effect, index) => effects.children[index] === effect,
      ),
    };
  });
  expect(stable).toEqual({ writes: 0, rowsStable: true, effectsStable: true });
  await page.getByTestId("close-character-status").click();
  await openBuild(page);
  await rows
    .nth(0)
    .getByRole("button", { name: "Upgrade", exact: true })
    .click();
  await expect(rows.nth(0)).toContainText("Campfire L2");
  await expect(rows.nth(1).locator("span").first()).toHaveText(secondLabel);
  expect(await first.evaluate((node) => node.isConnected)).toBe(true);
  expect(await second.evaluate((node) => node.isConnected)).toBe(true);
  expect(await move.evaluate((node) => node.isConnected)).toBe(true);
  await move.click();
  await expect(page.getByTestId("placement-mode")).toContainText(
    "Campfire relocation selected",
  );
  await expect(page.getByTestId("build-menu-panel")).toBeHidden();
  // A different next tap, not the old build coordinate, is authoritative.
  await tapWorldPosition(page, 1, 0);
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await expect(page.getByTestId("placement-message")).toContainText(
    "Campfire relocated",
  );
  await openBuild(page);
  await expectRowPosition(rows.nth(0), 1, 0);
  expect(await first.evaluate((node) => node.isConnected)).toBe(true);
  await rows
    .nth(0)
    .getByRole("button", { name: "Demolish", exact: true })
    .click();
  await expect(rows).toHaveCount(1);
  expect(await first.evaluate((node) => node.isConnected)).toBe(false);
  expect(await second.evaluate((node) => node.isConnected)).toBe(true);
  await expect(rows.nth(0).locator("span").first()).toHaveText(secondLabel);
  expect(
    await page.evaluate(() => localStorage.getItem("wanderer.save.primary")),
  ).toBeNull();
  await first.dispose();
  await second.dispose();
  await move.dispose();
});

test("M5 retains visible canvas/health label through movement and reset without persistence", async ({
  page,
}) => {
  await openM5World(page);
  const canvas = await page.getByTestId("world-canvas").elementHandle();
  const label = await page.getByTestId("world-player-hp").elementHandle();
  if (canvas === null || label === null)
    throw new Error("Missing renderer elements");
  await openStatus(page);
  const before = await page.getByTestId("position").innerText();
  await page.keyboard.down("a");
  try {
    await expect(page.getByTestId("position")).not.toHaveText(before);
  } finally {
    await page.keyboard.up("a");
  }
  expect(await canvas.evaluate((node) => node.isConnected)).toBe(true);
  expect(await label.evaluate((node) => node.isConnected)).toBe(true);
  await expect(page.getByTestId("world-player-hp")).toHaveText(/\d+ \/ \d+ HP/);
  await page.getByTestId("seed-input").fill("m5-reset-world");
  await page.getByTestId("new-world").click();
  await expect(page.getByTestId("seed")).toContainText("m5-reset-world");
  await page.getByTestId("close-character-status").click();
  await openBuild(page);
  await expect(page.getByTestId("building-list")).toBeEmpty();
  expect(await canvas.evaluate((node) => node.isConnected)).toBe(true);
  expect(await label.evaluate((node) => node.isConnected)).toBe(true);
  await expect(page.getByTestId("world-canvas")).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("wanderer.save.primary")),
  ).toBeNull();
  await canvas.dispose();
  await label.dispose();
});

test("M5 Healing Hut keeps aura and listeners across upgrades, rejection, cancellation and selected demolition", async ({
  page,
}) => {
  await openM5World(page);
  await openStatus(page);
  await page.getByTestId("tap-to-move-toggle").check();
  const playerBefore = await page.getByTestId("position").innerText();
  await page.getByTestId("close-character-status").click();
  await openBuild(page);
  await page.getByTestId("build-Healer").click();
  await tapWorldPosition(page, 1, 1);
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await openStatus(page);
  await expect(page.getByTestId("position")).toHaveText(playerBefore);
  await page.getByTestId("close-character-status").click();
  await openBuild(page);
  const row = page
    .getByTestId("building-list")
    .locator(".building-row")
    .filter({ hasText: "Healing Hut" });
  await expect(row).toContainText("Healing aura: 3m radius");
  const aura = row.locator('[data-testid^="healing-radius-"]');
  const rowHandle = await row.elementHandle(),
    auraHandle = await aura.elementHandle();
  const relocate = await row
    .getByRole("button", { name: "Relocate on canvas", exact: true })
    .elementHandle();
  if (rowHandle === null || auraHandle === null || relocate === null)
    throw new Error("Missing hut DOM");
  for (const level of [2, 3]) {
    await row.getByRole("button", { name: "Upgrade", exact: true }).click();
    await expect(aura).toHaveAccessibleName(
      `Healing Hut healing radius, level ${level}: ${level + 2} metres`,
    );
    await expect(aura).toContainText(`Healing aura: ${level + 2}m radius`);
    await expect(page.getByTestId("world-canvas")).toHaveAttribute(
      "data-healing-hut-aura-radii",
      String(level + 2),
    );
    expect(await rowHandle.evaluate((node) => node.isConnected)).toBe(true);
    expect(await auraHandle.evaluate((node) => node.isConnected)).toBe(true);
    expect(await relocate.evaluate((node) => node.isConnected)).toBe(true);
  }
  await expect(
    row.getByRole("button", { name: "Upgrade", exact: true }),
  ).toBeDisabled();
  await page.getByTestId("build-Campfire").click();
  await tapWorldPosition(page, 4, 0);
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await openBuild(page);
  await relocate.click();
  await tapWorldPosition(page, 4, 0);
  await expect(page.getByTestId("placement-message")).toContainText(
    "overlaps an existing building",
  );
  await expect(page.getByTestId("placement-mode")).toContainText(
    "Healing Hut relocation selected",
  );
  await openBuild(page);
  await expectRowPosition(row, 1, 1);
  await expect(aura).toContainText("Healing aura: 5m radius");
  expect(await rowHandle.evaluate((node) => node.isConnected)).toBe(true);
  await page.getByTestId("cancel-placement").click();
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await relocate.click();
  await openBuild(page);
  await row.getByRole("button", { name: "Demolish", exact: true }).click();
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await expect(row).toHaveCount(0);
  expect(await auraHandle.evaluate((node) => node.isConnected)).toBe(false);
  await expect(page.getByTestId("world-canvas")).toHaveAttribute(
    "data-healing-hut-aura-count",
    "0",
  );
  // Reset also cancels a pending next-tap operation and clears its feedback.
  await page.getByTestId("build-Campfire").click();
  await openStatus(page);
  await page.getByTestId("new-world").click();
  await expect(page.getByTestId("placement-mode")).toBeHidden();
  await expect(page.getByTestId("placement-message")).toBeEmpty();
  expect(
    await page.evaluate(() => localStorage.getItem("wanderer.save.primary")),
  ).toBeNull();
  await rowHandle.dispose();
  await auraHandle.dispose();
  await relocate.dispose();
});
