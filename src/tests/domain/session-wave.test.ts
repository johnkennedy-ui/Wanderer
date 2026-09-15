import { describe, expect, it } from "vitest";
import { GameSession } from "../../domain/GameSession";
import { waveEnemyDraftsFor } from "../../domain/session/wavePolicy";
import type {
  ChunkObstacle,
  ChunkRecipe,
  WorldIdentity,
} from "../../domain/types";
import { WANDERER_WEB_V3, generateChunk } from "../../domain/world";
import {
  enemyTerrainClearanceFor,
  terrainBlocksPosition,
} from "../../domain/world/terrainCollision";
import { savedAtHome } from "./session-test-helpers";

const advance = (session: GameSession, seconds: number): void => {
  for (let step = 0; step < seconds * 10; step += 1) session.tick(0.1);
};

const blockedWaveFixture = () => {
  const world = {
    seed: "wave-expiry-boundary",
    generatorVersion: WANDERER_WEB_V3,
  };
  const sourceObstacles: ChunkObstacle[] = [
    {
      id: "water:wave-expiry-boundary",
      kind: "water",
      waterKind: "lake",
      radius: 30,
      position: { x: 0, y: 0 },
    },
  ];
  const recipeSource = (
    _world: WorldIdentity,
    coordinate: { x: number; y: number },
  ): ChunkRecipe => ({
    coordinate,
    key: `${coordinate.x},${coordinate.y}`,
    domainSeeds: {},
    // Cached recipes retain this public accessor. It returns a fresh snapshot
    // of the test-owned source data, so the same session can unblock a retry.
    get obstacles() {
      return sourceObstacles.map((obstacle) => ({
        ...obstacle,
        position: { ...obstacle.position },
      }));
    },
    campfires: [],
    spawns: [],
  });
  const saved = savedAtHome();
  const session = new GameSession({
    saved: {
      ...saved,
      world,
      player: { ...saved.player, position: { x: 1, y: 1 } },
    },
    chunkRecipeSource: recipeSource,
  });
  advance(session, 120);
  expect(
    session.diagnostics().enemies.filter((enemy) => enemy.waveIndex === 1),
  ).toEqual([]);
  advance(session, 29.9);
  sourceObstacles.splice(0);
  return session;
};

const waveOneEnemies = (session: GameSession) =>
  session.diagnostics().enemies.filter((enemy) => enemy.waveIndex === 1);

describe("GameSession timed waves", () => {
  it("materializes one five-times-density wave at 120 seconds and clears only its normal enemies at the window end", () => {
    const session = new GameSession({
      world: { seed: "wave-session-seed", generatorVersion: "wanderer-web-v2" },
    });
    advance(session, 120);
    const active = session
      .diagnostics()
      .enemies.filter((enemy) => enemy.waveIndex === 1);
    expect(active.filter((enemy) => !enemy.isWaveBoss)).toHaveLength(15);
    expect(active.filter((enemy) => enemy.isWaveBoss)).toHaveLength(1);
    expect(session.presentation().ui.wave).toMatchObject({
      active: true,
      waveIndex: 1,
      bossActive: true,
    });

    advance(session, 30);
    const expired = session
      .diagnostics()
      .enemies.filter((enemy) => enemy.waveIndex === 1 && !enemy.isWaveBoss);
    expect(expired).toEqual([]);
    expect(session.presentation().ui.wave.active).toBe(false);
  });

  it("relocates V3 timed-wave drafts from terrain without changing their IDs or count", () => {
    const world = {
      seed: "wave-terrain-safety-seed",
      generatorVersion: WANDERER_WEB_V3,
    };
    const obstacle = [-1, 0, 1]
      .flatMap((y) =>
        [-1, 0, 1].flatMap((x) => generateChunk(world, { x, y }).obstacles),
      )
      .at(0);
    if (obstacle === undefined) throw new Error("expected V3 terrain witness");

    const rawAtOrigin = waveEnemyDraftsFor({
      seed: world.seed,
      waveIndex: 1,
      center: { x: 0, y: 0 },
    });
    const center = {
      x: obstacle.position.x - rawAtOrigin[0].position.x,
      y: obstacle.position.y - rawAtOrigin[0].position.y,
    };
    const rawDrafts = waveEnemyDraftsFor({
      seed: world.seed,
      waveIndex: 1,
      center,
    });
    expect(
      terrainBlocksPosition(
        world,
        rawDrafts[0].position,
        generateChunk,
        enemyTerrainClearanceFor(rawDrafts[0].kind),
      ),
    ).toBe(true);

    const saved = savedAtHome();
    const session = new GameSession({
      saved: {
        ...saved,
        world,
        player: { ...saved.player, position: center },
      },
    });
    advance(session, 120);
    const actual = session
      .diagnostics()
      .enemies.filter((enemy) => enemy.waveIndex === 1);

    expect(actual).toHaveLength(16);
    expect(actual.map((enemy) => enemy.id).sort()).toEqual(
      rawDrafts.map((enemy) => enemy.id).sort(),
    );
    expect(
      actual.every(
        (enemy) =>
          !terrainBlocksPosition(
            world,
            enemy.spawnPosition,
            generateChunk,
            enemyTerrainClearanceFor(enemy.kind),
          ) &&
          !terrainBlocksPosition(
            world,
            enemy.position,
            generateChunk,
            enemyTerrainClearanceFor(enemy.kind),
          ),
      ),
    ).toBe(true);
    expect(
      actual.find((enemy) => enemy.id === rawDrafts[0].id)?.spawnPosition,
    ).not.toEqual(rawDrafts[0].spawnPosition);
  });

  it("keeps a blocked V3 wave pending across its window and retries in the same session", () => {
    const world = {
      seed: "fully-blocked-wave",
      generatorVersion: WANDERER_WEB_V3,
    };
    const recipeSource = (
      _world: WorldIdentity,
      coordinate: { x: number; y: number },
    ): ChunkRecipe => {
      return {
        coordinate,
        key: `${coordinate.x},${coordinate.y}`,
        domainSeeds: {},
        obstacles: [
          {
            id: "water:wave-exhaustion",
            kind: "water",
            waterKind: "lake",
            radius: 30,
            position: { x: 0, y: 0 },
          },
        ],
        campfires: [],
        spawns: [],
      };
    };
    const saved = savedAtHome();
    const session = new GameSession({
      saved: {
        ...saved,
        world,
        // Start fractionally off-center so keyboard input can retreat from the
        // static footprint through the normal outward-movement resolver.
        player: { ...saved.player, position: { x: 1, y: 1 } },
      },
      chunkRecipeSource: recipeSource,
    });
    advance(session, 120);

    expect(
      session.diagnostics().enemies.filter((enemy) => enemy.waveIndex === 1),
    ).toEqual([]);
    expect(session.presentation().ui.wave).toMatchObject({
      active: true,
      waveIndex: 1,
      bossActive: false,
    });

    // The original window has closed, but no reset clears the pending work.
    advance(session, 30);
    expect(
      session.diagnostics().enemies.filter((enemy) => enemy.waveIndex === 1),
    ).toEqual([]);
    expect(session.presentation().ui.wave.active).toBe(false);

    // Keyboard retreat is an ordinary supported movement input. Once the
    // player has left the static blocked region, the retained full wave can
    // safely materialize around that current position in this same session.
    session.move({ intent: { x: 1, y: 1 }, source: "keyboard", at: 151 });
    advance(session, 25);
    const expected = waveEnemyDraftsFor({
      seed: world.seed,
      waveIndex: 1,
      center: { x: 0, y: 0 },
    });
    const retried = session
      .diagnostics()
      .enemies.filter((enemy) => enemy.waveIndex === 1);

    expect(retried).toHaveLength(16);
    expect(retried.map((enemy) => enemy.id).sort()).toEqual(
      expected.map((enemy) => enemy.id).sort(),
    );
    expect(session.presentation().ui.wave.bossActive).toBe(true);
    expect(session.presentation().ui.wave.active).toBe(false);
    const normalEnemies = retried.filter((enemy) => !enemy.isWaveBoss);
    expect(normalEnemies).toHaveLength(15);
    expect(
      normalEnemies.every((enemy) => (enemy.waveExpiresAt ?? 0) > 175),
    ).toBe(true);
    session.tick(0.1);
    expect(
      session.diagnostics().enemies.filter((enemy) => enemy.waveIndex === 1),
    ).toHaveLength(16);
  });

  it("extends a pending wave that becomes placeable within, at, or after the expiry tolerance", () => {
    for (const retryOffset of [0, 0.000_000_2, 0.000_000_4]) {
      const session = blockedWaveFixture();
      // The first retry is 149.9999998; the latter two are at and just after
      // 150. All normalize outside the original wave window.
      session.tick(0.099_999_8 + retryOffset);

      const materialized = waveOneEnemies(session);
      const normalEnemies = materialized.filter((enemy) => !enemy.isWaveBoss);
      expect(session.presentation().ui.wave.active).toBe(false);
      expect(materialized).toHaveLength(16);
      expect(normalEnemies).toHaveLength(15);
      expect(
        normalEnemies.every((enemy) => (enemy.waveExpiresAt ?? 0) > 150),
      ).toBe(true);

      session.tick(0.1);
      expect(waveOneEnemies(session)).toHaveLength(16);
    }
  });

  it("keeps the original expiry for a wave retried before the cleanup tolerance", () => {
    const session = blockedWaveFixture();
    // This retry remains more than one microsecond before the original end.
    session.tick(0.099_998);

    const normalEnemies = waveOneEnemies(session).filter(
      (enemy) => !enemy.isWaveBoss,
    );
    expect(session.presentation().ui.wave.active).toBe(true);
    expect(normalEnemies).toHaveLength(15);
    expect(normalEnemies.every((enemy) => enemy.waveExpiresAt === 150)).toBe(
      true,
    );

    session.tick(0.1);
    expect(
      waveOneEnemies(session).filter((enemy) => !enemy.isWaveBoss),
    ).toEqual([]);
  });
});
