import { describe, expect, it } from "vitest";
import {
  EnemyNavigationCache,
  routeEnemyPosition,
} from "../../domain/session/enemyNavigation";
import { roundVector } from "../../domain/math";
import {
  sweepTerrainMovement,
  terrainBlocksPosition,
} from "../../domain/world/terrainCollision";
import type {
  ChunkObstacle,
  ChunkRecipe,
  WorldIdentity,
} from "../../domain/types";
import { WANDERER_WEB_V3 } from "../../domain/world";

const world: WorldIdentity = {
  seed: "routing",
  generatorVersion: WANDERER_WEB_V3,
};
const source = (
  _world: WorldIdentity,
  coordinate: { x: number; y: number },
): ChunkRecipe => ({
  coordinate,
  key: `${coordinate.x},${coordinate.y}`,
  domainSeeds: {},
  obstacles: [
    { id: "tree:route", kind: "tree", radius: 1, position: { x: 0, y: 0 } },
  ],
  campfires: [],
  spawns: [],
});
const route = (
  from: { x: number; y: number },
  target: { x: number; y: number },
) =>
  routeEnemyPosition({
    from,
    target,
    desired: {
      x: from.x + (target.x - from.x) * 0.1,
      y: from.y + (target.y - from.y) * 0.1,
    },
    enemyId: "enemy:route",
    constrain: (start, desired) =>
      sweepTerrainMovement(world, start, desired, source, 0.28),
  });

const repeatedRoute = (
  start: { x: number; y: number },
  target: { x: number; y: number },
  obstacles: readonly ChunkObstacle[],
  steps = 60,
) => {
  const obstacleSource = (
    _world: WorldIdentity,
    coordinate: { x: number; y: number },
  ): ChunkRecipe => ({
    coordinate,
    key: `${coordinate.x},${coordinate.y}`,
    domainSeeds: {},
    obstacles,
    campfires: [],
    spawns: [],
  });
  let position = start;
  const positions = [position];
  const navigation = new EnemyNavigationCache();
  for (let step = 0; step < steps; step += 1) {
    const dx = target.x - position.x;
    const dy = target.y - position.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) break;
    position = roundVector(
      navigation.route({
        from: position,
        desired: {
          x: position.x + (dx / length) * 0.3,
          y: position.y + (dy / length) * 0.3,
        },
        target,
        enemyId: "enemy:repeated-route",
        constrain: (from, desired) =>
          sweepTerrainMovement(world, from, desired, obstacleSource, 0.28),
      }),
    );
    positions.push(position);
  }
  return { positions, obstacleSource };
};

describe("enemy navigation", () => {
  it("causally escapes a straight-pursuit stop by choosing a safe tangent", () => {
    const from = { x: -1.3, y: 0 };
    const target = { x: 4, y: 0 };
    const stopped = sweepTerrainMovement(
      world,
      from,
      { x: -0.77, y: 0 },
      source,
      0.28,
    );
    expect(stopped.x).toBeGreaterThan(from.x);
    expect(stopped.x).toBeLessThan(-1.28);
    expect(stopped.y).toBe(0);
    const routed = route(from, target);
    expect(routed.y).not.toBe(0);
    expect(
      Math.hypot(routed.x - from.x, routed.y - from.y),
    ).toBeLessThanOrEqual(0.53);
  });

  it("is deterministic, has a fixed planner sweep budget, and preserves a clear direct move", () => {
    let calls = 0;
    const constrained = routeEnemyPosition({
      from: { x: -1.3, y: 0 },
      desired: { x: -0.77, y: 0 },
      target: { x: 4, y: 0 },
      enemyId: "enemy:route",
      constrain: (from, desired) => {
        calls += 1;
        return sweepTerrainMovement(world, from, desired, source, 0.28);
      },
    });
    expect(calls).toBeLessThanOrEqual(160);
    expect(constrained).toEqual(route({ x: -1.3, y: 0 }, { x: 4, y: 0 }));
    expect(route({ x: -3, y: 3 }, { x: -3, y: 5 })).toEqual({ x: -3, y: 3.2 });
  });

  it("uses the current moving target and stops safely when every route is closed", () => {
    const right = route({ x: -1.3, y: 0 }, { x: 4, y: 0 });
    const up = route({ x: -1.3, y: 0 }, { x: -1.3, y: 4 });
    expect(right).not.toEqual(up);
    const cache = new EnemyNavigationCache();
    let calls = 0;
    const closed = {
      from: { x: 0, y: 0 },
      desired: { x: 1, y: 0 },
      target: { x: 4, y: 0 },
      enemyId: "enemy:closed",
      constrain: (from: { x: number; y: number }) => {
        calls += 1;
        return from;
      },
    };
    expect(cache.route(closed)).toEqual({ x: 0, y: 0 });
    const firstPlanCalls = calls;
    expect(firstPlanCalls).toBeLessThanOrEqual(160);
    expect(cache.route(closed)).toEqual({ x: 0, y: 0 });
    expect(calls).toBe(firstPlanCalls);
    expect(
      routeEnemyPosition({
        from: { x: 0, y: 0 },
        desired: { x: 1, y: 0 },
        target: { x: 4, y: 0 },
        enemyId: "enemy:closed",
        constrain: (from) => from,
      }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("keeps the larger boss clearance while routing around the same obstacle", () => {
    const from = { x: -1.64, y: 0 };
    const routed = routeEnemyPosition({
      from,
      desired: { x: -1.24, y: 0 },
      target: { x: 4, y: 0 },
      enemyId: "enemy:boss-route",
      constrain: (start, desired) =>
        sweepTerrainMovement(world, start, desired, source, 0.62),
    });
    expect(routed.y).not.toBe(0);
    expect(
      Math.hypot(routed.x - from.x, routed.y - from.y),
    ).toBeLessThanOrEqual(0.4);
  });

  it("makes repeated safe progress around tree/rock clusters at a chunk boundary", () => {
    const start = { x: 14, y: 0 };
    const target = { x: 20, y: 0 };
    const obstacles: readonly ChunkObstacle[] = [
      {
        id: "tree:boundary",
        kind: "tree",
        radius: 1,
        position: { x: 15.5, y: 0 },
      },
      {
        id: "rock:boundary",
        kind: "rock",
        radius: 1,
        position: { x: 16.8, y: -0.8 },
      },
    ];
    const { positions, obstacleSource } = repeatedRoute(
      start,
      target,
      obstacles,
    );
    const final = positions.at(-1)!;
    expect(Math.hypot(final.x - target.x, final.y - target.y)).toBeLessThan(
      0.7,
    );
    for (let index = 1; index < positions.length; index += 1) {
      expect(
        Math.hypot(
          positions[index].x - positions[index - 1].x,
          positions[index].y - positions[index - 1].y,
        ),
      ).toBeLessThanOrEqual(0.300001);
      expect(
        terrainBlocksPosition(world, positions[index], obstacleSource, 0.28),
      ).toBe(false);
    }
  });

  it("takes a bounded local detour when the target is beyond one sweep", () => {
    const obstacles: readonly ChunkObstacle[] = [
      { id: "tree:distant", kind: "tree", radius: 1, position: { x: 0, y: 0 } },
    ];
    const { positions, obstacleSource } = repeatedRoute(
      { x: -3, y: 0 },
      { x: 30, y: 0 },
      obstacles,
      160,
    );
    expect(positions.at(-1)!.x).toBeGreaterThan(20);
    for (const position of positions)
      expect(terrainBlocksPosition(world, position, obstacleSource, 0.28)).toBe(
        false,
      );
  });
});
