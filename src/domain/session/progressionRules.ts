import {
  buildingDefinitions,
  classDefinitionFor,
  classSkillDefinitionFor,
  classSkillDefinitions,
  gameplayTuning,
  upgradeDefinitionFor,
  type UpgradeEffect,
} from "../../data/definitions";
import type {
  BuildingState,
  ClassProgression,
  ClassSkillId,
  CombatStats,
  PlayerState,
  UpgradeId,
} from "../types";
import { materialCapacityFor } from "./economy";

export interface ProjectileUpgradeEffects {
  readonly chainDamageMultiplier: number;
  readonly hitHeal: number;
}

export const playerLevelForExperience = (
  experience: number,
): 0 | 1 | 2 | 3 | 4 | 5 => {
  const reached = gameplayTuning.experienceThresholds.filter(
    (threshold) => experience >= threshold,
  ).length;
  return Math.min(5, reached) as 0 | 1 | 2 | 3 | 4 | 5;
};

export const pendingClassSkillChoicesFor = (
  progression: ClassProgression,
): readonly ClassSkillId[] => {
  if (progression.playerClass === null) return [];
  const tier = progression.skillIds.length + 1;
  if (tier > 4 || progression.level < tier + 1) return [];
  return classSkillDefinitions
    .filter(
      (skill) =>
        skill.playerClass === progression.playerClass && skill.tier === tier,
    )
    .map((skill) => skill.id);
};

export const isValidClassSkillChoice = (
  progression: ClassProgression,
  skillId: ClassSkillId,
): boolean =>
  !progression.skillIds.includes(skillId) &&
  pendingClassSkillChoicesFor(progression).includes(skillId);

const applyMaximumHealth = (
  player: PlayerState,
  amount: number,
): PlayerState => {
  const maxHp = player.maxHp + amount;
  return { ...player, maxHp, hp: Math.min(maxHp, player.hp + amount) };
};

export const applyClassSkillToPlayer = (
  player: PlayerState,
  skillId: ClassSkillId,
): PlayerState => {
  const effect = classSkillDefinitionFor(skillId).effect;
  return effect.kind === "maximum-health"
    ? applyMaximumHealth(player, effect.amount)
    : { ...player };
};

const exhaustUpgradeEffect = (effect: never): never => {
  throw new Error(`Unhandled upgrade effect: ${JSON.stringify(effect)}`);
};

export const combatStatsFor = (
  buildings: readonly BuildingState[],
  upgrades: Iterable<UpgradeId>,
  progression: ClassProgression = {
    experience: 0,
    level: 0,
    playerClass: null,
    skillIds: [],
  },
): CombatStats => {
  let attackDamage =
    gameplayTuning.baseAttackDamage +
    buildings
      .filter((building) => building.kind === "Workshop")
      .reduce(
        (total, building) =>
          total + gameplayTuning.workshopDamageBonusByLevel[building.level - 1],
        0,
      );
  let attackIntervalSeconds = gameplayTuning.baseAttackIntervalSeconds;
  let attackRange = gameplayTuning.baseAttackRange;
  let moveSpeed = gameplayTuning.baseMoveSpeed;
  let chainTargets = 0;
  let attackStyle: CombatStats["attackStyle"] = "basic";
  let classSecondaryDamageMultiplier = 0;
  let classAreaRadius = 0;
  let classArcCosine = 1;

  if (progression.playerClass !== null) {
    const playerClass = classDefinitionFor(progression.playerClass);
    attackStyle = playerClass.attackStyle;
    attackDamage *= playerClass.damageMultiplier;
    attackIntervalSeconds = playerClass.attackIntervalSeconds;
    attackRange = playerClass.attackRange;
    classSecondaryDamageMultiplier = playerClass.secondaryDamageMultiplier;
    classAreaRadius = playerClass.areaRadius;
    classArcCosine = playerClass.arcCosine;
    chainTargets += playerClass.secondaryTargets;
  }

  for (const id of upgrades) {
    const effect = upgradeDefinitionFor(id).effect;
    switch (effect.kind) {
      case "attack-damage":
        attackDamage += effect.amount;
        break;
      case "attack-interval":
        attackIntervalSeconds *= effect.multiplier;
        break;
      case "attack-range":
        attackRange *= effect.multiplier;
        break;
      case "move-speed":
        moveSpeed *= effect.multiplier;
        break;
      case "chain-strike":
        chainTargets += effect.targetCount;
        break;
      case "maximum-health":
      case "hit-heal":
        break;
      default:
        exhaustUpgradeEffect(effect);
    }
  }
  for (const skillId of progression.skillIds) {
    const effect = classSkillDefinitionFor(skillId).effect;
    switch (effect.kind) {
      case "attack-damage":
        attackDamage += effect.amount;
        break;
      case "attack-interval":
        attackIntervalSeconds *= effect.multiplier;
        break;
      case "attack-range":
        attackRange *= effect.multiplier;
        break;
      case "move-speed":
        moveSpeed *= effect.multiplier;
        break;
      case "chain-strike":
        chainTargets += effect.targetCount;
        break;
      case "area-radius":
        classAreaRadius += effect.amount;
        break;
      case "secondary-targets":
        chainTargets += effect.amount;
        break;
      case "maximum-health":
      case "hit-heal":
        break;
      default:
        exhaustUpgradeEffect(effect);
    }
  }
  return {
    attackDamage,
    attackIntervalSeconds,
    attackRange,
    moveSpeed,
    chainTargets,
    attackStyle,
    classSecondaryDamageMultiplier,
    classAreaRadius,
    classArcCosine,
  };
};

export const projectileUpgradeEffectsFor = (
  upgrades: Iterable<UpgradeId>,
  progression: ClassProgression = {
    experience: 0,
    level: 0,
    playerClass: null,
    skillIds: [],
  },
): ProjectileUpgradeEffects => {
  let chainDamageMultiplier = 0;
  let hitHeal = 0;
  for (const id of upgrades) {
    const effect = upgradeDefinitionFor(id).effect;
    switch (effect.kind) {
      case "chain-strike":
        chainDamageMultiplier += effect.damageMultiplier;
        break;
      case "hit-heal":
        hitHeal += effect.amount;
        break;
      case "attack-damage":
      case "attack-interval":
      case "attack-range":
      case "move-speed":
      case "maximum-health":
        break;
      default:
        exhaustUpgradeEffect(effect);
    }
  }
  for (const skillId of progression.skillIds) {
    const effect = classSkillDefinitionFor(skillId).effect;
    if (effect.kind === "hit-heal") hitHeal += effect.amount;
  }
  return { chainDamageMultiplier, hitHeal };
};

export const applyUpgradeEffectToPlayer = (
  player: PlayerState,
  effect: UpgradeEffect,
): PlayerState => {
  switch (effect.kind) {
    case "maximum-health": {
      const maxHp = player.maxHp + effect.amount;
      return {
        ...player,
        maxHp,
        hp: Math.min(maxHp, player.hp + effect.amount),
      };
    }
    case "attack-damage":
    case "attack-interval":
    case "attack-range":
    case "move-speed":
    case "chain-strike":
    case "hit-heal":
      return { ...player };
    default:
      return exhaustUpgradeEffect(effect);
  }
};

export const describeProgressionEffects = (
  buildings: readonly BuildingState[],
  upgrades: Iterable<UpgradeId>,
  progression: ClassProgression = {
    experience: 0,
    level: 0,
    playerClass: null,
    skillIds: [],
  },
): string[] => {
  const effects = [
    `Storage: ${materialCapacityFor(buildings)} each for Wood, Stone, Metal / Scrap, and Essence; Boss Core is exempt.`,
    `Hearth Ward: ${gameplayTuning.baseCampfireHealingPerSecond} health/s while stationary near a campfire.`,
    `Death: ${(gameplayTuning.deathResourceLossRate * 100).toFixed(0)}% carried-resource loss; no death save.`,
  ];
  for (const building of buildings)
    effects.push(
      `${buildingDefinitions[building.kind].label} L${building.level}: ${buildingDefinitions[building.kind].levelEffects[building.level - 1]}`,
    );
  for (const id of upgrades) {
    const upgrade = upgradeDefinitionFor(id);
    effects.push(`${upgrade.label}: ${upgrade.description}`);
  }
  const nextThreshold =
    gameplayTuning.experienceThresholds.at(progression.level) ?? null;
  effects.push(
    progression.playerClass === null
      ? `Experience: ${progression.experience}${nextThreshold === null ? "" : ` / ${nextThreshold}`} · choose a class at level 1.`
      : `Experience: ${progression.experience}${nextThreshold === null ? "" : ` / ${nextThreshold}`} · ${classDefinitionFor(progression.playerClass).label} level ${progression.level}.`,
  );
  for (const skillId of progression.skillIds) {
    const skill = classSkillDefinitionFor(skillId);
    effects.push(`${skill.label}: ${skill.description}`);
  }
  return effects;
};
