import type {
  BuildingState,
  ClassProgression,
  CurrentSave,
  ResourceBag,
  UpgradeId,
  Vector2,
  WorldIdentity,
} from "../types";
import {
  cloneBuildings,
  cloneResources,
  copyVector,
  copyWorldIdentity,
} from "./sessionState";
import type { SettlementCampfire } from "./sessionState";

/** The narrow current runtime data that is allowed to cross into persistence. */
export interface SaveProjectionInput {
  readonly world: WorldIdentity;
  readonly player: {
    readonly position: Vector2;
    readonly hp: number;
    readonly maxHp: number;
  };
  readonly resources: ResourceBag;
  readonly buildings: readonly BuildingState[];
  readonly defeatedBossIds: Iterable<string>;
  readonly upgrades: Iterable<UpgradeId>;
  readonly classProgression: ClassProgression;
  readonly nextBuildingSerial: number;
}

/**
 * Projects an instance-owned state snapshot into the exact current save shape.
 * It clones every nested value so neither save callers nor later runtime
 * mutations can alias the returned document.
 */
export const projectCurrentSave = (
  state: SaveProjectionInput,
  committedAt: number,
  savePoint: SettlementCampfire,
): CurrentSave => ({
  schemaVersion: 2,
  world: copyWorldIdentity(state.world),
  player: {
    position: copyVector(state.player.position),
    hp: state.player.hp,
    maxHp: state.player.maxHp,
  },
  resources: cloneResources(state.resources),
  buildings: cloneBuildings(state.buildings),
  defeatedBossIds: [...state.defeatedBossIds].sort(),
  upgrades: [...state.upgrades].sort(),
  nextBuildingSerial: state.nextBuildingSerial,
  committedAt,
  savePointId: savePoint.id,
  savePointPosition: copyVector(savePoint.position),
  classProgression: {
    ...state.classProgression,
    skillIds: [...state.classProgression.skillIds],
    weaponRank: state.classProgression.weaponRank ?? 0,
  },
});
