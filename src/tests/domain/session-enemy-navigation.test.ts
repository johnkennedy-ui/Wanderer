import { describe, expect, it } from "vitest";
import { enemyDefinitions } from "../../data/definitions";
import { GameSession } from "../../domain/GameSession";
import {
  enemyTerrainClearanceFor,
  terrainBlocksPosition,
} from "../../domain/world/terrainCollision";
import type {
  ChunkObstacle,
  ChunkRecipe,
  EnemyKind,
  WorldIdentity,
} from "../../domain/types";
import { chunkCoordinateFor, WANDERER_WEB_V3 } from "../../domain/world";
import { savedAtHome } from "./session-test-helpers";

const world: WorldIdentity = {
  seed: "session-routing",
  generatorVersion: WANDERER_WEB_V3,
};
const fixtureSource =
  (
    obstacles: readonly ChunkObstacle[],
    kind: EnemyKind = "scout",
    spawnPosition = { x: -1.3, y: 0 },
  ) =>
  (
    _world: WorldIdentity,
    coordinate: { x: number; y: number },
  ): ChunkRecipe => ({
    coordinate,
    key: `${coordinate.x},${coordinate.y}`,
    domainSeeds: {},
    obstacles: obstacles.filter((obstacle) => {
      const obstacleChunk = chunkCoordinateFor(obstacle.position);
      return (
        obstacleChunk.x === coordinate.x && obstacleChunk.y === coordinate.y
      );
    }),
    campfires: [],
    spawns:
      coordinate.x === -1 && coordinate.y === 0
        ? [
            {
              id: "enemy:session-route",
              kind,
              position: spawnPosition,
              danger: {
                tier: 1,
                label: "fixture",
                distance: 1,
                healthMultiplier: 1,
                damageMultiplier: 1,
                dropMultiplier: 1,
              },
            },
          ]
        : [],
  });

const source = fixtureSource([
  {
    id: "rock:session-route",
    kind: "rock",
    radius: 1,
    position: { x: 0, y: 0 },
  },
]);

const enemyAfterTicks = (
  delta: number,
  obstacles: readonly ChunkObstacle[],
  kind: EnemyKind = "scout",
) => {
  const saved = savedAtHome();
  const session = new GameSession({
    saved: {
      ...saved,
      world,
      player: {
        ...saved.player,
        hp: 999,
        maxHp: 999,
        position: { x: 4, y: 0 },
      },
    },
    chunkRecipeSource: fixtureSource(obstacles, kind),
  });
  for (let tick = 0; tick < 180; tick += 1) session.tick(delta);
  return session
    .diagnostics()
    .enemies.find((entry) => entry.id === "enemy:session-route")!;
};

const enemyPositionsAfterTicks = (
  delta: number,
  obstacles: readonly ChunkObstacle[],
  kind: EnemyKind,
  maxSeconds = 18,
) => {
  const saved = savedAtHome();
  const session = new GameSession({
    saved: {
      ...saved,
      world,
      player: {
        ...saved.player,
        hp: 999,
        maxHp: 999,
        position: { x: 4, y: 0 },
      },
    },
    chunkRecipeSource: fixtureSource(obstacles, kind, { x: -3, y: 0 }),
  });
  const positions = [enemyPosition(session)];
  for (let tick = 0; tick < Math.ceil(maxSeconds / delta); tick += 1) {
    session.tick(delta);
    const position = enemyPosition(session);
    positions.push(position);
    if (Math.hypot(position.x - 4, position.y) <= 1.81) break;
  }
  return positions;
};

const enemyPosition = (session: GameSession) =>
  session
    .diagnostics()
    .enemies.find((entry) => entry.id === "enemy:session-route")!.position;

const expectSafePursuit = (
  positions: readonly { x: number; y: number }[],
  delta: number,
  obstacles: readonly ChunkObstacle[],
  kind: EnemyKind,
) => {
  const clearance = enemyTerrainClearanceFor(kind);
  for (let index = 0; index < positions.length; index += 1) {
    if (index > 0)
      expect(
        Math.hypot(
          positions[index].x - positions[index - 1].x,
          positions[index].y - positions[index - 1].y,
        ),
      ).toBeLessThanOrEqual(
        enemyDefinitions[kind].moveSpeed * delta + 0.000001,
      );
    expect(
      terrainBlocksPosition(
        world,
        positions[index],
        fixtureSource(obstacles, kind),
        clearance,
      ),
    ).toBe(false);
  }
};

const tickPositions = (session: GameSession, delta: number, ticks: number) => {
  const positions = [enemyPosition(session)];
  for (let tick = 0; tick < ticks; tick += 1) {
    session.tick(delta);
    positions.push(enemyPosition(session));
  }
  return positions;
};

describe("GameSession enemy navigation consumer", () => {
  it("routes the public runtime enemy around a blocking rock without changing clearance", () => {
    const saved = savedAtHome();
    const session = new GameSession({
      saved: {
        ...saved,
        world,
        player: { ...saved.player, position: { x: 4, y: 0 } },
      },
      chunkRecipeSource: source,
    });
    session.tick(0.1);
    const enemy = session
      .diagnostics()
      .enemies.find((entry) => entry.id === "enemy:session-route");
    expect(enemy).toBeDefined();
    expect(enemy?.position.y).not.toBe(0);
    expect(
      terrainBlocksPosition(
        world,
        enemy!.position,
        source,
        enemyTerrainClearanceFor("scout"),
      ),
    ).toBe(false);
  });

  it.each([0.004, 0.008, 1 / 120, 0.016, 1 / 60, 0.05, 0.1])(
    "reaches attack range around a true-chunk tree at %s seconds for every clearance",
    (delta) => {
      const obstacles: readonly ChunkObstacle[] = [
        {
          id: "tree:small-frame",
          kind: "tree",
          radius: 1,
          position: { x: 0, y: 0 },
        },
      ];
      for (const kind of ["scout", "brute", "boss"] as const) {
        const positions = enemyPositionsAfterTicks(delta, obstacles, kind);
        const final = positions.at(-1)!;
        expect(Math.hypot(final.x - 4, final.y)).toBeLessThanOrEqual(1.81);
        expectSafePursuit(positions, delta, obstacles, kind);
      }
    },
  );

  it.each([0.016, 0.05, 0.1])(
    "reaches attack range around a true-chunk tree/rock pair at %s seconds",
    (delta) => {
      const obstacles: readonly ChunkObstacle[] = [
        { id: "tree:pair", kind: "tree", radius: 1, position: { x: 0, y: 0 } },
        {
          id: "rock:pair",
          kind: "rock",
          radius: 1,
          position: { x: 1.3, y: -0.8 },
        },
      ];
      const enemy = enemyAfterTicks(delta, obstacles);
      expect(
        Math.hypot(enemy.position.x - 4, enemy.position.y),
      ).toBeLessThanOrEqual(1.81);
      expect(
        terrainBlocksPosition(
          world,
          enemy.position,
          fixtureSource(obstacles),
          enemyTerrainClearanceFor("scout"),
        ),
      ).toBe(false);
    },
  );

  it("converges around paired trees and keeps the boss outside terrain", () => {
    const obstacles: readonly ChunkObstacle[] = [
      {
        id: "tree:upper",
        kind: "tree",
        radius: 1,
        position: { x: 0, y: 0.85 },
      },
      {
        id: "tree:lower",
        kind: "tree",
        radius: 1,
        position: { x: 0, y: -0.85 },
      },
    ];
    const scoutPositions = enemyPositionsAfterTicks(0.1, obstacles, "scout");
    const scout = scoutPositions.at(-1)!;
    const bossPositions = enemyPositionsAfterTicks(0.1, obstacles, "boss");
    const boss = bossPositions.at(-1)!;
    expect(Math.hypot(scout.x - 4, scout.y)).toBeLessThanOrEqual(1.81);
    expect(
      terrainBlocksPosition(
        world,
        scout,
        fixtureSource(obstacles),
        enemyTerrainClearanceFor("scout"),
      ),
    ).toBe(false);
    expect(
      terrainBlocksPosition(
        world,
        boss,
        fixtureSource(obstacles, "boss"),
        enemyTerrainClearanceFor("boss"),
      ),
    ).toBe(false);
    expect(Math.hypot(boss.x - 4, boss.y)).toBeLessThanOrEqual(1.81);
    for (let index = 1; index < bossPositions.length; index += 1) {
      expect(
        Math.hypot(
          bossPositions[index].x - bossPositions[index - 1].x,
          bossPositions[index].y - bossPositions[index - 1].y,
        ),
      ).toBeLessThanOrEqual(0.125001);
      expect(
        terrainBlocksPosition(
          world,
          bossPositions[index],
          fixtureSource(obstacles, "boss"),
          enemyTerrainClearanceFor("boss"),
        ),
      ).toBe(false);
    }
  });

  it("replans for a moving GameSession target without exceeding pursuit speed", () => {
    const obstacles: readonly ChunkObstacle[] = [
      { id: "tree:moving", kind: "tree", radius: 1, position: { x: 0, y: 0 } },
    ];
    const saved = savedAtHome();
    const session = new GameSession({
      saved: {
        ...saved,
        world,
        player: {
          ...saved.player,
          hp: 999,
          maxHp: 999,
          position: { x: 4, y: 0 },
        },
      },
      chunkRecipeSource: fixtureSource(obstacles),
    });
    const beforeMove = tickPositions(session, 0.1, 30);
    session.setDestination({
      destination: { x: 4, y: -3 },
      source: "tap-to-move",
      at: 3,
    });
    const afterMove = tickPositions(session, 0.1, 20);
    const positions = [...beforeMove, ...afterMove.slice(1)];
    expect(session.diagnostics().player.position.y).toBeLessThanOrEqual(-2.99);
    for (let index = 1; index < positions.length; index += 1) {
      expect(
        Math.hypot(
          positions[index].x - positions[index - 1].x,
          positions[index].y - positions[index - 1].y,
        ),
      ).toBeLessThanOrEqual(0.320001);
      expect(
        terrainBlocksPosition(
          world,
          positions[index],
          fixtureSource(obstacles),
          enemyTerrainClearanceFor("scout"),
        ),
      ).toBe(false);
    }
  });

  it("stays collision-safe and bounded when the GameSession route is closed", () => {
    const obstacles: readonly ChunkObstacle[] = [
      { id: "rock:left", kind: "rock", radius: 1, position: { x: -2.6, y: 0 } },
      { id: "rock:right", kind: "rock", radius: 1, position: { x: 0, y: 0 } },
      {
        id: "rock:top",
        kind: "rock",
        radius: 1,
        position: { x: -1.3, y: 1.3 },
      },
      {
        id: "rock:bottom",
        kind: "rock",
        radius: 1,
        position: { x: -1.3, y: -1.3 },
      },
    ];
    const saved = savedAtHome();
    const session = new GameSession({
      saved: {
        ...saved,
        world,
        player: {
          ...saved.player,
          hp: 999,
          maxHp: 999,
          position: { x: 4, y: 0 },
        },
      },
      chunkRecipeSource: fixtureSource(obstacles),
    });
    const positions = tickPositions(session, 0.1, 40);
    expect(
      new Set(positions.map(({ x, y }) => `${x},${y}`)).size,
    ).toBeLessThanOrEqual(2);
    for (let index = 0; index < positions.length; index += 1) {
      if (index > 0)
        expect(
          Math.hypot(
            positions[index].x - positions[index - 1].x,
            positions[index].y - positions[index - 1].y,
          ),
        ).toBeLessThanOrEqual(0.320001);
      const position = positions[index];
      expect(
        terrainBlocksPosition(
          world,
          position,
          fixtureSource(obstacles),
          enemyTerrainClearanceFor("scout"),
        ),
      ).toBe(false);
    }
  });

  it("repeats the same bounded GameSession route deterministically", () => {
    const obstacles: readonly ChunkObstacle[] = [
      { id: "tree:repeat", kind: "tree", radius: 1, position: { x: 0, y: 0 } },
      {
        id: "rock:repeat",
        kind: "rock",
        radius: 1,
        position: { x: 1.2, y: -0.7 },
      },
    ];
    const create = () => {
      const saved = savedAtHome();
      return new GameSession({
        saved: {
          ...saved,
          world,
          player: {
            ...saved.player,
            hp: 999,
            maxHp: 999,
            position: { x: 4, y: 0 },
          },
        },
        chunkRecipeSource: fixtureSource(obstacles),
      });
    };
    const first = create();
    const second = create();
    expect(tickPositions(first, 0.05, 120)).toEqual(
      tickPositions(second, 0.05, 120),
    );
  });
});
