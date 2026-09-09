import type { ChunkRecipe, Vector2, WorldIdentity } from "../../types";
import type { ChunkGenerator } from "../generatorTypes";
import { chunkKey } from "../shared";
import { generateWandererWebV1Chunk } from "./wandererWebV1";

const ENCOUNTER_MACROCELL_WIDTH = 5;
const ENCOUNTER_MACROCELL_HEIGHT = 2;

const hashText = (text: string): number => {
  let hash = 2_166_136_261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

const encounterMacrocellCoordinateFor = (coordinate: Vector2): Vector2 => ({
  x: Math.floor(coordinate.x / ENCOUNTER_MACROCELL_WIDTH),
  y: Math.floor(coordinate.y / ENCOUNTER_MACROCELL_HEIGHT),
});

const hasNormalEncounterSpawns = (
  world: WorldIdentity,
  coordinate: Vector2,
): boolean => {
  const macrocell = encounterMacrocellCoordinateFor(coordinate);
  const selectedSlot =
    hashText(
      `${world.seed}|${world.generatorVersion}|${chunkKey(macrocell)}|encounter-macrocell`,
    ) %
    (ENCOUNTER_MACROCELL_WIDTH * ENCOUNTER_MACROCELL_HEIGHT);
  const localX = coordinate.x - macrocell.x * ENCOUNTER_MACROCELL_WIDTH;
  const localY = coordinate.y - macrocell.y * ENCOUNTER_MACROCELL_HEIGHT;

  return localY * ENCOUNTER_MACROCELL_WIDTH + localX === selectedSlot;
};

/**
 * Released V2 recipe. It retains V1's deterministic recipe construction for
 * a V2 world identity, while reducing non-home normal enemy groups to one
 * three-enemy encounter in each deterministic five-by-two macrocell.
 */
export const generateWandererWebV2Chunk: ChunkGenerator = (
  world,
  coordinate,
): ChunkRecipe => {
  const recipe = generateWandererWebV1Chunk(world, coordinate);
  const isHomeChunk = coordinate.x === 0 && coordinate.y === 0;

  if (isHomeChunk || hasNormalEncounterSpawns(world, coordinate)) return recipe;

  return { ...recipe, spawns: [] };
};
