import type { GameNotice } from "../notices";
import type {
  CurrentSave,
  ClassProgression,
  PlayerState,
  ResourceBag,
  UpgradeId,
  ValidCampfireSaveRequest,
  WorldIdentity,
} from "../types";
import { copyVector, type SettlementCampfire } from "./sessionState";
import { projectCurrentSave } from "./saveProjection";
import { SettlementRuntime } from "./settlementRuntime";

export type CampfireSaveRequestResult =
  | { readonly ok: false; readonly notice: GameNotice }
  | { readonly ok: true; readonly request: ValidCampfireSaveRequest };

/** Projects a save without committing it or changing session lifecycle state. */
export const campfireSaveRequestFor = ({
  committedAt,
  settlement,
  world,
  player,
  resources,
  defeatedBossIds,
  upgrades,
  classProgression,
}: {
  readonly committedAt: number;
  readonly settlement: SettlementRuntime;
  readonly world: WorldIdentity;
  readonly player: PlayerState;
  readonly resources: ResourceBag;
  readonly defeatedBossIds: ReadonlySet<string>;
  readonly upgrades: ReadonlySet<UpgradeId>;
  readonly classProgression: ClassProgression;
}): CampfireSaveRequestResult => {
  const savePoint = settlement.nearbyCampfireAt(world, player.position);
  if (savePoint === null)
    return {
      ok: false,
      notice: { kind: "save.rejected.not-near-campfire" },
    };
  return {
    ok: true,
    request: {
      document: projectCurrentSave(
        {
          world,
          player,
          resources,
          buildings: settlement.buildingState,
          defeatedBossIds,
          upgrades,
          classProgression,
          nextBuildingSerial: settlement.serial,
        },
        committedAt,
        savePoint,
      ),
      savePointLabel: savePoint.label,
    },
  };
};

export interface SaveCommitResult {
  readonly committedSavePoint: SettlementCampfire;
  readonly notice: GameNotice;
}

/** Builds the state publication that follows a successful external save. */
export const saveCommitResultFor = (
  document: CurrentSave,
): SaveCommitResult => ({
  committedSavePoint: {
    id: document.savePointId,
    label: "committed campfire",
    position: copyVector(document.savePointPosition),
    level: 1,
  },
  notice: {
    kind: "save.committed",
    savePointId: document.savePointId,
  },
});
