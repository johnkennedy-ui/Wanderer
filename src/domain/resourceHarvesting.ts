import type { ChunkObstacle, ChunkRecipe, HarvestRewards } from "./types";

/** A new save may record no more unique depleted nodes than this bound. */
export const MAX_HARVESTED_NODE_IDS = 4096;
/** A node ID must fit the same command bound enforced by GameSession. */
export const MAX_HARVESTED_NODE_ID_LENGTH = 1024;
/** Maximum UTF-16 code units summed across ID strings, excluding JSON overhead. */
export const MAX_HARVESTED_NODE_ID_CHARS = 1_048_576;
export const HARVEST_INTERACTION_DISTANCE = 2;

/** Checks the serialized ID budget before a session publishes another harvest. */
export const hasHarvestedNodeIdCharacterCapacity = (
  harvestedNodeIds: ReadonlySet<string>,
  nextNodeId: string,
): boolean => {
  let totalCharacters = nextNodeId.length;
  if (totalCharacters > MAX_HARVESTED_NODE_ID_CHARS) return false;
  for (const id of harvestedNodeIds) {
    totalCharacters += id.length;
    if (totalCharacters > MAX_HARVESTED_NODE_ID_CHARS) return false;
  }
  return true;
};

/** Values are initial tuning, not an economy balance proof. */
export const harvestRewardsForObstacle = (
  obstacle: ChunkObstacle,
): HarvestRewards | null => {
  if (obstacle.kind === "tree") return Object.freeze({ wood: 24 });
  const isRock =
    obstacle.kind === "rock" ||
    (obstacle.kind === undefined && obstacle.id.startsWith("rock:"));
  return isRock ? Object.freeze({ stone: 20, iron: 12 }) : null;
};

/** Applies a derived eligibility marker/depletion delta; generator recipes stay immutable. */
export const effectiveChunkRecipeFor = (
  recipe: ChunkRecipe,
  harvestedNodeIds: ReadonlySet<string>,
): ChunkRecipe => ({
  ...recipe,
  obstacles: recipe.obstacles.flatMap((obstacle) => {
    if (harvestedNodeIds.has(obstacle.id)) return [];
    return harvestRewardsForObstacle(obstacle) === null
      ? [obstacle]
      : [{ ...obstacle, harvestable: true }];
  }),
});
