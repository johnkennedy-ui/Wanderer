import { describe, expect, it } from "vitest";
import { roundVector } from "../../domain/math";
import type { ChunkRecipe, WorldIdentity } from "../../domain/types";
import { WANDERER_WEB_V3 } from "../../domain/world";
import { advanceEnemyCombatPhase } from "../../domain/session/combatTickRuntime";
import type { RuntimeEnemy } from "../../domain/session/sessionState";
import {
  enemyTerrainClearanceFor,
  sweepTerrainMovement,
  terrainBlocksPosition,
} from "../../domain/world/terrainCollision";

const world = { seed: "collision", generatorVersion: WANDERER_WEB_V3 };
const source = (
  _world: WorldIdentity,
  coordinate: { x: number; y: number },
): ChunkRecipe => ({
  coordinate,
  key: `${coordinate.x},${coordinate.y}`,
  domainSeeds: {},
  obstacles:
    coordinate.x === 1
      ? [
          {
            id: "water:border",
            kind: "water",
            waterKind: "river",
            radius: 1,
            position: { x: 16.1, y: 0 },
          },
        ]
      : [],
  campfires: [],
  spawns: [],
});

describe("terrain collision", () => {
  it("uses explicit V3 footprints across chunk borders and cannot tunnel", () => {
    expect(terrainBlocksPosition(world, { x: 15.5, y: 0 }, source)).toBe(true);
    const stopped = sweepTerrainMovement(
      world,
      { x: 14, y: 0 },
      { x: 18, y: 0 },
      source,
    );
    expect(stopped.x).toBeLessThan(14.83);
    expect(stopped.x).toBeGreaterThan(14.7);
  });

  it("permits a rounded actor to retreat and safely graze a tangent", () => {
    const escaped = sweepTerrainMovement(
      world,
      { x: 14.8204, y: 0 },
      { x: 14, y: 0 },
      source,
    );
    expect(escaped).toEqual({ x: 14, y: 0 });
    expect(
      sweepTerrainMovement(
        world,
        { x: 14.82, y: 0 },
        { x: 14.82, y: 1 },
        source,
      ),
    ).toEqual({ x: 14.82, y: 1 });
  });

  it("leaves enough room for two-decimal diagonal position rounding", () => {
    const center = { x: 2.0011, y: 2.0011 };
    const diagonalSource = (
      _world: WorldIdentity,
      coordinate: { x: number; y: number },
    ): ChunkRecipe => ({
      coordinate,
      key: `${coordinate.x},${coordinate.y}`,
      domainSeeds: {},
      obstacles: [
        {
          id: "mountain:diagonal",
          kind: "mountain",
          radius: 1,
          position: center,
        },
      ],
      campfires: [],
      spawns: [],
    });
    const rounded = roundVector(
      sweepTerrainMovement(
        world,
        { x: 0, y: 0 },
        { x: 4, y: 4 },
        diagonalSource,
      ),
    );
    expect(
      Math.hypot(rounded.x - center.x, rounded.y - center.y),
    ).toBeGreaterThanOrEqual(1.28);

    const escaped = roundVector(
      sweepTerrainMovement(
        world,
        { x: 1.1, y: 1.1 },
        { x: 0, y: 0 },
        diagonalSource,
      ),
    );
    expect(
      Math.hypot(escaped.x - center.x, escaped.y - center.y),
    ).toBeGreaterThan(1.28);
  });

  it("collects recipes once per covered chunk instead of probing every 8cm", () => {
    const calls: { x: number; y: number }[] = [];
    const countingSource = (
      requestedWorld: WorldIdentity,
      coordinate: { x: number; y: number },
    ) => {
      calls.push(coordinate);
      return source(requestedWorld, coordinate);
    };
    sweepTerrainMovement(
      world,
      { x: 14, y: 0 },
      { x: 18, y: 0 },
      countingSource,
    );
    expect(calls.length).toBeLessThanOrEqual(6);
    expect(
      new Set(calls.map((coordinate) => `${coordinate.x},${coordinate.y}`))
        .size,
    ).toBe(calls.length);
  });

  it("keeps released V1/V2 movement and exact legacy placement behaviour", () => {
    const v2 = { ...world, generatorVersion: "wanderer-web-v2" };
    expect(terrainBlocksPosition(v2, { x: 15.5, y: 0 }, source)).toBe(false);
    expect(
      sweepTerrainMovement(v2, { x: 14, y: 0 }, { x: 18, y: 0 }, source),
    ).toEqual({
      x: 18,
      y: 0,
    });
    const legacySource = (
      requestedWorld: WorldIdentity,
      coordinate: { x: number; y: number },
    ): ChunkRecipe => ({
      ...source(requestedWorld, coordinate),
      obstacles:
        coordinate.x === 0
          ? [{ id: "legacy-rock", position: { x: 1, y: 1 } }]
          : [],
    });
    expect(
      terrainBlocksPosition(v2, { x: 1.89, y: 1 }, legacySource, 0.62),
    ).toBe(true);
  });

  it("reserves more clearance for bosses than other enemy actors", () => {
    expect(enemyTerrainClearanceFor("boss")).toBeGreaterThan(
      enemyTerrainClearanceFor("scout"),
    );
  });

  it("applies the shared swept resolver to a pursuing boss", () => {
    const boss: RuntimeEnemy = {
      id: "boss:test",
      kind: "boss",
      position: { x: 14, y: 0 },
      spawnPosition: { x: 14, y: 0 },
      hp: 100,
      maxHp: 100,
      damage: 1,
      dangerTier: 1,
      dropMultiplier: 1,
      moveSpeed: 40,
      attackEverySeconds: 5,
      respawnAt: null,
      defeated: false,
      attackElapsed: 0,
    };
    const result = advanceEnemyCombatPhase({
      delta: 0.1,
      elapsed: 1,
      player: { position: { x: 18, y: 0 }, hp: 100, maxHp: 100 },
      resources: { wood: 0, stone: 0, scrap: 0, essence: 0, bossCore: 0 },
      enemies: new Map([[boss.id, boss]]),
      committedSavePoint: {
        id: "campfire:test",
        label: "test",
        position: { x: 0, y: 0 },
        level: 1,
      },
      input: { intent: { x: 0, y: 0 }, source: "system", at: 1 },
      destination: null,
      attackElapsed: 0,
      enemyAttackStandoff: 1.8,
      deathResourceLossRate: 0.25,
      constrainEnemyPosition: (from, desired, enemy) =>
        sweepTerrainMovement(
          world,
          from,
          desired,
          source,
          enemyTerrainClearanceFor(enemy.kind),
        ),
    });
    expect(result.enemies.get(boss.id)?.position.x).toBeLessThan(14.49);
    expect(result.enemies.get(boss.id)?.position.x).toBeGreaterThan(14.4);
    expect(boss.position).toEqual({ x: 14, y: 0 });
  });
});
