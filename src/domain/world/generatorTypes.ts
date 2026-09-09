import type { ChunkRecipe, Vector2, WorldIdentity } from "../types";

/** Released generator identifiers are append-only compatibility contracts. */
export const WANDERER_WEB_V1 = "wanderer-web-v1" as const;
export const WANDERER_WEB_V2 = "wanderer-web-v2" as const;

export type ReleasedWorldGeneratorVersion =
  typeof WANDERER_WEB_V1 | typeof WANDERER_WEB_V2;

export type ChunkGenerator = (
  world: WorldIdentity,
  coordinate: Vector2,
) => ChunkRecipe;

/** Raised instead of silently running a different recipe for a saved world. */
export class UnsupportedWorldGeneratorVersionError extends Error {
  readonly code = "unsupported-world-generator-version" as const;

  constructor(readonly generatorVersion: string) {
    super(`Unsupported world generator version: ${generatorVersion}`);
    this.name = "UnsupportedWorldGeneratorVersionError";
  }
}
