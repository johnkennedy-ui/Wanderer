import { expect, test } from "@playwright/test";
import { HARVEST_INTERACTION_DISTANCE } from "../../domain/resourceHarvesting";
import { terrainBlocksPosition } from "../../domain/world/terrainCollision";
import { captureBrowserFaults } from "./model-pack-helpers";
import {
  applicationPath,
  harvestableFixtureFor,
  primeTerrainWorld,
  terrainWorld,
  tapWorldPosition,
  visiblePosition,
} from "./terrain-test-helpers";

const lifecycleEventsByPage = new WeakMap<object, string[]>();

test.beforeEach(({ page }) => {
  const events: string[] = [];
  lifecycleEventsByPage.set(page, events);
  page.on("console", (message) => {
    if (message.text().startsWith("[harvest-canvas-lifecycle]"))
      events.push(message.text());
  });
});

test.afterEach(async ({ page }, testInfo) => {
  const events = lifecycleEventsByPage.get(page) ?? [];
  if (events.length > 0) {
    events.forEach((event) => console.info(event));
    await testInfo.attach("harvest-canvas-lifecycle", {
      body: events.join("\n"),
      contentType: "text/plain",
    });
  }
});

// Full journey includes startup, harvest, reload rollback, and re-harvest.
test.setTimeout(120_000);

test("harvesting browser gate runs gameplay at 5×", async ({ page }) => {
  await page.goto("/");
  const classModal = page.getByTestId("class-modal");
  if (await classModal.isVisible())
    await classModal
      .locator('button[data-testid^="class-skill-"]')
      .first()
      .click();
  await page.getByTestId("settings-toggle").click();
  const speed = page.getByTestId("speed-5x");
  await expect(speed).toBeVisible();
  await expect(speed).toHaveAttribute("aria-pressed", "true");
});

const resourceAmounts = async (
  page: import("@playwright/test").Page,
): Promise<{ wood: number; stone: number; iron: number; scrap: number }> =>
  page.getByTestId("resources").evaluate((resources) => {
    const amountFor = (title: string): number => {
      const chip = Array.from(
        resources.querySelectorAll<HTMLElement>(".resource-chip"),
      ).find((candidate) => candidate.title === title);
      const ariaLabel = chip?.getAttribute("aria-label") ?? null;
      const match = ariaLabel === null ? null : /: (\d+)$/.exec(ariaLabel);
      if (match === null)
        throw new Error(title + " balance was not publicly projected");
      return Number(match[1]);
    };
    return {
      wood: amountFor("Wood"),
      stone: amountFor("Stone"),
      iron: amountFor("Iron"),
      scrap: amountFor("Metal / Scrap"),
    };
  });

for (const kind of ["tree", "rock"] as const) {
  test(
    "canvas click routes to and harvests a distant " +
      kind +
      " on desktop and touch",
    async ({ page }, testInfo) => {
      const fixture = harvestableFixtureFor(kind);
      const directionLength = Math.hypot(
        fixture.start.x - fixture.obstacle.position.x,
        fixture.start.y - fixture.obstacle.position.y,
      );
      const distantStart = [3, 4, 5, 6]
        .map((extraDistance) => ({
          x:
            fixture.start.x +
            ((fixture.start.x - fixture.obstacle.position.x) /
              directionLength) *
              extraDistance,
          y:
            fixture.start.y +
            ((fixture.start.y - fixture.obstacle.position.y) /
              directionLength) *
              extraDistance,
        }))
        .find((point) => !terrainBlocksPosition(terrainWorld, point));
      if (distantStart === undefined)
        throw new Error("Could not find a clear distant harvesting start");
      expect(
        Math.hypot(
          distantStart.x - fixture.obstacle.position.x,
          distantStart.y - fixture.obstacle.position.y,
        ),
      ).toBeGreaterThan(HARVEST_INTERACTION_DISTANCE);
      const faults = captureBrowserFaults(page);
      // Retain an exact add/remove/page-lifecycle timeline in Playwright trace.
      await page.addInitScript(() => {
        const selector = '[data-testid="world-canvas"]';
        const describe = (event: string, element: Element | null): void => {
          const box = element?.getBoundingClientRect();
          console.info(
            "[harvest-canvas-lifecycle]",
            JSON.stringify({
              event,
              time: Math.round(performance.now()),
              readyState: document.readyState,
              connected: element?.isConnected ?? false,
              display:
                element === null ? null : getComputedStyle(element).display,
              visibility:
                element === null ? null : getComputedStyle(element).visibility,
              width: box?.width ?? null,
              height: box?.height ?? null,
            }),
          );
        };
        const visit = (node: Node, event: string): void => {
          if (node instanceof Element) {
            if (node.matches(selector)) describe(event, node);
            node
              .querySelectorAll(selector)
              .forEach((canvas) => describe(event, canvas));
          }
        };
        new MutationObserver((records) => {
          for (const record of records) {
            if (record.type === "childList") {
              record.addedNodes.forEach((node) => visit(node, "added"));
              record.removedNodes.forEach((node) => visit(node, "removed"));
            } else if (
              record.target instanceof Element &&
              record.target.matches(selector)
            ) {
              describe("attributes", record.target);
            }
          }
        }).observe(document, {
          attributes: true,
          attributeFilter: ["class", "style", "data-testid"],
          childList: true,
          subtree: true,
        });
        window.addEventListener("pagehide", () =>
          describe("pagehide", document.querySelector(selector)),
        );
        window.addEventListener("pageshow", () =>
          describe("pageshow", document.querySelector(selector)),
        );
        const resolvePendingClassSkill = (): void => {
          const modal = document.querySelector<HTMLElement>(
            '[data-testid="class-modal"]',
          );
          const choice = modal?.querySelector<HTMLButtonElement>(
            'button[data-testid^="class-skill-"]',
          );
          if (modal !== null && modal !== undefined && !modal.hidden)
            choice?.click();
        };
        new MutationObserver(resolvePendingClassSkill).observe(document, {
          attributes: true,
          attributeFilter: ["hidden"],
          childList: true,
          subtree: true,
        });
        window.setInterval(resolvePendingClassSkill, 50);
      });
      await primeTerrainWorld(page, distantStart);
      await page.goto(applicationPath, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("character-status-toggle")).toBeVisible();
      await expect(page.getByTestId("resources-toggle")).toBeVisible();

      const positionBefore = await visiblePosition(page);
      const before = await resourceAmounts(page);
      const storedBefore = await page.evaluate(() =>
        window.localStorage.getItem("wanderer.save.primary"),
      );
      expect(storedBefore).not.toBeNull();
      const expectedAfter = {
        ...before,
        wood: before.wood + (kind === "tree" ? 24 : 0),
        stone: before.stone + (kind === "rock" ? 20 : 0),
        iron: before.iron + (kind === "rock" ? 12 : 0),
      };

      // Keep HUD panels closed so the canvas receives the real pointer input.
      await tapWorldPosition(
        page,
        positionBefore,
        fixture.obstacle.position,
        testInfo.project.name === "touch",
      );
      // At 5× the route can finish between the click and the first poll.
      // Accept an active marker or an already-completed journey only when the
      // player's public position proves it left the distant start.
      await expect
        .poll(async () => {
          const marker = await page
            .getByTestId("world-canvas")
            .getAttribute("data-destination-marker");
          const position = await visiblePosition(page);
          return (
            marker === "active" ||
            Math.hypot(
              position.x - positionBefore.x,
              position.y - positionBefore.y,
            ) > 0.1
          );
        })
        .toBe(true);
      await expect
        .poll(async () => {
          const current = await resourceAmounts(page);
          return (
            current.wood >= expectedAfter.wood &&
            current.stone >= expectedAfter.stone &&
            current.iron >= expectedAfter.iron &&
            current.scrap >= expectedAfter.scrap
          );
        })
        .toBe(true);
      await expect
        .poll(async () => {
          const position = await visiblePosition(page);
          return (
            Math.hypot(
              position.x - fixture.obstacle.position.x,
              position.y - fixture.obstacle.position.y,
            ) - (kind === "rock" ? fixture.obstacle.radius : 0)
          );
        })
        .toBeLessThan(HARVEST_INTERACTION_DISTANCE);
      await expect(page.getByTestId("world-canvas")).toHaveAttribute(
        "data-destination-marker",
        "inactive",
      );
      expect(
        await page.evaluate(() =>
          window.localStorage.getItem("wanderer.save.primary"),
        ),
      ).toBe(storedBefore);

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("character-status-toggle")).toBeVisible();
      await expect.poll(() => resourceAmounts(page)).toEqual(before);
      expect(
        await page.evaluate(() =>
          window.localStorage.getItem("wanderer.save.primary"),
        ),
      ).toBe(storedBefore);

      // The unchanged committed save must restore both the old balance and
      // the deterministic node, so a second harvest is available after reload.
      const reloadedPosition = await visiblePosition(page);
      await tapWorldPosition(
        page,
        reloadedPosition,
        fixture.obstacle.position,
        testInfo.project.name === "touch",
      );
      await expect
        .poll(async () => {
          const current = await resourceAmounts(page);
          return (
            current.wood >= expectedAfter.wood &&
            current.stone >= expectedAfter.stone &&
            current.iron >= expectedAfter.iron &&
            current.scrap >= expectedAfter.scrap
          );
        })
        .toBe(true);
      await expect
        .poll(async () => {
          const position = await visiblePosition(page);
          return (
            Math.hypot(
              position.x - fixture.obstacle.position.x,
              position.y - fixture.obstacle.position.y,
            ) - (kind === "rock" ? fixture.obstacle.radius : 0)
          );
        })
        .toBeLessThan(HARVEST_INTERACTION_DISTANCE);
      expect(
        await page.evaluate(() =>
          window.localStorage.getItem("wanderer.save.primary"),
        ),
      ).toBe(storedBefore);
      expect(faults).toEqual([]);
    },
  );
}

test("touch status badges stay clear of the action dock", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "touch", "responsive touch layout only");
  await page.goto(applicationPath, { waitUntil: "domcontentloaded" });
  const stats = page.getByTestId("quick-stats");
  const dock = page.locator(".hud-action-dock");
  await expect(stats).toBeVisible();
  await expect(dock).toBeVisible();
  const statsBox = await stats.boundingBox();
  const dockBox = await dock.boundingBox();
  expect(statsBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  if (statsBox === null || dockBox === null) return;
  const overlaps =
    statsBox.x < dockBox.x + dockBox.width &&
    statsBox.x + statsBox.width > dockBox.x &&
    statsBox.y < dockBox.y + dockBox.height &&
    statsBox.y + statsBox.height > dockBox.y;
  expect(overlaps).toBe(false);
});
