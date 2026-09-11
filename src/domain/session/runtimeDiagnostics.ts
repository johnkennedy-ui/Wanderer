import { deepFreeze } from "../../data/deepFreeze";
import type { SessionState } from "./sessionState";
import { cloneBuildings, copyVector } from "./sessionState";
import { CHUNK_RECIPE_CACHE_CAPACITY } from "./chunkRecipeCache";
import type { ChunkRecipeCacheDiagnostics } from "./chunkRecipeCache";

/** Copy-out evidence only. Never use this projection as gameplay/UI authority. */
export type RuntimeDiagnosticsInput = Pick<
  SessionState,
  | "world"
  | "player"
  | "resources"
  | "enemies"
  | "projectiles"
  | "crescentAttacks"
  | "floorDrops"
  | "weaponRelicDrops"
  | "defeatedBossIds"
  | "upgrades"
  | "pendingUpgradeChoices"
  | "nextBuildingSerial"
  | "nextProjectileSerial"
  | "nextFloorDropSerial"
  | "committedSavePoint"
  | "input"
  | "destination"
  | "elapsed"
  | "attackElapsed"
  | "farmHarvestElapsed"
> & {
  readonly buildings: readonly SessionState["buildings"][number][];
  readonly chunkCache?: ChunkRecipeCacheDiagnostics;
};

export const projectRuntimeDiagnostics = (state: RuntimeDiagnosticsInput) => {
  // Preserve simulation order in arrays: sorting these would hide ordering drift.
  // Copy every nested member before freezing; freezing a live Map is not isolation.
  const enemies = [...state.enemies].map(([mapKey, enemy]) => ({
    ...enemy,
    mapKey,
    position: copyVector(enemy.position),
    spawnPosition: copyVector(enemy.spawnPosition),
  }));
  return deepFreeze({
    world: { ...state.world },
    elapsed: state.elapsed,
    attackElapsed: state.attackElapsed,
    farmHarvestElapsed: state.farmHarvestElapsed,
    player: { ...state.player, position: copyVector(state.player.position) },
    resources: { ...state.resources },
    buildings: cloneBuildings(state.buildings),
    enemies,
    projectiles: state.projectiles.map((projectile) => ({
      ...projectile,
      origin: copyVector(projectile.origin),
      targetPosition: copyVector(projectile.targetPosition),
      chainTargetIds: [...projectile.chainTargetIds],
    })),
    crescentAttacks: state.crescentAttacks.map((attack) => ({
      ...attack,
      origin: copyVector(attack.origin),
      direction: copyVector(attack.direction),
    })),
    floorDrops: state.floorDrops.map((drop) => ({
      ...drop,
      position: copyVector(drop.position),
    })),
    weaponRelicDrops: state.weaponRelicDrops.map((drop) => ({
      ...drop,
      position: copyVector(drop.position),
    })),
    defeatedBossIds: [...state.defeatedBossIds].sort(),
    upgrades: [...state.upgrades].sort(),
    pendingUpgradeChoices: [...state.pendingUpgradeChoices],
    committedSavePoint: {
      ...state.committedSavePoint,
      position: copyVector(state.committedSavePoint.position),
    },
    input: { ...state.input, intent: copyVector(state.input.intent) },
    destination:
      state.destination === null ? null : copyVector(state.destination),
    serials: {
      building: state.nextBuildingSerial,
      projectile: state.nextProjectileSerial,
      floorDrop: state.nextFloorDropSerial,
    },
    chunkCache: {
      ...(state.chunkCache ?? {
        capacity: CHUNK_RECIPE_CACHE_CAPACITY,
        hits: 0,
        misses: 0,
        size: 0,
        evictions: 0,
      }),
    },
    counts: {
      // Global pursuit means every non-defeated retained enemy is active.
      activeEnemies: enemies.filter((enemy) => !enemy.defeated).length,
      retainedEnemyDeltas: enemies.length,
      projectiles: state.projectiles.length,
      crescentAttacks: state.crescentAttacks.length,
      floorDrops: state.floorDrops.length,
      weaponRelicDrops: state.weaponRelicDrops.length,
      cachedChunks: state.chunkCache?.size ?? 0,
    },
  });
};

export type RuntimeDiagnostics = ReturnType<typeof projectRuntimeDiagnostics>;
