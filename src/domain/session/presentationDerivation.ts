import { gameplayTuning } from "../../data/definitions";
import type { PlayerHitRecoveryPresentation } from "../notices";
import type {
  BuildingState,
  ClassProgression,
  ClassSkillId,
  PlayerClass,
  PlayerStats,
  UpgradeId,
} from "../types";
import { playerHitRecoveryPresentationFor } from "./hitRecoveryPolicy";
import {
  describeProgressionEffects,
  pendingClassSkillChoicesFor,
  playerStatsFor,
  statPointsAvailableFor,
} from "./progressionRules";

export interface PresentationDerivationInput {
  readonly elapsed: number;
  readonly recoveryEndsAt: number;
  readonly buildings: readonly BuildingState[];
  readonly upgrades: ReadonlySet<UpgradeId>;
  readonly classProgression: ClassProgression;
}

export interface PresentationDerivation {
  readonly playerStats: PlayerStats;
  readonly playerHitRecovery: PlayerHitRecoveryPresentation;
  readonly effects: readonly string[];
  readonly pendingClassChoices: readonly PlayerClass[];
  readonly pendingClassSkillChoices: readonly ClassSkillId[];
  readonly statPointsAvailable: number;
}

export const presentationDerivationFor = ({
  elapsed,
  recoveryEndsAt,
  buildings,
  upgrades,
  classProgression,
}: PresentationDerivationInput): PresentationDerivation => ({
  playerStats: playerStatsFor(classProgression),
  playerHitRecovery: playerHitRecoveryPresentationFor({
    elapsed,
    recoveryEndsAt,
    recoverySeconds: gameplayTuning.playerHitRecoverySeconds,
    flashIntervalSeconds: gameplayTuning.playerHitRecoveryFlashIntervalSeconds,
  }),
  effects: describeProgressionEffects(
    buildings,
    upgrades,
    classProgression,
  ).filter((effect) => !effect.startsWith("Storage")),
  pendingClassChoices:
    classProgression.playerClass === null && classProgression.level >= 1
      ? ["knight", "wizard", "archer"]
      : [],
  pendingClassSkillChoices: pendingClassSkillChoicesFor(classProgression),
  statPointsAvailable: statPointsAvailableFor(classProgression),
});
