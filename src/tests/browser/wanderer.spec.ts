import { expect, test } from "@playwright/test";

test("initial browser load exposes a known seed, WebGL world, and visible touch stick", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("world-canvas")).toBeVisible();
  await expect(page.getByTestId("seed")).toContainText("wanderer-known-seed");
  await expect(page.getByTestId("virtual-stick")).toBeVisible();
  await expect(page.getByTestId("save-button")).toBeEnabled();
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
  await expect(page.getByTestId("position")).toContainText("virtual-stick");
  await expect(combat).toContainText("suppressed");
  await stick.dispatchEvent("pointerup", {
    pointerId: 1,
    clientX: box.x + box.width - 8,
    clientY: box.y + box.height / 2,
  });
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
