import { enemyDefinitions, upgradeDefinitionFor } from "../../data/definitions";
import type { GameNotice } from "../notices";
import {
  allocatablePlayerStatKinds,
  emptyPlayerStatAllocations,
  type AllocatablePlayerStatKind,
  type ClassProgression,
  type ClassSkillId,
  type PlayerClass,
  type PlayerState,
  type UpgradeId,
} from "../types";
import {
  hpWithPreservedFraction,
  maxEnemyHpFor,
  type EnemyHealthContext,
} from "./enemyHealthScaling";
import {
  applyAllocatedStatToPlayer,
  applyClassPassiveToPlayer,
  applyClassSkillToPlayer,
  applyLevelGrowthToPlayer,
  applyUpgradeEffectToPlayer,
  combatStatsFor,
  isValidClassSkillChoice,
  normalizeLegacySkillSelectionForCurrentProgression,
  playerLevelForExperience,
  statPointsAvailableFor,
} from "./progressionRules";
import type { RuntimeEnemy } from "./sessionState";

export type UpgradeChoiceResult =
  | { readonly ok: false; readonly notice: GameNotice }
  | {
      readonly ok: true;
      readonly upgradeId: UpgradeId;
      readonly player: PlayerState;
      readonly notice: GameNotice;
    };

export const upgradeChoiceFor = ({
  id,
  pendingUpgradeChoices,
  upgrades,
  player,
}: {
  readonly id: UpgradeId;
  readonly pendingUpgradeChoices: readonly UpgradeId[];
  readonly upgrades: ReadonlySet<UpgradeId>;
  readonly player: PlayerState;
}): UpgradeChoiceResult => {
  if (
    pendingUpgradeChoices.length !== 3 ||
    !pendingUpgradeChoices.includes(id) ||
    upgrades.has(id)
  )
    return {
      ok: false,
      notice: { kind: "upgrade.rejected.invalid-choice" },
    };
  const upgrade = upgradeDefinitionFor(id);
  return {
    ok: true,
    upgradeId: id,
    player: applyUpgradeEffectToPlayer(player, upgrade.effect),
    notice: { kind: "upgrade.applied", upgradeId: id },
  };
};

export type ClassChoiceResult =
  | { readonly ok: false; readonly notice: GameNotice }
  | {
      readonly ok: true;
      readonly progression: ClassProgression;
      readonly player: PlayerState;
      readonly notice: GameNotice;
    };

export const classChoiceFor = ({
  playerClass,
  progression,
  player,
}: {
  readonly playerClass: PlayerClass;
  readonly progression: ClassProgression;
  readonly player: PlayerState;
}): ClassChoiceResult => {
  if (progression.level < 1 || progression.playerClass !== null)
    return {
      ok: false,
      notice: { kind: "class.rejected.invalid-choice" },
    };
  const nextProgression = normalizeLegacySkillSelectionForCurrentProgression({
    ...progression,
    playerClass,
  });
  return {
    ok: true,
    progression: nextProgression,
    player: applyClassPassiveToPlayer(
      player,
      playerClass,
      nextProgression.level,
    ),
    notice: { kind: "class.selected", playerClass },
  };
};

export type StatAllocationResult =
  | { readonly ok: false; readonly notice: GameNotice }
  | {
      readonly ok: true;
      readonly progression: ClassProgression;
      readonly player: PlayerState;
      readonly notice: GameNotice;
    };

/** Allocates one earned point without implying persistence or UI wording. */
export const statAllocationFor = ({
  stat,
  progression,
  player,
}: {
  readonly stat: AllocatablePlayerStatKind;
  readonly progression: ClassProgression;
  readonly player: PlayerState;
}): StatAllocationResult => {
  if (!allocatablePlayerStatKinds.includes(stat))
    return {
      ok: false,
      notice: { kind: "stat-allocation.rejected.invalid-stat" },
    };
  if (progression.playerClass === null)
    return {
      ok: false,
      notice: { kind: "stat-allocation.rejected.no-class" },
    };
  const statPointsAvailable = statPointsAvailableFor(progression);
  if (statPointsAvailable <= 0)
    return {
      ok: false,
      notice: { kind: "stat-allocation.rejected.no-points" },
    };
  const allocated = progression.allocatedStats[stat] + 1;
  const nextProgression = {
    ...progression,
    allocatedStats: {
      ...progression.allocatedStats,
      [stat]: allocated,
    },
  };
  return {
    ok: true,
    progression: nextProgression,
    player: applyAllocatedStatToPlayer(player, stat),
    notice: {
      kind: "stat-allocation.applied",
      stat,
      allocated,
      statPointsAvailable: statPointsAvailable - 1,
    },
  };
};

export type ClassSkillChoiceResult =
  | { readonly ok: false; readonly notice: GameNotice }
  | {
      readonly ok: true;
      readonly progression: ClassProgression;
      readonly player: PlayerState;
      readonly notice: GameNotice;
    };

export const classSkillChoiceFor = ({
  skillId,
  progression,
  player,
}: {
  readonly skillId: ClassSkillId;
  readonly progression: ClassProgression;
  readonly player: PlayerState;
}): ClassSkillChoiceResult => {
  if (!isValidClassSkillChoice(progression, skillId))
    return {
      ok: false,
      notice: { kind: "class-skill.rejected.invalid-choice" },
    };
  return {
    ok: true,
    progression: {
      ...progression,
      skillIds: [...progression.skillIds, skillId],
    },
    player: applyClassSkillToPlayer(player, skillId),
    notice: { kind: "class-skill.selected", skillId },
  };
};

export interface ExperienceResult {
  readonly progression: ClassProgression;
  readonly player: PlayerState;
  readonly gainedLevel: boolean;
}

/** Applies XP and the identical next-level base-stat grant exactly once. */
export const experienceResultFor = ({
  amount,
  progression,
  player,
}: {
  readonly amount: number;
  readonly progression: ClassProgression;
  readonly player: PlayerState;
}): ExperienceResult => {
  const experience = progression.experience + amount;
  const nextProgression = normalizeLegacySkillSelectionForCurrentProgression({
    ...progression,
    experience,
    level: playerLevelForExperience(experience),
  });
  return {
    progression: nextProgression,
    player: applyLevelGrowthToPlayer(player, progression, nextProgression),
    gainedLevel: nextProgression.level > progression.level,
  };
};

/**
 * Uses only the selected class and earned level. Optional player power is
 * intentionally absent so skills, stats, upgrades, and relics retain payoff.
 */
export const enemyHealthContextFor = (
  progression: ClassProgression,
): EnemyHealthContext => {
  const baselineProgression = {
    ...progression,
    skillIds: [],
    allocatedStats: emptyPlayerStatAllocations(),
    weaponRank: 0,
  };
  return {
    level: baselineProgression.level,
    normalPrimaryDamage: combatStatsFor([], [], baselineProgression)
      .attackDamage,
  };
};

export interface EnemyHealthAdjustment {
  readonly id: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly spawnHealthMultiplier: number;
}

/** Calculates health changes; the session retains the live enemy mutations. */
export const enemyHealthAdjustmentsFor = (
  enemies: ReadonlyMap<string, RuntimeEnemy>,
  context: EnemyHealthContext,
): readonly EnemyHealthAdjustment[] =>
  [...enemies].map(([id, enemy]) => {
    const spawnHealthMultiplier = enemy.spawnHealthMultiplier ?? 1;
    const maxHp = maxEnemyHpFor({
      authoredMaxHp: enemyDefinitions[enemy.kind].maxHp,
      spawnHealthMultiplier,
      context,
    });
    return {
      id,
      hp: hpWithPreservedFraction(enemy, maxHp),
      maxHp,
      spawnHealthMultiplier,
    };
  });
