import { deepFreeze } from "../../data/deepFreeze";
import { effectiveChunkRecipeFor } from "../resourceHarvesting";
import type { ChunkRecipe, Vector2, WorldIdentity } from "../types";
import {
  CHUNK_RECIPE_CACHE_CAPACITY,
  type ChunkRecipeSource,
} from "./chunkRecipeCache";

/** Disposable effective projections owned by one session. */
export class EffectiveChunkRecipeCache {
  private readonly recipes = new Map<
    string,
    { readonly source: ChunkRecipe; readonly result: ChunkRecipe }
  >();

  constructor(private readonly source: ChunkRecipeSource) {}

  readonly get = (
    world: WorldIdentity,
    coordinate: Vector2,
    harvestedNodeIds: ReadonlySet<string>,
  ): ChunkRecipe => {
    const source = this.source(world, coordinate);
    // Preserve a custom live getter's fresh obstacle snapshot rather than caching it.
    if (Object.getOwnPropertyDescriptor(source, "obstacles")?.get !== undefined)
      return deepFreeze(effectiveChunkRecipeFor(source, harvestedNodeIds));

    const key = JSON.stringify([
      world.seed,
      world.generatorVersion,
      coordinate.x,
      coordinate.y,
    ]);
    const cached = this.recipes.get(key);
    if (cached?.source === source) {
      this.recipes.delete(key);
      this.recipes.set(key, cached);
      return cached.result;
    }

    const result = deepFreeze(
      effectiveChunkRecipeFor(source, harvestedNodeIds),
    );
    if (this.recipes.size === CHUNK_RECIPE_CACHE_CAPACITY) {
      const oldest = this.recipes.keys().next().value;
      if (oldest !== undefined) this.recipes.delete(oldest);
    }
    this.recipes.set(key, { source, result });
    return result;
  };

  clear(): void {
    this.recipes.clear();
  }
}
