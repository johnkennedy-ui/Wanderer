import type { ChunkRecipe, Vector2, WorldIdentity } from "./types";
import {
  UnsupportedWorldGeneratorVersionError,
  WANDERER_WEB_V1,
  WANDERER_WEB_V2,
} from "./world/generatorTypes";
import { generateWandererWebV1Chunk } from "./world/generators/wandererWebV1";
import { generateWandererWebV2Chunk } from "./world/generators/wandererWebV2";

export {
  UnsupportedWorldGeneratorVersionError,
  WANDERER_WEB_V1,
  WANDERER_WEB_V2,
} from "./world/generatorTypes";
export type {
  ChunkGenerator,
  ReleasedWorldGeneratorVersion,
} from "./world/generatorTypes";
export {
  deriveDomainSeed,
  dangerForChunkCoordinate,
} from "./world/generators/wandererWebV1";
export {
  CHUNK_SIZE,
  chunkCoordinateFor,
  chunkKey,
  visibleChunkCoordinates,
} from "./world/shared";

/** New worlds use the newest explicitly supported released generator. */
export const DEFAULT_WORLD_GENERATOR_VERSION = WANDERER_WEB_V2;

const chunkGenerators = Object.freeze({
  [WANDERER_WEB_V1]: generateWandererWebV1Chunk,
  [WANDERER_WEB_V2]: generateWandererWebV2Chunk,
});

type KnownWorldGeneratorVersion = keyof typeof chunkGenerators;

/** Append-only public record of generator identities this build can replay. */
export const supportedWorldGeneratorVersions = Object.freeze([
  WANDERER_WEB_V1,
  WANDERER_WEB_V2,
] as const);

export const isSupportedWorldGeneratorVersion = (version: string): boolean =>
  Object.prototype.hasOwnProperty.call(chunkGenerators, version);

/**
 * Explicitly dispatches a saved identity to its released implementation. There
 * is intentionally no latest-generator fallback for an unknown saved version.
 */
export const generateChunk = (
  world: WorldIdentity,
  coordinate: Vector2,
): ChunkRecipe => {
  if (!isSupportedWorldGeneratorVersion(world.generatorVersion))
    throw new UnsupportedWorldGeneratorVersionError(world.generatorVersion);
  const generator =
    chunkGenerators[world.generatorVersion as KnownWorldGeneratorVersion];
  return generator(world, coordinate);
};
