import { deepFreeze } from "../../data/deepFreeze";
import type { SessionState } from "./sessionState";
import { cloneBuildings, copyVector } from "./sessionState";

/** Copy-out evidence only. Never use this projection as gameplay/UI authority. */
export type RuntimeDiagnosticsInput = Pick<
  SessionState,
  | "world"
  | "player"
  | "resources"
  | "enemies"
  | "projectiles"
  | "floorDrops"
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
> & { readonly buildings: readonly SessionState["buildings"][number][] };

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
    floorDrops: state.floorDrops.map((drop) => ({
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
    counts: {
      // Global pursuit means every non-defeated retained enemy is active.
      activeEnemies: enemies.filter((enemy) => !enemy.defeated).length,
      retainedEnemyDeltas: enemies.length,
      projectiles: state.projectiles.length,
      floorDrops: state.floorDrops.length,
      // No retained recipe cache exists until M5; visible recipes are transient.
      cachedChunks: 0,
    },
  });
};

export type RuntimeDiagnostics = ReturnType<typeof projectRuntimeDiagnostics>;
