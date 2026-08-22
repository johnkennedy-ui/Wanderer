import {
  buildingDefinitions,
  gameplayTuning,
  upgradeDefinitionFor,
  type UpgradeEffect,
} from "../../data/definitions";
import type {
  BuildingState,
  CombatStats,
  PlayerState,
  UpgradeId,
} from "../types";
import { materialCapacityFor } from "./economy";

export interface ProjectileUpgradeEffects {
  readonly chainDamageMultiplier: number;
  readonly hitHeal: number;
}

const exhaustUpgradeEffect = (effect: never): never => {
  throw new Error(`Unhandled upgrade effect: ${JSON.stringify(effect)}`);
};

export const combatStatsFor = (
  buildings: readonly BuildingState[],
  upgrades: Iterable<UpgradeId>,
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
  return {
    attackDamage,
    attackIntervalSeconds,
    attackRange,
    moveSpeed,
    chainTargets,
  };
};

export const projectileUpgradeEffectsFor = (
  upgrades: Iterable<UpgradeId>,
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
  return effects;
};
