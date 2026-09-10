import { describe, expect, it } from "vitest";
import { enemyDefinitions } from "../../data/definitions";
import { GameSession } from "../../domain/GameSession";
import { advanceEnemyCombatPhase } from "../../domain/session/combatTickRuntime";
import { distance } from "../../domain/math";
import {
  missingVisibleRuntimeEnemyDraftsFor,
  visibleChunksFor,
} from "../../domain/session/worldRuntime";
import type { RuntimeEnemy } from "../../domain/session/sessionState";
import {
  generateChunk,
  visibleChunkCoordinates,
  WANDERER_WEB_V1,
  WANDERER_WEB_V2,
} from "../../domain/world";
import { ChunkRecipeCache } from "../../domain/session/chunkRecipeCache";

const world = {
  seed: "world-runtime-review-seed",
  generatorVersion: "wanderer-web-v1",
};

describe("session world runtime coordination", () => {
  for (const generatorVersion of [WANDERER_WEB_V1, WANDERER_WEB_V2]) {
    it(`shares ordered cached recipes while keeping runtime drafts independent (${generatorVersion})`, () => {
      const identity = { ...world, generatorVersion };
      const cache = new ChunkRecipeCache();
      const position = { x: 0, y: 0 };
      const chunks = visibleChunksFor(identity, position, cache.get);
      expect(chunks).toEqual(visibleChunksFor(identity, position));
      const repeated = visibleChunksFor(identity, position, cache.get);
      repeated.forEach((chunk, index) => expect(chunk).toBe(chunks[index]));
      const drafts = missingVisibleRuntimeEnemyDraftsFor({
        visibleChunks: chunks,
        existingEnemies: new Map(),
        defeatedBossIds: new Set(),
      });
      const scout = drafts.find((enemy) => enemy.id === "enemy:starter-scout");
      const spawn = chunks
        .flatMap((chunk) => chunk.spawns)
        .find((entry) => entry.id === scout?.id);
      if (scout === undefined || spawn === undefined)
        throw new Error("missing released starter scout");
      expect(scout.position).not.toBe(spawn.position);
      expect(scout.spawnPosition).not.toBe(spawn.position);
      scout.position = { x: 99, y: -99 };
      scout.hp -= 1;
      scout.attackElapsed = 0.7;
      const existingEnemies = new Map([[scout.id, scout]]);
      const defeatedBossIds = new Set(["boss:ember-wyrm"]);
      // Evict the home recipes, not gameplay state, by asking for distant windows.
      for (const x of [160, -160, 320, -320])
        visibleChunksFor(identity, { x, y: x }, cache.get);
      expect(cache.diagnostics().evictions).toBeGreaterThan(0);
      const revisited = visibleChunksFor(identity, position, cache.get);
      expect(revisited).toEqual(chunks);
      expect(revisited[0]).not.toBe(chunks[0]);
      const missing = missingVisibleRuntimeEnemyDraftsFor({
        visibleChunks: revisited,
        existingEnemies,
        defeatedBossIds,
      });
      expect(missing.map((enemy) => enemy.id)).not.toContain(scout.id);
      expect(missing.map((enemy) => enemy.id)).not.toContain("boss:ember-wyrm");
      expect(existingEnemies.get(scout.id)).toBe(scout);
      expect(scout.position).toEqual({ x: 99, y: -99 });
      expect(scout.hp).toBe(scout.maxHp - 1);
      expect(scout.attackElapsed).toBe(0.7);
      expect(scout.spawnPosition).toEqual(spawn.position);
      expect(cache.diagnostics().size).toBeLessThanOrEqual(27);
    });
  }

  it("continues global pursuit far outside the player's 3x3 neighbourhood", () => {
    const drafts = missingVisibleRuntimeEnemyDraftsFor({
      visibleChunks: visibleChunksFor(world, { x: 0, y: 0 }),
      existingEnemies: new Map(),
      defeatedBossIds: new Set(),
    });
    const scout = drafts.find((enemy) => enemy.id === "enemy:starter-scout");
    if (scout === undefined) throw new Error("missing canonical scout");
    const playerPosition = { x: 160, y: -160 };
    const visibleIds = visibleChunksFor(world, playerPosition).flatMap(
      (chunk) => chunk.spawns.map((spawn) => spawn.id),
    );
    expect(visibleIds).not.toContain(scout.id);
    const result = advanceEnemyCombatPhase({
      delta: 0.1,
      elapsed: 10,
      player: { position: playerPosition, hp: 100, maxHp: 100 },
      resources: { wood: 0, stone: 0, scrap: 0, essence: 0, bossCore: 0 },
      enemies: new Map([[scout.id, scout]]),
      committedSavePoint: {
        id: "campfire:home",
        label: "home",
        position: { x: 0, y: 0 },
        level: 1,
      },
      input: { intent: { x: 0, y: 0 }, source: "system", at: 10 },
      destination: null,
      attackElapsed: 0,
      enemyAttackStandoff: 1.8,
      deathResourceLossRate: 0.25,
    });
    const pursued = result.enemies.get(scout.id);
    if (pursued === undefined) throw new Error("distant scout was pruned");
    expect(result.enemies.size).toBe(1);
    expect(distance(pursued.position, playerPosition)).toBeLessThan(
      distance(scout.position, playerPosition),
    );
    expect(distance(pursued.position, scout.position)).toBeCloseTo(
      scout.moveSpeed * 0.1,
      2,
    );
    expect(pursued.spawnPosition).toEqual(scout.spawnPosition);
    expect(pursued.hp).toBe(scout.hp);
    expect(pursued.defeated).toBe(false);
  });
  it("GameSession retains and advances off-neighbourhood enemies during public traversal", () => {
    const session = new GameSession();
    let checked = false;
    for (let step = 0; step < 160 && !checked; step += 1) {
      session.move({ intent: { x: 1, y: 0 }, source: "keyboard", at: step });
      session.tick(0.1);
      const before = session.diagnostics();
      const visible = visibleChunkCoordinates(before.player.position);
      const outside = before.enemies.find(
        (enemy) =>
          !enemy.defeated &&
          !visible.some(
            (chunk) =>
              chunk.x === Math.floor(enemy.position.x / 16) &&
              chunk.y === Math.floor(enemy.position.y / 16),
          ),
      );
      if (outside === undefined) continue;
      session.move({ intent: { x: 0, y: 0 }, source: "keyboard", at: step });
      session.tick(0.1);
      const after = session
        .diagnostics()
        .enemies.find((enemy) => enemy.id === outside.id);
      if (after === undefined)
        throw new Error("off-neighbourhood enemy was pruned");
      expect(distance(after.position, before.player.position)).toBeLessThan(
        distance(outside.position, before.player.position),
      );
      expect(after.spawnPosition).toEqual(outside.spawnPosition);
      checked = true;
    }
    expect(checked).toBe(true);
  });

  it("materializes the current generator's ordered 3x3 chunks for a non-home window", () => {
    const playerPosition = { x: 47.9, y: -17.2 };
    const expectedCoordinates = visibleChunkCoordinates(playerPosition);
    const expectedChunks = expectedCoordinates.map((coordinate) =>
      generateChunk(world, coordinate),
    );

    const visibleChunks = visibleChunksFor(world, playerPosition);

    expect(visibleChunks).toHaveLength(9);
    expect(visibleChunks.map((chunk) => chunk.coordinate)).toEqual(
      expectedCoordinates,
    );
    expect(visibleChunks.map((chunk) => chunk.key)).toEqual(
      expectedChunks.map((chunk) => chunk.key),
    );
    expect(visibleChunks).toEqual(expectedChunks);
  });

  it("returns missing runtime drafts with every current field while preserving existing IDs and suppressing only defeated bosses", () => {
    const visibleChunks = visibleChunksFor(world, { x: 0, y: 0 });
    const homeSpawns = visibleChunks.flatMap((chunk) => chunk.spawns);
    const existingSpawn = homeSpawns.find(
      (spawn) => spawn.id === "enemy:starter-elite",
    );
    const scoutSpawn = homeSpawns.find(
      (spawn) => spawn.id === "enemy:starter-scout",
    );
    const bossSpawn = homeSpawns.find(
      (spawn) => spawn.id === "boss:ember-wyrm",
    );
    if (
      existingSpawn === undefined ||
      scoutSpawn === undefined ||
      bossSpawn === undefined
    )
      throw new Error("home window should contain the released starter spawns");

    const existingEnemy: RuntimeEnemy = {
      id: existingSpawn.id,
      kind: existingSpawn.kind,
      position: { x: 99, y: -99 },
      spawnPosition: { x: 2.5, y: -3 },
      hp: 1,
      maxHp: 56,
      damage: 7,
      dangerTier: 0,
      dropMultiplier: 1,
      moveSpeed: 1.5,
      attackEverySeconds: 1.4,
      respawnAt: 42,
      defeated: false,
      attackElapsed: 0.7,
    };
    const existingEnemies = new Map([[existingEnemy.id, existingEnemy]]);
    const defeatedBossIds = new Set([bossSpawn.id, scoutSpawn.id]);

    const drafts = missingVisibleRuntimeEnemyDraftsFor({
      visibleChunks,
      existingEnemies,
      defeatedBossIds,
    });
    const scoutDraft = drafts.find((draft) => draft.id === scoutSpawn.id);

    expect(existingEnemies.get(existingEnemy.id)).toBe(existingEnemy);
    expect(drafts.map((draft) => draft.id)).not.toContain(existingEnemy.id);
    expect(drafts.map((draft) => draft.id)).not.toContain(bossSpawn.id);
    expect(scoutDraft).toEqual({
      id: scoutSpawn.id,
      kind: scoutSpawn.kind,
      position: { ...scoutSpawn.position },
      spawnPosition: { ...scoutSpawn.position },
      hp: Math.ceil(
        enemyDefinitions.scout.maxHp * scoutSpawn.danger.healthMultiplier,
      ),
      maxHp: Math.ceil(
        enemyDefinitions.scout.maxHp * scoutSpawn.danger.healthMultiplier,
      ),
      damage: Math.max(
        1,
        Math.ceil(
          enemyDefinitions.scout.damage * scoutSpawn.danger.damageMultiplier,
        ),
      ),
      dangerTier: scoutSpawn.danger.tier,
      dropMultiplier: scoutSpawn.danger.dropMultiplier,
      moveSpeed: enemyDefinitions.scout.moveSpeed,
      attackEverySeconds: enemyDefinitions.scout.attackEverySeconds,
      respawnAt: null,
      defeated: false,
      attackElapsed: 0,
    });
    expect(Object.keys(scoutDraft ?? {}).sort()).toEqual([
      "attackElapsed",
      "attackEverySeconds",
      "damage",
      "dangerTier",
      "defeated",
      "dropMultiplier",
      "hp",
      "id",
      "kind",
      "maxHp",
      "moveSpeed",
      "position",
      "respawnAt",
      "spawnPosition",
    ]);
  });

  it("keeps visible IDs unique and a moved runtime enemy intact across repeated presentation and tick setup", () => {
    const session = new GameSession();
    const beforeMove = session
      .presentation()
      .renderer.enemies.find((enemy) => enemy.id === "enemy:starter-scout");
    if (beforeMove === undefined)
      throw new Error("starter scout should be active in the home window");

    session.move({ intent: { x: -1, y: 0 }, source: "keyboard", at: 1 });
    session.tick(0.1);
    const moved = session
      .presentation()
      .renderer.enemies.find((enemy) => enemy.id === beforeMove.id);
    if (moved === undefined)
      throw new Error("moved starter scout should remain visible");
    expect(moved.position).not.toEqual(beforeMove.position);

    session.presentation();
    session.presentation();
    session.tick(0);
    const afterRepeatedSetup = session.presentation().renderer;
    const retainedScout = afterRepeatedSetup.enemies.find(
      (enemy) => enemy.id === beforeMove.id,
    );
    if (retainedScout === undefined)
      throw new Error("moved starter scout should remain active after setup");

    expect(retainedScout.position).toEqual(moved.position);
    expect(afterRepeatedSetup.enemies.map((enemy) => enemy.id)).toHaveLength(
      new Set(afterRepeatedSetup.enemies.map((enemy) => enemy.id)).size,
    );
  });
});
