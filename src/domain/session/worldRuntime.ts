import { enemyDefinitions } from "../../data/definitions";
import type { ChunkRecipe, Vector2, WorldIdentity } from "../types";
import { generateChunk, visibleChunkCoordinates } from "../world";
import { copyVector } from "./sessionState";
import type { ChunkRecipeSource } from "./chunkRecipeCache";
import type { RuntimeEnemy } from "./sessionState";
import { maxEnemyHpFor, type EnemyHealthContext } from "./enemyHealthScaling";

const legacyEnemyHealthContext = Object.freeze({
  level: 0,
  normalPrimaryDamage: 0,
} satisfies EnemyHealthContext);

/**
 * Internal, stateless visible-world coordination. These helpers are not part
 * of the GameSession public facade; GameSession retains runtime ownership.
 */
export const visibleChunksFor = (
  world: WorldIdentity,
  playerPosition: Vector2,
  recipeSource: ChunkRecipeSource = generateChunk,
): readonly ChunkRecipe[] =>
  visibleChunkCoordinates(playerPosition).map((coordinate) =>
    recipeSource(world, coordinate),
  );

export interface MissingVisibleRuntimeEnemyDraftsInput {
  readonly visibleChunks: readonly ChunkRecipe[];
  readonly existingEnemies: ReadonlyMap<string, RuntimeEnemy>;
  readonly defeatedBossIds: ReadonlySet<string>;
  /** Omitted only by legacy direct consumers that retain authored-only HP. */
  readonly enemyHealthContext?: EnemyHealthContext;
}

/**
 * Produces only fresh enemy drafts. Callers retain the runtime map and choose
 * when to insert these values, so this module owns no cache or lifecycle state.
 */
export const missingVisibleRuntimeEnemyDraftsFor = ({
  visibleChunks,
  existingEnemies,
  defeatedBossIds,
  enemyHealthContext = legacyEnemyHealthContext,
}: MissingVisibleRuntimeEnemyDraftsInput): readonly RuntimeEnemy[] => {
  const materializedIds = new Set(existingEnemies.keys());

  return visibleChunks.flatMap((chunk) =>
    chunk.spawns.flatMap((spawn) => {
      if (spawn.kind === "boss" && defeatedBossIds.has(spawn.id)) return [];
      if (materializedIds.has(spawn.id)) return [];

      materializedIds.add(spawn.id);
      const definition = enemyDefinitions[spawn.kind];
      const spawnHealthMultiplier = spawn.danger.healthMultiplier;
      const maxHp = maxEnemyHpFor({
        authoredMaxHp: definition.maxHp,
        spawnHealthMultiplier,
        context: enemyHealthContext,
      });
      return [
        {
          id: spawn.id,
          kind: spawn.kind,
          position: copyVector(spawn.position),
          spawnPosition: copyVector(spawn.position),
          hp: maxHp,
          maxHp,
          damage: Math.max(
            1,
            Math.ceil(definition.damage * spawn.danger.damageMultiplier),
          ),
          dangerTier: spawn.danger.tier,
          spawnHealthMultiplier,
          dropMultiplier: spawn.danger.dropMultiplier,
          moveSpeed: definition.moveSpeed,
          attackEverySeconds: definition.attackEverySeconds,
          respawnAt: null,
          defeated: false,
          attackElapsed: 0,
          attackEventOrdinal: 0,
        },
      ];
    }),
  );
};
