import { gameplayTuning } from "../../data/definitions";
import type { GameNotice } from "../notices";
import type { BuildingState, Vector2, WorldIdentity } from "../types";
import {
  enemyTerrainClearanceFor,
  nearestTerrainSafePosition,
  terrainBlocksPosition,
} from "../world/terrainCollision";
import {
  copyVector,
  createFreshSessionState,
  DEFAULT_WORLD,
  type RuntimeEnemy,
  type SessionState,
} from "./sessionState";
import type { ChunkRecipeSource } from "./chunkRecipeCache";
import type { EnemyHealthContext } from "./enemyHealthScaling";
import { nearestWallSafePosition } from "./buildingGeometry";
import {
  missingVisibleRuntimeEnemyDraftsFor,
  visibleChunksFor,
} from "./worldRuntime";
import { waveEnemyDraftsFor, wavePhaseFor } from "./wavePolicy";

/**
 * Produces safe visible-world enemy insertions. The session owns the map and
 * decides exactly when these results become live runtime state.
 */
export const visibleEnemyInsertionsFor = ({
  world,
  playerPosition,
  chunkRecipeSource,
  enemies,
  defeatedBossIds,
  enemyHealthContext,
  buildings,
}: {
  readonly world: WorldIdentity;
  readonly playerPosition: Vector2;
  readonly chunkRecipeSource: ChunkRecipeSource;
  readonly enemies: ReadonlyMap<string, RuntimeEnemy>;
  readonly defeatedBossIds: ReadonlySet<string>;
  readonly enemyHealthContext: EnemyHealthContext;
  readonly buildings: readonly BuildingState[];
}): readonly RuntimeEnemy[] => {
  const visibleChunks = visibleChunksFor(
    world,
    playerPosition,
    chunkRecipeSource,
  );
  const drafts = missingVisibleRuntimeEnemyDraftsFor({
    visibleChunks,
    existingEnemies: enemies,
    defeatedBossIds,
    enemyHealthContext,
  });
  return drafts.flatMap((draft) => {
    const clearance = enemyTerrainClearanceFor(draft.kind);
    const position = nearestWallSafePosition(
      draft.position,
      buildings,
      clearance,
      (candidate) =>
        terrainBlocksPosition(world, candidate, chunkRecipeSource, clearance),
    );
    if (position === null) return [];
    return [
      position === draft.position
        ? draft
        : {
            ...draft,
            position: copyVector(position),
            spawnPosition: copyVector(position),
          },
    ];
  });
};

interface StartedWavePlan {
  readonly waveIndex: number;
  readonly enemies: readonly RuntimeEnemy[];
  readonly notice: GameNotice | null;
}

export interface WaveLifecyclePlan {
  readonly expiredEnemyIds: readonly string[];
  /** Queue this phase before considering a pending wave, exactly as before. */
  readonly pendingWaveIndex: number | null;
  /** A failed placement deliberately keeps that pending wave for a later tick. */
  readonly startedWave: StartedWavePlan | null;
}

/**
 * Plans transient waves against explicit read-only inputs. It never mutates a
 * runtime map or set; GameSession applies the plan at the original tick phase.
 */
export const waveLifecyclePlanFor = ({
  world,
  playerPosition,
  elapsed,
  enemies,
  startedWaveIndices,
  pendingWaveIndices,
  enemyHealthContext,
  chunkRecipeSource,
  buildings,
}: {
  readonly world: WorldIdentity;
  readonly playerPosition: Vector2;
  readonly elapsed: number;
  readonly enemies: ReadonlyMap<string, RuntimeEnemy>;
  readonly startedWaveIndices: ReadonlySet<number>;
  readonly pendingWaveIndices: ReadonlySet<number>;
  readonly enemyHealthContext: EnemyHealthContext;
  readonly chunkRecipeSource: ChunkRecipeSource;
  readonly buildings: readonly BuildingState[];
}): WaveLifecyclePlan => {
  const expiredEnemyIds = [...enemies].flatMap(([id, enemy]) =>
    enemy.waveExpiresAt !== undefined &&
    elapsed + 0.000_001 >= enemy.waveExpiresAt
      ? [id]
      : [],
  );
  const phase = wavePhaseFor(elapsed);
  const pendingWaveIndex =
    phase.active &&
    !startedWaveIndices.has(phase.waveIndex) &&
    !pendingWaveIndices.has(phase.waveIndex)
      ? phase.waveIndex
      : null;
  const plannedPendingWaves = new Set(pendingWaveIndices);
  if (pendingWaveIndex !== null) plannedPendingWaves.add(pendingWaveIndex);

  for (const waveIndex of plannedPendingWaves) {
    const drafts = waveEnemyDraftsFor({
      seed: world.seed,
      waveIndex,
      center: playerPosition,
      enemyHealthContext,
    });
    const safeDrafts = drafts.map((enemy) => {
      const clearance = enemyTerrainClearanceFor(enemy.kind);
      const terrainPosition = nearestTerrainSafePosition(
        world,
        enemy.position,
        chunkRecipeSource,
        clearance,
      );
      return {
        enemy,
        position:
          terrainPosition === null
            ? null
            : nearestWallSafePosition(
                terrainPosition,
                buildings,
                clearance,
                (candidate) =>
                  terrainBlocksPosition(
                    world,
                    candidate,
                    chunkRecipeSource,
                    clearance,
                  ),
              ),
      };
    });
    // Do not partially materialize a required wave. A bounded V3 search can
    // exhaust while terrain blocks every draft, so retain the complete wave
    // for a later retry rather than treating that failure as progression.
    if (safeDrafts.some((draft) => draft.position === null))
      return { expiredEnemyIds, pendingWaveIndex, startedWave: null };

    const waveEnemies: RuntimeEnemy[] = [];
    for (const { enemy, position } of safeDrafts) {
      if (position === null)
        return { expiredEnemyIds, pendingWaveIndex, startedWave: null };
      const waveExpiresAt =
        enemy.waveExpiresAt !== undefined &&
        elapsed + 0.000_001 >= enemy.waveExpiresAt
          ? elapsed + gameplayTuning.waveDurationSeconds
          : enemy.waveExpiresAt;
      waveEnemies.push({
        ...enemy,
        ...(waveExpiresAt === undefined ? {} : { waveExpiresAt }),
        ...(position === enemy.position
          ? {}
          : {
              position: copyVector(position),
              spawnPosition: copyVector(position),
            }),
      });
    }
    const boss = waveEnemies.find(
      (enemy) => enemy.waveIndex === waveIndex && enemy.isWaveBoss === true,
    );
    return {
      expiredEnemyIds,
      pendingWaveIndex,
      startedWave: {
        waveIndex,
        enemies: waveEnemies,
        notice:
          boss?.bossName === undefined
            ? null
            : {
                kind: "wave.started",
                waveIndex,
                bossName: boss.bossName,
              },
      },
    };
  }
  return { expiredEnemyIds, pendingWaveIndex, startedWave: null };
};

export const waveStatusFor = ({
  elapsed,
  enemies,
}: {
  readonly elapsed: number;
  readonly enemies: ReadonlyMap<string, RuntimeEnemy>;
}) => {
  const phase = wavePhaseFor(elapsed);
  const bosses = [...enemies.values()]
    .filter((enemy) => enemy.isWaveBoss === true && !enemy.defeated)
    .sort((left, right) => (right.waveIndex ?? 0) - (left.waveIndex ?? 0));
  const boss = bosses[0];
  return {
    active: phase.active,
    waveIndex: phase.waveIndex,
    secondsRemaining: phase.secondsRemaining,
    nextWaveInSeconds: phase.nextWaveInSeconds,
    bossName: boss?.bossName ?? null,
    bossActive: boss !== undefined,
  };
};

/** Creates a reset snapshot; GameSession retains replacement and cache reset. */
export const worldResetStateFor = ({
  seed,
  elapsed,
  combatStatus,
}: {
  readonly seed: string;
  readonly elapsed: number;
  readonly combatStatus: string;
}): SessionState => {
  const cleanSeed = seed.trim() || DEFAULT_WORLD.seed;
  return createFreshSessionState({
    world: {
      seed: cleanSeed,
      generatorVersion: DEFAULT_WORLD.generatorVersion,
    },
    elapsed,
    notice: { kind: "world.reset", seed: cleanSeed },
    combatStatus,
  });
};
