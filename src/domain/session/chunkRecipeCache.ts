import { deepFreeze } from "../../data/deepFreeze";
import type { ChunkRecipe, Vector2, WorldIdentity } from "../types";
import { generateChunk } from "../world";

/** Three 3x3 neighbourhoods; bounded independently of retained enemy state. */
export const CHUNK_RECIPE_CACHE_CAPACITY = 27;
export type ChunkRecipeSource = (
  world: WorldIdentity,
  coordinate: Vector2,
) => ChunkRecipe;

export interface ChunkRecipeCacheDiagnostics {
  readonly capacity: number;
  readonly hits: number;
  readonly misses: number;
  readonly size: number;
  readonly evictions: number;
}

/** Disposable recipes only. Map insertion order is deterministic LRU order. */
export class ChunkRecipeCache {
  private readonly recipes = new Map<string, ChunkRecipe>();
  private identity: string | null = null;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(
    private readonly capacity = CHUNK_RECIPE_CACHE_CAPACITY,
    private readonly generate: ChunkRecipeSource = generateChunk,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new Error("Chunk recipe cache capacity must be a positive integer");
  }

  readonly get: ChunkRecipeSource = (world, coordinate) => {
    const identity = JSON.stringify([world.seed, world.generatorVersion]);
    if (identity !== this.identity) {
      this.clear();
      this.identity = identity;
    }
    const key = JSON.stringify([
      world.seed,
      world.generatorVersion,
      coordinate.x,
      coordinate.y,
    ]);
    const existing = this.recipes.get(key);
    if (existing !== undefined) {
      this.hits += 1;
      this.recipes.delete(key);
      this.recipes.set(key, existing);
      return existing;
    }
    // A miss counts an attempted generation, including an unsupported version.
    this.misses += 1;
    const recipe = deepFreeze(this.generate({ ...world }, { ...coordinate }));
    if (this.recipes.size === this.capacity) {
      const oldest = this.recipes.keys().next().value;
      if (oldest !== undefined) this.recipes.delete(oldest);
      this.evictions += 1;
    }
    this.recipes.set(key, recipe);
    return recipe;
  };

  clear(): void {
    this.recipes.clear();
    this.identity = null;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  diagnostics(): ChunkRecipeCacheDiagnostics {
    return Object.freeze({
      capacity: this.capacity,
      hits: this.hits,
      misses: this.misses,
      size: this.recipes.size,
      evictions: this.evictions,
    });
  }
}
