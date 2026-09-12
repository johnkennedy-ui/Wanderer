import { describe, expect, it, vi } from "vitest";
import { gameplayTuning } from "../../data/definitions";
import { emptyResources } from "../../domain/types";
import {
  ChunkRecipeCache,
  CHUNK_RECIPE_CACHE_CAPACITY,
} from "../../domain/session/chunkRecipeCache";
import type { Vector2, WorldIdentity } from "../../domain/types";
import { GameSession } from "../../domain/GameSession";
import {
  generateChunk,
  WANDERER_WEB_V1,
  WANDERER_WEB_V2,
  UnsupportedWorldGeneratorVersionError,
} from "../../domain/world";
import { SettlementRuntime } from "../../domain/session/settlementRuntime";
import { visibleChunksFor } from "../../domain/session/worldRuntime";

const world = Object.freeze({
  seed: "wanderer-known-seed",
  generatorVersion: WANDERER_WEB_V1,
});

const expectDeepFrozen = (value: unknown): void => {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const member of Object.values(value)) expectDeepFrozen(member);
};

describe("bounded instance-owned chunk recipes", () => {
  it("reuses deeply immutable recipes without changing released output", () => {
    const generate = vi.fn(generateChunk);
    const cache = new ChunkRecipeCache(27, generate);
    const coordinate = { x: -2, y: 3 };
    const recipe = cache.get(world, coordinate);
    expect(recipe).toEqual(generateChunk(world, coordinate));
    expect(cache.get({ ...world }, { ...coordinate })).toBe(recipe);
    expect(generate).toHaveBeenCalledTimes(1);
    expectDeepFrozen(recipe);
    expect(Reflect.set(recipe.coordinate, "x", 999)).toBe(false);
    expect(Reflect.set(recipe.obstacles, "length", 0)).toBe(false);
    expect(Reflect.set(recipe.domainSeeds, "terrain", 0)).toBe(false);
    expect(cache.diagnostics()).toEqual({
      capacity: 27,
      hits: 1,
      misses: 1,
      size: 1,
      evictions: 0,
    });
    expect(Object.isFrozen(cache.diagnostics())).toBe(true);
    // The cache copies identity/coordinate inputs before generation/freezing.
    expect(Object.isFrozen(coordinate)).toBe(false);
    coordinate.x = 99;
    expect(recipe.coordinate.x).toBe(-2);
  });

  it("uses deterministic LRU, separates both axes and regenerates only evicted recipes", () => {
    const generate = vi.fn(generateChunk);
    const cache = new ChunkRecipeCache(2, generate);
    const a = { x: 1, y: 2 },
      b = { x: 2, y: 1 },
      c = { x: -1, y: 2 };
    const first = cache.get(world, a);
    cache.get(world, b);
    expect(cache.get(world, a)).toBe(first);
    cache.get(world, c);
    expect(cache.get(world, a)).toBe(first);
    cache.get(world, b);
    expect(generate.mock.calls.map(([, coordinate]) => coordinate)).toEqual([
      a,
      b,
      c,
      b,
    ]);
    expect(cache.diagnostics()).toEqual({
      capacity: 2,
      hits: 2,
      misses: 4,
      size: 2,
      evictions: 2,
    });
  });

  it("clears identity/counters on seed, version, and explicit reset; rejects unknown versions", () => {
    const cache = new ChunkRecipeCache();
    const position = { x: 0, y: 0 };
    const first = cache.get(world, position);
    const other = cache.get({ ...world, seed: "other" }, position);
    expect(other).not.toEqual(first);
    expect(cache.diagnostics().misses).toBe(1);
    expect(() =>
      cache.get({ ...world, generatorVersion: "unsupported" }, position),
    ).toThrow(UnsupportedWorldGeneratorVersionError);
    expect(cache.diagnostics()).toMatchObject({ misses: 1, size: 0, hits: 0 });
    expect(cache.get(world, position)).toEqual(first);
    cache.clear();
    expect(cache.diagnostics()).toMatchObject({
      hits: 0,
      misses: 0,
      size: 0,
      evictions: 0,
    });
    expect(cache.get(world, position)).not.toBe(first);
  });

  it("includes generator version even when two injected versions are supported", () => {
    const generate = vi.fn((_identity: WorldIdentity, coordinate: Vector2) =>
      generateChunk(world, coordinate),
    );
    const cache = new ChunkRecipeCache(2, generate);
    cache.get({ seed: "same", generatorVersion: "a" }, { x: 0, y: 0 });
    cache.get({ seed: "same", generatorVersion: "b" }, { x: 0, y: 0 });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(cache.diagnostics().size).toBe(1);
  });

  it("dispatches both actual released versions and isolates a same-seed version replacement", () => {
    const generate = vi.fn(generateChunk);
    const cache = new ChunkRecipeCache(27, generate);
    const position = { x: 2, y: -1 };
    const v1 = cache.get(world, position);
    const v2World = { ...world, generatorVersion: WANDERER_WEB_V2 };
    const v2 = cache.get(v2World, position);
    expect(v2).toEqual(generateChunk(v2World, position));
    expect(v2).not.toBe(v1);
    expectDeepFrozen(v2);
    expect(cache.get(v2World, position)).toBe(v2);
    expect(cache.diagnostics()).toEqual({
      capacity: 27,
      hits: 1,
      misses: 1,
      size: 1,
      evictions: 0,
    });
    const regeneratedV1 = cache.get(world, position);
    expect(regeneratedV1).toEqual(generateChunk(world, position));
    expect(regeneratedV1).toEqual(v1);
    expect(regeneratedV1).not.toBe(v1);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(
      generate.mock.calls.map(([identity]) => identity.generatorVersion),
    ).toEqual([WANDERER_WEB_V1, WANDERER_WEB_V2, WANDERER_WEB_V1]);
  });

  it("isolates instances and bounds long positive/negative traversal", () => {
    const first = new ChunkRecipeCache();
    const second = new ChunkRecipeCache();
    for (let x = -80; x <= 80; x += 1) {
      visibleChunksFor(world, { x: x * 16, y: -x * 16 }, first.get);
      expect(first.diagnostics().size).toBeLessThanOrEqual(
        CHUNK_RECIPE_CACHE_CAPACITY,
      );
    }
    expect(first.diagnostics().size).toBe(27);
    expect(first.diagnostics().evictions).toBeGreaterThan(0);
    expect(second.diagnostics().size).toBe(0);
    first.clear();
    expect(second.get(world, { x: 0, y: 0 })).toEqual(
      generateChunk(world, { x: 0, y: 0 }),
    );
    expect(first.diagnostics().size).toBe(0);
    for (const capacity of [
      0,
      -1,
      1.5,
      Infinity,
      NaN,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(() => new ChunkRecipeCache(capacity)).toThrow();
  });

  it("shares visible, settlement campfire and terrain generation through one narrow source", () => {
    const generate = vi.fn(generateChunk);
    const cache = new ChunkRecipeCache(27, generate);
    const settlement = new SettlementRuntime(
      { buildings: [], nextBuildingSerial: 1, farmHarvestElapsed: 0 },
      cache.get,
    );
    const uncached = new SettlementRuntime({
      buildings: [],
      nextBuildingSerial: 1,
      farmHarvestElapsed: 0,
    });
    const position = { x: 0, y: 0 };
    visibleChunksFor(world, position, cache.get);
    for (let frame = 0; frame < 20; frame += 1) {
      visibleChunksFor(world, position, cache.get);
      expect(settlement.nearbyCampfireAt(world, position)).toEqual(
        uncached.nearbyCampfireAt(world, position),
      );
      expect(settlement.buildRadiusAt(world, position)).toBe(
        uncached.buildRadiusAt(world, position),
      );
      expect(settlement.inputsFor(world, position)).toEqual(
        uncached.inputsFor(world, position),
      );
    }
    expect(generate).toHaveBeenCalledTimes(9);
    expect(cache.diagnostics().misses).toBe(9);
    expect(cache.diagnostics().hits).toBe(20 * (9 + 9 + 9 + 10));
  });

  it("keeps injected settlement Healing Hut boundaries, stacking and HP cap independent of campfire queries", () => {
    const cache = new ChunkRecipeCache();
    for (const level of [1, 2, 3] as const) {
      const settlement = new SettlementRuntime(
        {
          buildings: [
            {
              id: "building:fixture:1",
              kind: "Healer",
              level,
              position: { x: 0, y: 0 },
            },
          ],
          nextBuildingSerial: 2,
          farmHarvestElapsed: 0,
        },
        cache.get,
      );
      const radius = gameplayTuning.healingHutRadiusByLevel[level - 1];
      const bonus = gameplayTuning.healerHealingBonusByLevel[level - 1];
      for (const x of [0, radius, radius + 0.01]) {
        const position = { x, y: 0 };
        settlement.inputsFor(world, position);
        expect(
          settlement.passive(1, 50, 100, emptyResources(), position, false).hp,
        ).toBe(50 + (x <= radius ? bonus : 0));
      }
    }
    const stacked = new SettlementRuntime(
      {
        buildings: [
          {
            id: "building:fixture:1",
            kind: "Healer",
            level: 1,
            position: { x: -1, y: 0 },
          },
          {
            id: "building:fixture:2",
            kind: "Healer",
            level: 2,
            position: { x: 1, y: 0 },
          },
        ],
        nextBuildingSerial: 3,
        farmHarvestElapsed: 0,
      },
      cache.get,
    );
    const position = { x: 0, y: 0 };
    const bonus =
      gameplayTuning.healerHealingBonusByLevel[0] +
      gameplayTuning.healerHealingBonusByLevel[1];
    expect(
      stacked.passive(1, 50, 100, emptyResources(), position, false).hp,
    ).toBe(50 + bonus);
    const nearCampfire = stacked.nearbyCampfireAt(world, position) !== null;
    expect(nearCampfire).toBe(true);
    expect(
      stacked.passive(1, 50, 100, emptyResources(), position, nearCampfire).hp,
    ).toBe(50 + bonus + gameplayTuning.baseCampfireHealingPerSecond);
    expect(
      stacked.passive(1, 99, 100, emptyResources(), position, nearCampfire).hp,
    ).toBe(100);
  });

  for (const generatorVersion of [WANDERER_WEB_V1, WANDERER_WEB_V2]) {
    it(`stationary ticks/presentations/save queries stop generation after warmup (${generatorVersion})`, () => {
      const session = new GameSession({
        world: { ...world, generatorVersion },
      });
      session.presentation();
      const before = session.diagnostics();
      for (let frame = 0; frame < 30; frame += 1) {
        session.tick(0.1);
        session.presentation();
        expect(session.createValidCampfireSaveRequest(frame)).not.toBeNull();
      }
      const after = session.diagnostics();
      expect(after.chunkCache.misses).toBe(before.chunkCache.misses);
      expect(after.chunkCache.hits).toBeGreaterThan(before.chunkCache.hits);
      expect(after.counts.cachedChunks).toBe(9);
      const document = session.createValidCampfireSaveRequest(100)?.document;
      expect(document).toBeDefined();
      expect(document).not.toHaveProperty("chunkCache");
      expect(document).not.toHaveProperty("chunkRecipes");
      session.resetWorld(world.seed);
      // Released reset selects the current v2 default, even from a v1 session.
      expect(session.diagnostics().world.generatorVersion).toBe(
        WANDERER_WEB_V2,
      );
      expect(session.diagnostics().chunkCache).toMatchObject({
        misses: 9,
        hits: 0,
        size: 9,
        evictions: 0,
      });
      session.resetWorld("new-identity");
      expect(session.diagnostics().world.seed).toBe("new-identity");
      expect(session.diagnostics().chunkCache).toMatchObject({
        misses: 9,
        hits: 0,
        size: 9,
        evictions: 0,
      });
      expect(before.chunkCache.hits).toBe(27);
    });

    it(`hydrates fresh isolated recipes without changing the durable projection (${generatorVersion})`, () => {
      const original = new GameSession({
        world: { ...world, generatorVersion },
      });
      const originalRecipe = original.presentation().renderer.visibleChunks[0];
      const request = original.createValidCampfireSaveRequest(123);
      if (request === null) throw new Error("expected valid home save");
      const before = original.diagnostics();
      const hydrated = new GameSession({ saved: request.document });
      expect(hydrated.diagnostics().chunkCache).toEqual({
        capacity: 27,
        hits: 0,
        misses: 9,
        size: 9,
        evictions: 0,
      });
      expect(hydrated.diagnostics().world.generatorVersion).toBe(
        generatorVersion,
      );
      const hydratedRecipe = hydrated.presentation().renderer.visibleChunks[0];
      expect(hydratedRecipe).toEqual(originalRecipe);
      expect(hydratedRecipe).not.toBe(originalRecipe);
      expect(hydrated.createValidCampfireSaveRequest(123)?.document).toEqual(
        request.document,
      );
      hydrated.resetWorld("isolated");
      expect(original.diagnostics()).toEqual(before);
      expect(original.presentation().renderer.visibleChunks[0]).toBe(
        originalRecipe,
      );
    });
  }
});
