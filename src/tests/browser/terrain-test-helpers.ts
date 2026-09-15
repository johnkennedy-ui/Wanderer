import { expect, type Page, type TestInfo } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { decodeSave } from "../../domain/save";
import type { ChunkObstacle, Vector2 } from "../../domain/types";
import { generateChunk, WANDERER_WEB_V3 } from "../../domain/world";
import {
  sweepTerrainMovement,
  terrainBlocksPosition,
} from "../../domain/world/terrainCollision";
import { defaultThreeCameraTuning } from "../../platform/render/threeRenderer";

export const applicationPath = process.env.PLAYWRIGHT_BASE_PATH ?? "/";
export const terrainWorld = Object.freeze({
  seed: "terrain-browser-regression",
  generatorVersion: WANDERER_WEB_V3,
});

export type TerrainKind = "tree" | "mountain" | "water";
export type TerrainFixture = Readonly<{
  obstacle: ChunkObstacle & {
    readonly kind: TerrainKind;
    readonly radius: number;
  };
  start: Vector2;
  retreat: Vector2;
}>;

const directions = Object.freeze([
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]);

/** Find a real V3 footprint with an unobstructed approach and retreat. */
export const terrainFixtureFor = (kind: TerrainKind): TerrainFixture => {
  for (let y = -8; y <= 8; y += 1)
    for (let x = -8; x <= 8; x += 1)
      for (const obstacle of generateChunk(terrainWorld, { x, y }).obstacles) {
        if (obstacle.kind !== kind || obstacle.radius === undefined) continue;
        for (const direction of directions) {
          const start = {
            x: obstacle.position.x + direction.x * (obstacle.radius + 0.82),
            y: obstacle.position.y + direction.y * (obstacle.radius + 0.82),
          };
          const retreat = {
            x: start.x + direction.x * 1.2,
            y: start.y + direction.y * 1.2,
          };
          if (
            !terrainBlocksPosition(terrainWorld, start) &&
            !terrainBlocksPosition(terrainWorld, retreat) &&
            Math.abs(
              Math.hypot(
                sweepTerrainMovement(terrainWorld, start, obstacle.position).x -
                  obstacle.position.x,
                sweepTerrainMovement(terrainWorld, start, obstacle.position).y -
                  obstacle.position.y,
              ) -
                (obstacle.radius + 0.28),
            ) < 0.03
          )
            return {
              obstacle: obstacle as TerrainFixture["obstacle"],
              start,
              retreat,
            };
        }
      }
  throw new Error(`No safe generated ${kind} fixture was found`);
};

export const terrainFordFixture = (): {
  start: Vector2;
  midpoint: Vector2;
  end: Vector2;
} => {
  const river: ChunkObstacle[] = [];
  for (let y = -6; y <= 6; y += 1)
    for (let x = -7; x <= 7; x += 1)
      river.push(
        ...generateChunk(terrainWorld, { x, y }).obstacles.filter(
          (cell) => cell.waterKind === "river",
        ),
      );
  river.sort((a, b) => a.position.y - b.position.y);
  for (let i = 1; i < river.length; i += 1) {
    const low = river[i - 1].position;
    const high = river[i].position;
    const gap = high.y - low.y;
    if (gap < 4 || gap > 10) continue;
    const midpoint = { x: (low.x + high.x) / 2, y: (low.y + high.y) / 2 };
    const start = { x: midpoint.x - 3, y: midpoint.y };
    const end = { x: midpoint.x + 3, y: midpoint.y };
    let clear = true;
    for (let step = 0; step <= 30; step += 1)
      if (
        terrainBlocksPosition(
          terrainWorld,
          { x: start.x + step * 0.2, y: start.y },
          generateChunk,
          0.35,
        )
      )
        clear = false;
    if (clear) return { start, midpoint, end };
  }
  throw new Error("No unobstructed real river ford found");
};

export const primeTerrainWorld = async (
  page: Page,
  position: Vector2,
): Promise<void> => {
  const value = JSON.stringify({
    schemaVersion: 4,
    world: terrainWorld,
    player: { position, hp: 100, maxHp: 100 },
    resources: { wood: 120, stone: 120, scrap: 120, essence: 20, bossCore: 0 },
    buildings: [],
    defeatedBossIds: [],
    upgrades: [],
    nextBuildingSerial: 1,
    committedAt: 0,
    savePointId: "campfire:home",
    savePointPosition: position,
    classProgression: {
      experience: 6,
      level: 1,
      playerClass: "knight",
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
  });
  const decoded = decodeSave(value);
  if (!decoded.ok)
    throw new Error(`Invalid terrain browser save: ${decoded.message}`);
  await page.addInitScript(
    ({ saved }) => localStorage.setItem("wanderer.save.primary", saved),
    { saved: value },
  );
};

export const visiblePosition = async (page: Page): Promise<Vector2> => {
  const text = await page.getByTestId("position").innerText();
  const match = /Position: (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)/.exec(text);
  if (match === null)
    throw new Error(`Position was not publicly projected: ${text}`);
  return { x: Number(match[1]), y: Number(match[2]) };
};

export const tapWorldPosition = async (
  page: Page,
  player: Vector2,
  target: Vector2,
  touch: boolean,
): Promise<void> => {
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
  const point = new Vector3(target.x, 0, -target.y).project(camera);
  const position = {
    x: ((point.x + 1) / 2) * bounds.width,
    y: ((1 - point.y) / 2) * bounds.height,
  };
  expect(position.x).toBeGreaterThan(0);
  expect(position.x).toBeLessThan(bounds.width);
  expect(position.y).toBeGreaterThan(0);
  expect(position.y).toBeLessThan(bounds.height);
  if (touch) await canvas.tap({ position });
  else await canvas.click({ position });
};

export const attachTerrainScreenshot = async (
  page: Page,
  testInfo: TestInfo,
  kind: TerrainKind,
): Promise<void> => {
  for (const id of ["character-status-toggle", "build-menu-toggle"]) {
    const toggle = page.getByTestId(id);
    if ((await toggle.getAttribute("aria-expanded")) === "true")
      await toggle.click();
  }
  const path = testInfo.outputPath(`terrain-${kind}.png`);
  await page.screenshot({ path });
  await testInfo.attach(`terrain-${kind}`, { path, contentType: "image/png" });
};
