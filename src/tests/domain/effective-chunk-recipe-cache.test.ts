import { describe, expect, it, vi } from "vitest";
import { EffectiveChunkRecipeCache } from "../../domain/session/effectiveChunkRecipeCache";
import { CHUNK_RECIPE_CACHE_CAPACITY } from "../../domain/session/chunkRecipeCache";
import type { ChunkRecipe, Vector2, WorldIdentity } from "../../domain/types";

const world: WorldIdentity = {
  seed: "effective-recipe-cache",
  generatorVersion: "v1",
};

const recipeFor = (coordinate: Vector2, obstacleId: string): ChunkRecipe => ({
  coordinate: { ...coordinate },
  key: String(coordinate.x) + ":" + String(coordinate.y),
  domainSeeds: { terrain: 1 },
  obstacles: [
    {
      id: obstacleId,
      position: { x: coordinate.x, y: coordinate.y },
      kind: "tree",
    },
  ],
  campfires: [],
  spawns: [],
});

const expectDeepFrozen = (value: unknown): void => {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const member of Object.values(value)) expectDeepFrozen(member);
};

describe("effective chunk recipe cache", () => {
  it("freezes copied depletion projections without mutating source or harvested IDs", () => {
    const coordinate = { x: -2, y: 3 };
    const sourceRecipe = recipeFor(coordinate, "tree:depleted");
    const source = vi.fn(() => sourceRecipe);
    const cache = new EffectiveChunkRecipeCache(source);
    const harvestedIds = new Set(["tree:depleted"]);
    const result = cache.get(world, coordinate, harvestedIds);

    expect(result.obstacles).toEqual([]);
    expectDeepFrozen(result);
    expect(sourceRecipe.obstacles).toEqual([
      {
        id: "tree:depleted",
        position: { x: -2, y: 3 },
        kind: "tree",
      },
    ]);
    expect([...harvestedIds]).toEqual(["tree:depleted"]);
    expect(cache.get(world, coordinate, harvestedIds)).toBe(result);
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("keys independently by seed, generator version, and both coordinates", () => {
    const coordinate = { x: 0, y: 0 };
    const sourceRecipe = recipeFor(coordinate, "tree:shared");
    const source = vi.fn(() => sourceRecipe);
    const cache = new EffectiveChunkRecipeCache(source);
    const harvestedIds = new Set<string>();
    const requests = [
      [world, coordinate],
      [{ ...world, seed: "other-seed" }, coordinate],
      [{ ...world, generatorVersion: "other-version" }, coordinate],
      [world, { x: 1, y: 0 }],
      [world, { x: 0, y: 1 }],
    ] as const;
    const results = requests.map(([identity, position]) =>
      cache.get(identity, position, harvestedIds),
    );

    expect(new Set(results).size).toBe(requests.length);
    requests.forEach(([identity, position], index) => {
      expect(cache.get(identity, position, harvestedIds)).toBe(results[index]);
    });
  });

  it("recomputes when the raw recipe source identity changes", () => {
    const coordinate = { x: 4, y: -1 };
    let sourceRecipe = recipeFor(coordinate, "tree:old");
    const cache = new EffectiveChunkRecipeCache(() => sourceRecipe);
    const harvestedIds = new Set<string>();
    const previous = cache.get(world, coordinate, harvestedIds);

    sourceRecipe = recipeFor(coordinate, "tree:new");
    const replacement = cache.get(world, coordinate, harvestedIds);

    expect(replacement).not.toBe(previous);
    expect(replacement.obstacles[0]?.id).toBe("tree:new");
  });

  it("refreshes LRU recency and evicts the least-recently-used recipe at capacity", () => {
    const recipes = new Map<string, ChunkRecipe>();
    const source = vi.fn((identity: WorldIdentity, coordinate: Vector2) => {
      const key = JSON.stringify([
        identity.seed,
        identity.generatorVersion,
        coordinate.x,
        coordinate.y,
      ]);
      let recipe = recipes.get(key);
      if (recipe === undefined) {
        recipe = recipeFor(coordinate, "tree:" + String(coordinate.x));
        recipes.set(key, recipe);
      }
      return recipe;
    });
    const cache = new EffectiveChunkRecipeCache(source);
    const coordinates = Array.from(
      { length: CHUNK_RECIPE_CACHE_CAPACITY },
      (_, x) => ({
        x,
        y: -x,
      }),
    );
    const empty = new Set<string>();
    const initial = coordinates.map((coordinate) =>
      cache.get(world, coordinate, empty),
    );

    expect(cache.get(world, coordinates[0]!, empty)).toBe(initial[0]);
    cache.get(world, { x: 99, y: -99 }, empty);

    const evicted = cache.get(world, coordinates[1]!, new Set(["tree:1"]));
    const retained = cache.get(world, coordinates[0]!, new Set(["tree:0"]));
    expect(evicted.obstacles).toEqual([]);
    expect(retained).toBe(initial[0]);
    expect(retained.obstacles).toHaveLength(1);
  });

  it("bypasses effective caching when the raw recipe has a live obstacles getter", () => {
    let obstacleId = "tree:first";
    const coordinate = { x: 0, y: 0 };
    const liveRecipe: ChunkRecipe = {
      coordinate,
      key: "live",
      domainSeeds: { terrain: 1 },
      get obstacles() {
        return [
          {
            id: obstacleId,
            position: { x: 0, y: 0 },
            kind: "tree" as const,
          },
        ];
      },
      campfires: [],
      spawns: [],
    };
    const cache = new EffectiveChunkRecipeCache(() => liveRecipe);
    const harvestedIds = new Set<string>();
    const first = cache.get(world, coordinate, harvestedIds);

    obstacleId = "tree:second";
    const second = cache.get(world, coordinate, harvestedIds);

    expect(first).not.toBe(second);
    expect(first.obstacles[0]?.id).toBe("tree:first");
    expect(second.obstacles[0]?.id).toBe("tree:second");
  });

  it("clears cached projections so a harvest invalidation recomputes depletion", () => {
    const coordinate = { x: 1, y: 2 };
    const sourceRecipe = recipeFor(coordinate, "tree:harvested");
    const cache = new EffectiveChunkRecipeCache(() => sourceRecipe);
    const depleted = cache.get(world, coordinate, new Set(["tree:harvested"]));

    cache.clear();
    const restored = cache.get(world, coordinate, new Set<string>());

    expect(restored).not.toBe(depleted);
    expect(restored.obstacles[0]).toMatchObject({
      id: "tree:harvested",
      harvestable: true,
    });
  });
});
