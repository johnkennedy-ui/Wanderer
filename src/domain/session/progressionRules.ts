import {
  buildingDefinitions,
  classDefinitionFor,
  classSkillDefinitionFor,
  classSkillDefinitions,
  gameplayTuning,
  upgradeDefinitionFor,
  weaponRelicDefinitionFor,
  type UpgradeEffect,
} from "../../data/definitions";
import type {
  AllocatablePlayerStatKind,
  BuildingState,
  ClassProgression,
  ClassSkillId,
  CombatStats,
  PlayerLevel,
  PlayerStatAllocations,
  PlayerState,
  PlayerClass,
  PlayerStats,
  UpgradeId,
} from "../types";
import {
  allocatablePlayerStatKinds,
  emptyPlayerStatAllocations,
  emptyPlayerStats,
  maximumClassSkillTier,
} from "../types";

export interface ProjectileUpgradeEffects {
  readonly chainDamageMultiplier: number;
  readonly hitHeal: number;
}

export interface WeaponRelicEffects {
  readonly rank: number;
  readonly label: string | null;
  readonly description: string | null;
  readonly projectileCount: number;
  readonly projectileDamageMultiplier: number;
  readonly projectileHoming: boolean;
  readonly crescentRadiusBonus: number;
  readonly crescentDamageMultiplier: number;
}

/** A full V4 progression value for APIs that permit a no-class default. */
export const defaultClassProgression = (): ClassProgression => ({
  experience: 0,
  level: 0,
  playerClass: null,
  skillIds: [],
  allocatedStats: emptyPlayerStatAllocations(),
  weaponRank: 0,
});

const noWeaponRelicEffects = (): WeaponRelicEffects => ({
  rank: 0,
  label: null,
  description: null,
  projectileCount: 1,
  projectileDamageMultiplier: 1,
  projectileHoming: false,
  crescentRadiusBonus: 0,
  crescentDamageMultiplier: 1,
});

/** Returns data-authored, unbounded rank effects for the selected class relic. */
export const weaponRelicEffectsFor = (
  progression: ClassProgression,
): WeaponRelicEffects => {
  const rank = progression.weaponRank ?? 0;
  if (progression.playerClass === null || rank <= 0)
    return noWeaponRelicEffects();
  const definition = weaponRelicDefinitionFor(progression.playerClass);
  const additionalRanks = Math.max(0, rank - 1);
  switch (progression.playerClass) {
    case "knight":
      return {
        rank,
        label: definition.label,
        description: definition.abilityDescription,
        projectileCount: 1,
        projectileDamageMultiplier: 1,
        projectileHoming: false,
        crescentRadiusBonus:
          gameplayTuning.weaponRelicKnightRankOneRadiusBonus +
          additionalRanks *
            gameplayTuning.weaponRelicKnightRadiusBonusPerAdditionalRank,
        crescentDamageMultiplier:
          gameplayTuning.weaponRelicKnightRankOneDamageMultiplier +
          additionalRanks *
            gameplayTuning.weaponRelicKnightDamageMultiplierPerAdditionalRank,
      };
    case "wizard":
      return {
        rank,
        label: definition.label,
        description: definition.abilityDescription,
        projectileCount: 1,
        projectileDamageMultiplier:
          1 +
          additionalRanks *
            gameplayTuning.weaponRelicWizardDamageMultiplierPerAdditionalRank,
        projectileHoming: true,
        crescentRadiusBonus: 0,
        crescentDamageMultiplier: 1,
      };
    case "archer":
      return {
        rank,
        label: definition.label,
        description: definition.abilityDescription,
        projectileCount: 2,
        projectileDamageMultiplier:
          1 +
          additionalRanks *
            gameplayTuning.weaponRelicArcherDamageMultiplierPerAdditionalRank,
        projectileHoming: false,
        crescentRadiusBonus: 0,
        crescentDamageMultiplier: 1,
      };
  }
};

export const playerLevelForExperience = (experience: number): PlayerLevel => {
  const reached = gameplayTuning.experienceThresholds.filter(
    (threshold) => experience >= threshold,
  ).length;
  return Math.min(
    gameplayTuning.experienceThresholds.length,
    reached,
  ) as PlayerLevel;
};

/** Only the mobile martial classes retain auto-attacks while moving. */
export const movingAttackSpeedMultiplierFor = (
  progression: ClassProgression,
): number =>
  progression.playerClass === "knight" || progression.playerClass === "archer"
    ? 0.5
    : 0;

/** Clones a complete allocation record so callers never retain save aliases. */
export const normalizedAllocatedStatsFor = (
  progression: Pick<ClassProgression, "allocatedStats">,
): PlayerStatAllocations => {
  const source = progression.allocatedStats ?? emptyPlayerStatAllocations();
  return {
    strength: source.strength ?? 0,
    agility: source.agility ?? 0,
    vitality: source.vitality ?? 0,
    magic: source.magic ?? 0,
    dexterity: source.dexterity ?? 0,
    luck: source.luck ?? 0,
  };
};

export const allocatedStatTotalFor = (
  progression: Pick<ClassProgression, "allocatedStats">,
): number => {
  const allocated = normalizedAllocatedStatsFor(progression);
  return allocatablePlayerStatKinds.reduce(
    (total, stat) => total + allocated[stat],
    0,
  );
};

/** Every earned level grants three extra points, held until the player selects a class. */
export const statPointsAvailableFor = (progression: ClassProgression): number =>
  Math.max(0, progression.level * 3 - allocatedStatTotalFor(progression));

/**
 * Builds effective RO-inspired stats from an identical class-base grant at
 * every level plus persistent player allocations. Defense values are derived,
 * never stored or allocatable.
 */
export const playerStatsFor = (progression: ClassProgression): PlayerStats => {
  if (progression.playerClass === null) return emptyPlayerStats();
  const base = classDefinitionFor(progression.playerClass).passiveStats;
  const allocated = normalizedAllocatedStatsFor(progression);
  const atLevel = (stat: AllocatablePlayerStatKind): number =>
    base[stat] * progression.level + allocated[stat];
  const vitality = atLevel("vitality");
  const magic = atLevel("magic");
  return {
    strength: atLevel("strength"),
    dexterity: atLevel("dexterity"),
    agility: atLevel("agility"),
    luck: atLevel("luck"),
    vitality,
    magic,
    defense: Math.floor(vitality / 2),
    magicDefense: Math.floor(magic / 2),
  };
};

export const applyClassPassiveToPlayer = (
  player: PlayerState,
  playerClass: PlayerClass,
  level = 1,
): PlayerState => {
  const vitality = classDefinitionFor(playerClass).passiveStats.vitality;
  return vitality === 0
    ? { ...player }
    : applyMaximumHealth(
        player,
        vitality * Math.max(1, level) * gameplayTuning.vitalityHealthPerPoint,
      );
};

export const pendingClassSkillChoicesFor = (
  progression: ClassProgression,
): readonly ClassSkillId[] => {
  if (progression.playerClass === null) return [];
  const tier = progression.skillIds.length + 1;
  if (tier > maximumClassSkillTier || progression.level < tier + 1) return [];
  const selectedRoute = progression.skillIds
    .map(classSkillDefinitionFor)
    .find((skill) => skill.tier === 5)?.route;
  if (tier > 5 && selectedRoute === undefined) return [];
  return classSkillDefinitions
    .filter(
      (skill) =>
        skill.playerClass === progression.playerClass &&
        skill.tier === tier &&
        (tier <= 5 || skill.route === selectedRoute),
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

/** Applies only base-class vitality newly earned by one or more levels. */
export const applyLevelGrowthToPlayer = (
  player: PlayerState,
  previous: ClassProgression,
  next: ClassProgression,
): PlayerState => {
  if (
    previous.playerClass === null ||
    previous.playerClass !== next.playerClass ||
    next.level <= previous.level
  )
    return { ...player };
  const vitality = classDefinitionFor(previous.playerClass).passiveStats
    .vitality;
  return vitality === 0
    ? { ...player }
    : applyMaximumHealth(
        player,
        (next.level - previous.level) *
          vitality *
          gameplayTuning.vitalityHealthPerPoint,
      );
};

/** Only a Vitality allocation changes persisted health immediately. */
export const applyAllocatedStatToPlayer = (
  player: PlayerState,
  stat: AllocatablePlayerStatKind,
): PlayerState =>
  stat === "vitality"
    ? applyMaximumHealth(player, gameplayTuning.vitalityHealthPerPoint)
    : { ...player };

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
  progression: ClassProgression = defaultClassProgression(),
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
  const weaponRelic = weaponRelicEffectsFor(progression);
  const playerStats = playerStatsFor(progression);

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

  if (attackStyle === "slash") {
    attackDamage *= weaponRelic.crescentDamageMultiplier;
    classAreaRadius += weaponRelic.crescentRadiusBonus;
    attackRange += weaponRelic.crescentRadiusBonus;
  }

  if (attackStyle === "magic") attackDamage += playerStats.magic;
  else if (attackStyle === "arrow") attackDamage += playerStats.dexterity;
  else if (attackStyle === "slash") attackDamage += playerStats.strength;
  attackIntervalSeconds *= Math.max(
    0.5,
    1 -
      playerStats.agility *
        gameplayTuning.agilityAttackIntervalReductionPerPoint,
  );
  moveSpeed += playerStats.agility * gameplayTuning.agilityMoveSpeedPerPoint;

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
        if (attackStyle === "slash") attackRange += effect.amount;
        break;
      case "arc-cosine":
        classArcCosine = Math.max(
          -1,
          Math.min(1, classArcCosine + effect.amount),
        );
        break;
      case "secondary-damage-multiplier":
        classSecondaryDamageMultiplier = Math.min(
          1,
          classSecondaryDamageMultiplier + effect.amount,
        );
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
    weaponProjectileCount: weaponRelic.projectileCount,
    weaponProjectileDamageMultiplier: weaponRelic.projectileDamageMultiplier,
    weaponProjectileHoming: weaponRelic.projectileHoming,
    physicalDefense: playerStats.defense,
    magicDefense: playerStats.magicDefense,
    dodgeChance: Math.min(
      gameplayTuning.maximumDodgeChance,
      playerStats.agility * gameplayTuning.agilityDodgeChancePerPoint,
    ),
    physicalCriticalChance:
      attackStyle === "magic"
        ? 0
        : Math.min(
            gameplayTuning.maximumPhysicalCriticalChance,
            playerStats.luck *
              gameplayTuning.luckPhysicalCriticalChancePerPoint,
          ),
    physicalCriticalDamageMultiplier:
      gameplayTuning.physicalCriticalDamageMultiplier,
  };
};

export const projectileUpgradeEffectsFor = (
  upgrades: Iterable<UpgradeId>,
  progression: ClassProgression = defaultClassProgression(),
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
  progression: ClassProgression = defaultClassProgression(),
): string[] => {
  const effects = [
    "Resources: uncapped. Legacy Storage remains visible but cannot be upgraded or relocated.",
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
  const weaponRelic = weaponRelicEffectsFor(progression);
  if (weaponRelic.rank > 0 && weaponRelic.label !== null)
    effects.push(
      `${weaponRelic.label} rank ${weaponRelic.rank}: ${weaponRelic.description}`,
    );
  return effects;
};
