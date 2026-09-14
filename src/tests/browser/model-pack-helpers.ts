import { expect, type Page, type TestInfo } from "@playwright/test";
import { decodeSave } from "../../domain/save";
import type { BuildingKind } from "../../domain/types";

export const applicationPath = process.env.PLAYWRIGHT_BASE_PATH ?? "/";

export type ModelClass = "knight" | "wizard" | "archer";

/** A supported persisted projection, installed before application boot. */
export const primeModelWorld = async (
  page: Page,
  playerClass: ModelClass,
  buildings: readonly BuildingKind[] = [],
): Promise<void> => {
  const fixture = {
    schemaVersion: 4,
    world: {
      seed: "wanderer-model-browser",
      generatorVersion: "wanderer-web-v2",
    },
    player: { position: { x: 0, y: 0 }, hp: 100, maxHp: 100 },
    resources: { wood: 120, stone: 120, scrap: 120, essence: 20, bossCore: 0 },
    buildings: buildings.map((kind, index) => ({
      id: `building:model-browser:${index + 1}`,
      kind,
      level: 1 as const,
      position: { x: index + 1, y: 1 },
    })),
    defeatedBossIds: [],
    upgrades: [],
    nextBuildingSerial: buildings.length + 1,
    committedAt: 0,
    savePointId: "campfire:home",
    savePointPosition: { x: 0, y: 0 },
    classProgression: {
      experience: 6,
      level: 1,
      playerClass,
      skillIds: [],
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
  const serialized = JSON.stringify(fixture);
  const decoded = decodeSave(serialized);
  if (!decoded.ok)
    throw new Error(`Invalid model browser save: ${decoded.message}`);
  await page.addInitScript(
    ({ value }) => {
      window.localStorage.setItem("wanderer.save.primary", value);
    },
    { value: serialized },
  );
};

export const captureBrowserFaults = (page: Page): readonly string[] => {
  const faults: string[] = [];
  page.on("pageerror", (error) => faults.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") faults.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) =>
    faults.push(
      `requestfailed: ${request.url()} (${request.failure()?.errorText ?? "unknown"})`,
    ),
  );
  return faults;
};

/** The route deliberately returns 404 for GLBs. Browser engines may report
 * that expected response as a console error, but no unrelated fault is safe. */
export const expectOnlyMissingModelFaults = (
  faults: readonly string[],
): void => {
  for (const fault of faults)
    expect(fault).toMatch(/(?:\.glb|model).*404|404.*(?:\.glb|model)/i);
};

export const activeModelKeys = async (
  page: Page,
): Promise<readonly string[]> => {
  const value = await page
    .getByTestId("world-canvas")
    .getAttribute("data-model-active-keys");
  if (value === null)
    throw new Error("Renderer did not publish data-model-active-keys");
  return value.split(",").filter(Boolean).sort();
};

export const expectModelsReady = async (page: Page): Promise<void> => {
  const canvas = page.getByTestId("world-canvas");
  await expect(canvas).toHaveAttribute("data-model-loaded-count", /[1-9]\d*/);
  await expect(canvas).toHaveAttribute("data-model-pending-count", "0");
};

export const attachStableModelScreenshot = async (
  page: Page,
  testInfo: TestInfo,
  phase: string,
): Promise<void> => {
  await testInfo.attach(`model-pack-${phase}`, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
};
