import { expect, type Page, type TestInfo } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { decodeSave } from "../../domain/save";
import type { ChunkObstacle, Vector2, WorldIdentity } from "../../domain/types";
import {
  generateChunk,
  WANDERER_WEB_V3,
  WANDERER_WEB_V4,
} from "../../domain/world";
import {
  islandDescriptorFor,
  isLandPosition,
  mountainRangeForChunk,
  riverPathForIsland,
} from "../../domain/world/generators/wandererWebV4";
import { HARVEST_INTERACTION_DISTANCE } from "../../domain/resourceHarvesting";
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
const terrainV4World: WorldIdentity = Object.freeze({
  seed: "terrain-v4-ridge-browser",
  generatorVersion: WANDERER_WEB_V4,
});

export type TerrainKind = "tree" | "mountain" | "water" | "sea";
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

/** Find a generated node and a collision-safe player start inside harvest reach. */
export const harvestableFixtureFor = (
  kind: "tree" | "rock",
): {
  obstacle: ChunkObstacle & {
    readonly kind: "tree" | "rock";
    readonly radius: number;
  };
  start: Vector2;
} => {
  for (let y = -8; y <= 8; y += 1)
    for (let x = -8; x <= 8; x += 1)
      for (const obstacle of generateChunk(terrainWorld, { x, y }).obstacles) {
        if (obstacle.kind !== kind || obstacle.radius === undefined) continue;
        for (const direction of directions) {
          const start = {
            x: obstacle.position.x + direction.x * (obstacle.radius + 0.82),
            y: obstacle.position.y + direction.y * (obstacle.radius + 0.82),
          };
          if (
            Math.hypot(
              start.x - obstacle.position.x,
              start.y - obstacle.position.y,
            ) <= HARVEST_INTERACTION_DISTANCE &&
            !terrainBlocksPosition(terrainWorld, start)
          )
            return {
              obstacle: obstacle as ChunkObstacle & {
                readonly kind: "tree" | "rock";
                readonly radius: number;
              },
              start,
            };
        }
      }
  throw new Error(
    "No safe generated " + kind + " harvesting fixture was found",
  );
};

/** Find a live V4 ridge footprint with clear approach and retreat space. */
export const terrainV4MountainFixture = (): TerrainFixture => {
  for (let y = -20; y < 20; y += 1)
    for (let x = 20; x < 60; x += 1)
      for (const obstacle of mountainRangeForChunk(terrainV4World, { x, y })) {
        if (
          !isLandPosition(terrainV4World, {
            x: (x + 0.5) * 16,
            y: (y + 0.5) * 16,
          })
        )
          continue;
        for (const direction of directions) {
          const clearance = (obstacle.radius ?? 0) + 2.6;
          const start = {
            x: obstacle.position.x + direction.x * clearance,
            y: obstacle.position.y + direction.y * clearance,
          };
          const retreat = {
            x: start.x + direction.x * 1.2,
            y: start.y + direction.y * 1.2,
          };
          const swept = sweepTerrainMovement(
            terrainV4World,
            start,
            obstacle.position,
          );
          if (
            !terrainBlocksPosition(terrainV4World, start) &&
            !terrainBlocksPosition(terrainV4World, retreat) &&
            Math.abs(
              Math.hypot(
                swept.x - obstacle.position.x,
                swept.y - obstacle.position.y,
              ) -
                ((obstacle.radius ?? 0) + 0.28),
            ) < 0.03
          )
            return {
              obstacle: obstacle as TerrainFixture["obstacle"],
              start,
              retreat,
            };
        }
      }
  throw new Error("No safe V4 mountain ridge fixture was found");
};

/** Find a V4 sea edge with a clear land-side approach and reverse route. */
export const terrainV4SeaFixture = (): TerrainFixture => {
  const radius = islandDescriptorFor(terrainV4World, { x: 0, y: 0 }).radius;
  const edgeChunk = Math.floor(radius / 16);
  for (let y = -4; y <= 4; y += 1)
    for (let x = edgeChunk - 3; x <= edgeChunk + 4; x += 1)
      for (const obstacle of generateChunk(terrainV4World, { x, y })
        .obstacles) {
        if (obstacle.waterKind !== "sea" || obstacle.radius === undefined)
          continue;
        for (const direction of directions) {
          const approachDistance = obstacle.radius + 3;
          const start = {
            x: obstacle.position.x + direction.x * approachDistance,
            y: obstacle.position.y + direction.y * approachDistance,
          };
          const retreat = {
            x: start.x + direction.x * 1.2,
            y: start.y + direction.y * 1.2,
          };
          const swept = sweepTerrainMovement(
            terrainV4World,
            start,
            obstacle.position,
          );
          if (
            !terrainBlocksPosition(terrainV4World, start) &&
            !terrainBlocksPosition(terrainV4World, retreat) &&
            Math.abs(
              Math.hypot(
                swept.x - obstacle.position.x,
                swept.y - obstacle.position.y,
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
  throw new Error("No safe V4 sea-edge fixture was found");
};

export const terrainV4FordFixture = (): {
  start: Vector2;
  midpoint: Vector2;
  end: Vector2;
} => {
  const spacing = 1.35;
  for (const islandCoordinate of [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ]) {
    const path = riverPathForIsland(terrainV4World, islandCoordinate);
    for (let index = 4; index < path.length - 4; index += 1) {
      const along = (index * spacing) % 36;
      if (along > 2.4 && along < 33.6) continue;
      const before = path[index - 1];
      const after = path[index + 1];
      const midpoint = path[index];
      if (before === undefined || after === undefined || midpoint === undefined)
        continue;
      const dx = after.x - before.x;
      const dy = after.y - before.y;
      const length = Math.hypot(dx, dy);
      if (length === 0) continue;
      const normal = { x: -dy / length, y: dx / length };
      const start = {
        x: midpoint.x + normal.x * 3,
        y: midpoint.y + normal.y * 3,
      };
      const end = {
        x: midpoint.x - normal.x * 3,
        y: midpoint.y - normal.y * 3,
      };
      let clear = true;
      for (let step = 0; step <= 30; step += 1) {
        const amount = step / 30;
        const position = {
          x: start.x + (end.x - start.x) * amount,
          y: start.y + (end.y - start.y) * amount,
        };
        if (
          !isLandPosition(terrainV4World, position) ||
          terrainBlocksPosition(terrainV4World, position, generateChunk, 0.28)
        ) {
          clear = false;
          break;
        }
      }
      if (clear) return { start, midpoint, end };
    }
  }
  throw new Error("No traversable V4 river ford was found");
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
  world: WorldIdentity = terrainWorld,
): Promise<void> => {
  const value = JSON.stringify({
    schemaVersion: 4,
    world,
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
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox({ timeout: 5_000 });
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
