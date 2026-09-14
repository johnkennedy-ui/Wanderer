import { describe, expect, it } from "vitest";
import { GameSession } from "../../domain/GameSession";
import { waveEnemyDraftsFor } from "../../domain/session/wavePolicy";
import type { ChunkRecipe, WorldIdentity } from "../../domain/types";
import { WANDERER_WEB_V3, generateChunk } from "../../domain/world";
import {
  enemyTerrainClearanceFor,
  terrainBlocksPosition,
} from "../../domain/world/terrainCollision";
import { savedAtHome } from "./session-test-helpers";

const advance = (session: GameSession, seconds: number): void => {
  for (let step = 0; step < seconds * 10; step += 1) session.tick(0.1);
};

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

  it("retries a fully blocked V3 wave without inserting blocked drafts", () => {
    const world = {
      seed: "fully-blocked-wave",
      generatorVersion: WANDERER_WEB_V3,
    };
    let blocked = true;
    const recipeSource = (
      _world: WorldIdentity,
      coordinate: { x: number; y: number },
    ): ChunkRecipe => {
      return {
        coordinate,
        key: `${coordinate.x},${coordinate.y}`,
        domainSeeds: {},
        obstacles: blocked
          ? [
              {
                id: "water:wave-exhaustion",
                kind: "water",
                waterKind: "lake",
                radius: 20,
                position: { x: 0, y: 0 },
              },
            ]
          : [],
        campfires: [],
        spawns: [],
      };
    };
    const session = new GameSession({ world, chunkRecipeSource: recipeSource });
    advance(session, 119.9);
    session.tick(0.1);

    expect(
      session.diagnostics().enemies.filter((enemy) => enemy.waveIndex === 1),
    ).toEqual([]);
    expect(session.presentation().ui.wave).toMatchObject({
      active: true,
      waveIndex: 1,
      bossActive: false,
    });

    blocked = false;
    session.resetWorld(world.seed);
    session.tick(0.1);
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
    session.tick(0.1);
    expect(
      session.diagnostics().enemies.filter((enemy) => enemy.waveIndex === 1),
    ).toHaveLength(16);
  });
});
