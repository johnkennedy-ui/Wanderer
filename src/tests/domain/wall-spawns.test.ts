import { describe, expect, it } from "vitest";
import { GameSession } from "../../domain/GameSession";
import { advanceEnemyCombatPhase } from "../../domain/session/combatTickRuntime";
import {
  nearestWallSafePosition,
  wallBlocksPosition,
} from "../../domain/session/buildingGeometry";
import type { ChunkRecipeSource } from "../../domain/session/chunkRecipeCache";
import type { BuildingState, ChunkSpawn } from "../../domain/types";
import { generateChunk, WANDERER_WEB_V3 } from "../../domain/world";
import { enemyTerrainClearanceFor } from "../../domain/world/terrainCollision";
import type { RuntimeEnemy } from "../../domain/session/sessionState";
import { savedAtHome } from "./session-test-helpers";

const wall = (position: { x: number; y: number }): BuildingState => ({
  id: `wall:${position.x}:${position.y}`,
  kind: "WoodWall",
  position,
  level: 1,
});

const spawn: ChunkSpawn = {
  id: "enemy:wall-spawn",
  kind: "brute",
  position: { x: 2.5, y: 0 },
  danger: {
    tier: 1,
    label: "test",
    distance: 2.5,
    healthMultiplier: 1,
    damageMultiplier: 1,
    dropMultiplier: 1,
  },
};

const recipeSource: ChunkRecipeSource = (world, coordinate) => ({
  ...generateChunk(world, coordinate),
  obstacles: [],
  campfires:
    coordinate.x === 0 && coordinate.y === 0
      ? [
          {
            id: "campfire:spawn-test-home",
            kind: "home",
            position: { x: 0, y: 0 },
          },
        ]
      : [],
  spawns: coordinate.x === 0 && coordinate.y === 0 ? [spawn] : [],
});

const runtimeEnemy = (overrides: Partial<RuntimeEnemy> = {}): RuntimeEnemy => ({
  id: "enemy:respawn",
  kind: "brute",
  position: { x: 3, y: 0 },
  spawnPosition: { x: 2.5, y: 0 },
  hp: 0,
  maxHp: 24,
  damage: 1,
  dangerTier: 1,
  dropMultiplier: 1,
  moveSpeed: 1,
  attackEverySeconds: 10,
  respawnAt: 1,
  defeated: true,
  attackElapsed: 0,
  ...overrides,
});

const respawnPhase = (
  enemy: RuntimeEnemy,
  resolveEnemyRespawnPosition?: (
    position: { x: number; y: number },
    candidate: Readonly<RuntimeEnemy>,
  ) => { x: number; y: number } | null,
) =>
  advanceEnemyCombatPhase({
    delta: 0,
    elapsed: 1,
    player: { position: { x: -10, y: 0 }, hp: 100, maxHp: 100 },
    resources: { wood: 0, stone: 0, scrap: 0, essence: 0, bossCore: 0 },
    enemies: new Map([[enemy.id, enemy]]),
    committedSavePoint: {
      id: "campfire:test",
      label: "test",
      position: { x: 0, y: 0 },
      level: 1,
    },
    input: { intent: { x: 0, y: 0 }, source: "system", at: 1 },
    destination: null,
    attackElapsed: 0,
    enemyAttackStandoff: 1,
    deathResourceLossRate: 0.25,
    resolveEnemyRespawnPosition,
  });

describe("wall-safe runtime spawns", () => {
  it("keeps unobstructed authored positions exact and uses deterministic terrain-safe wall fallback", () => {
    const buildings = [wall({ x: 0, y: 0 })];
    const exact = { x: -2.5, y: -0.25 };
    expect(nearestWallSafePosition(exact, buildings, 0.42)).toBe(exact);

    const position = nearestWallSafePosition(
      { x: 0, y: 0 },
      buildings,
      0.28,
      (candidate) => candidate.x > 0 || candidate.y < 0,
    );
    expect(position).toEqual({ x: 0, y: 1 });
  });

  it("materializes a saved-wall neighborhood enemy outside its actual clearance", () => {
    const saved = savedAtHome();
    const session = new GameSession({
      saved: {
        ...saved,
        world: { seed: "wall-spawns", generatorVersion: WANDERER_WEB_V3 },
        buildings: [wall({ x: 2, y: 0 })],
      },
      chunkRecipeSource: recipeSource,
    });
    const enemy = session
      .presentation()
      .renderer.enemies.find((candidate) => candidate.id === spawn.id);
    expect(enemy).toBeDefined();
    if (enemy === undefined) throw new Error("missing spawned enemy");
    expect(enemy.position).not.toEqual(spawn.position);
    expect(
      wallBlocksPosition(
        enemy.position,
        session.presentation().ui.buildings,
        enemyTerrainClearanceFor(enemy.kind),
      ),
    ).toBe(false);
  });

  it("defers a blocked ordinary respawn without changing defeated state, then safely relocates it", () => {
    const buildings = [wall({ x: 2, y: 0 })];
    const blocked = runtimeEnemy();
    expect(respawnPhase(blocked).enemies.get(blocked.id)).toMatchObject({
      position: blocked.spawnPosition,
      defeated: false,
      respawnAt: null,
    });
    const deferred = respawnPhase(blocked, () => null).enemies.get(blocked.id);
    expect(deferred).toMatchObject({
      defeated: true,
      respawnAt: 1,
      position: { x: 3, y: 0 },
    });

    const respawned = respawnPhase(blocked, (position, candidate) =>
      nearestWallSafePosition(
        position,
        buildings,
        enemyTerrainClearanceFor(candidate.kind),
      ),
    ).enemies.get(blocked.id);
    expect(respawned).toMatchObject({ defeated: false, respawnAt: null });
    expect(respawned).toBeDefined();
    if (respawned === undefined) throw new Error("missing respawned enemy");
    expect(
      wallBlocksPosition(
        respawned.position,
        buildings,
        enemyTerrainClearanceFor(respawned.kind),
      ),
    ).toBe(false);
  });

  it("keeps a real enemy respawn clear when a wall is built over its original spawn after defeat", () => {
    const session = new GameSession({
      saved: savedAtHome(),
      chunkRecipeSource: recipeSource,
    });
    const observedEnemy = () =>
      session.diagnostics().enemies.find((enemy) => enemy.id === spawn.id)!;
    for (let step = 0; step < 100 && !observedEnemy().defeated; step += 1)
      session.tick(0.1);
    expect(observedEnemy().defeated).toBe(true);
    expect(observedEnemy().spawnPosition).toEqual(spawn.position);
    const placed = session.placeBuilding("StoneWall", { x: 2, y: 0 });
    expect(placed.ok).toBe(true);
    for (let step = 0; step < 160 && observedEnemy().defeated; step += 1)
      session.tick(0.1);
    const respawned = observedEnemy();
    expect(respawned.defeated).toBe(false);
    expect(respawned.hp).toBe(respawned.maxHp);
    expect(
      wallBlocksPosition(
        respawned.position,
        session.presentation().ui.buildings,
        enemyTerrainClearanceFor(respawned.kind),
      ),
    ).toBe(false);
    expect(respawned.position).not.toEqual(spawn.position);
  });

  it("reserves future campfire return positions without resnapping or changing the committed save point", () => {
    const saved = savedAtHome();
    const future = { x: 4.25, y: 1.1 };
    const session = new GameSession({
      saved,
      chunkRecipeSource: (world, coordinate) => {
        const recipe = recipeSource(world, coordinate);
        return coordinate.x === 0 && coordinate.y === 0
          ? {
              ...recipe,
              campfires: [
                ...recipe.campfires,
                { id: "campfire:future", kind: "wild", position: future },
              ],
            }
          : recipe;
      },
    });
    const before = session.diagnostics();
    expect(session.placeBuilding("WoodWall", { x: 4, y: 1 })).toMatchObject({
      ok: false,
      rejection: { kind: "occupied-by-actor" },
    });
    expect(session.diagnostics().resources).toEqual(before.resources);
    expect(session.diagnostics().serials).toEqual(before.serials);
    expect(session.diagnostics().committedSavePoint).toEqual(
      before.committedSavePoint,
    );
  });

  it("fails closed for invalid spawn points and copies a caller-owned resolved position", () => {
    expect(nearestWallSafePosition({ x: NaN, y: 0 }, [])).toBeNull();
    expect(nearestWallSafePosition({ x: Infinity, y: 0 }, [])).toBeNull();
    const callerPosition = { x: 6, y: 2 };
    const enemy = runtimeEnemy();
    const result = respawnPhase(enemy, () => callerPosition);
    callerPosition.x = 100;
    expect(result.enemies.get(enemy.id)?.position).toEqual({ x: 6, y: 2 });
    expect(enemy.defeated).toBe(true);
  });

  it("leaves an exhausted wall search retryable and protects the committed return point", () => {
    const origin = { x: 0, y: 0 };
    const candidateBlockers = [wall(origin)];
    const allBlocked = nearestWallSafePosition(
      origin,
      candidateBlockers,
      0.28,
      () => true,
    );
    expect(allBlocked).toBeNull();

    const saved = savedAtHome();
    const session = new GameSession({
      saved: {
        ...saved,
        player: { ...saved.player, position: { x: -2, y: 0 } },
      },
      chunkRecipeSource: recipeSource,
    });
    expect(session.placeBuilding("WoodWall", { x: 0, y: 0 })).toMatchObject({
      ok: false,
      rejection: { kind: "occupied-by-actor" },
    });
  });
});
