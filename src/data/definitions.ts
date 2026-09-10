import { classSkillIds, playerClasses, upgradeIds } from "../domain/types";
import type {
  BuildingKind,
  ClassSkillId,
  EnemyKind,
  PlayerClass,
  PlayerStats,
  ResourceKind,
  ReadonlyResourceBag,
  UpgradeId,
} from "../domain/types";
import { deepFreeze } from "./deepFreeze";

export interface ResourceDefinition {
  readonly label: string;
  readonly storageLimited: boolean;
  readonly description: string;
  readonly groundDropColor: number;
}

export interface EnemyDefinition {
  readonly maxHp: number;
  readonly damage: number;
  readonly moveSpeed: number;
  readonly attackEverySeconds: number;
  readonly respawnSeconds: number | null;
  readonly drops: ReadonlyResourceBag;
}

export interface BuildingDefinition {
  readonly label: string;
  readonly baseCost: ReadonlyResourceBag;
  readonly description: string;
  readonly levelEffects: readonly [string, string, string];
}

export type UpgradeEffect =
  | { readonly kind: "attack-damage"; readonly amount: number }
  | { readonly kind: "attack-interval"; readonly multiplier: number }
  | { readonly kind: "attack-range"; readonly multiplier: number }
  | { readonly kind: "move-speed"; readonly multiplier: number }
  | { readonly kind: "maximum-health"; readonly amount: number }
  | {
      readonly kind: "chain-strike";
      readonly targetCount: number;
      readonly damageMultiplier: number;
    }
  | { readonly kind: "hit-heal"; readonly amount: number };

export interface UpgradeDefinition {
  readonly id: UpgradeId;
  readonly label: string;
  readonly description: string;
  readonly effect: UpgradeEffect;
}

export type ClassSkillEffect =
  | UpgradeEffect
  | { readonly kind: "area-radius"; readonly amount: number }
  | { readonly kind: "arc-cosine"; readonly amount: number }
  | { readonly kind: "secondary-targets"; readonly amount: number }
  | {
      readonly kind: "secondary-damage-multiplier";
      readonly amount: number;
    };

export interface ClassDefinition {
  readonly id: PlayerClass;
  readonly label: string;
  readonly description: string;
  readonly attackStyle: "slash" | "magic" | "arrow";
  readonly damageMultiplier: number;
  readonly attackIntervalSeconds: number;
  readonly attackRange: number;
  readonly secondaryDamageMultiplier: number;
  readonly areaRadius: number;
  readonly arcCosine: number;
  readonly secondaryTargets: number;
  readonly passiveStats: PlayerStats;
}

export interface ClassSkillDefinition {
  readonly id: ClassSkillId;
  readonly playerClass: PlayerClass;
  readonly tier: 1 | 2 | 3 | 4;
  readonly label: string;
  readonly description: string;
  readonly effect: ClassSkillEffect;
}

const authoredResourceDefinitions = {
  wood: {
    label: "Wood",
    storageLimited: true,
    description: "Common construction timber.",
    groundDropColor: 0xb87333,
  },
  stone: {
    label: "Stone",
    storageLimited: true,
    description: "Common settlement masonry.",
    groundDropColor: 0xa9b3b8,
  },
  scrap: {
    label: "Metal / Scrap",
    storageLimited: true,
    description: "Recovered metal for durable work.",
    groundDropColor: 0x8ab4c8,
  },
  essence: {
    label: "Essence",
    storageLimited: true,
    description: "Elite energy used for advanced upgrades.",
    groundDropColor: 0xb388ff,
  },
  bossCore: {
    label: "Boss Core",
    storageLimited: false,
    description:
      "Boss progression currency; saved but exempt from Storage capacity.",
    groundDropColor: 0xffd54f,
  },
} satisfies Record<ResourceKind, ResourceDefinition>;

export const resourceDefinitions = deepFreeze(authoredResourceDefinitions);

const authoredGameplayTuning = {
  deathResourceLossRate: 0.25,
  baseMaterialCapacity: 120,
  storageCapacityBonusByLevel: [60, 140, 240] as const,
  campfireBuildRadiusByLevel: [6, 9, 12] as const,
  workshopDamageBonusByLevel: [4, 9, 15] as const,
  farmHarvestEverySeconds: 2,
  farmHarvestByLevel: [
    { wood: 2, stone: 1, scrap: 0, essence: 0, bossCore: 0 },
    { wood: 4, stone: 2, scrap: 1, essence: 0, bossCore: 0 },
    { wood: 6, stone: 3, scrap: 2, essence: 1, bossCore: 0 },
  ] as const satisfies readonly ReadonlyResourceBag[],
  baseCampfireHealingPerSecond: 2,
  healerHealingBonusByLevel: [1, 3, 6] as const,
  healingHutRadiusByLevel: [3, 4, 5] as const,
  buildingRefundRate: 0.5,
  baseAttackDamage: 12,
  baseAttackIntervalSeconds: 0.5,
  basicProjectileTravelSeconds: 0.3,
  floorDropOffsetDistance: 0.42,
  floorDropCollectDistance: 0.8,
  baseAttackRange: 3.2,
  baseMoveSpeed: 3,
  playerHitRecoverySeconds: 0.5,
  playerHitRecoverySpeedMultiplier: 2,
  playerHitRecoveryFlashIntervalSeconds: 0.1,
  tapToMoveArrivalDistance: 0.05,
  enemyAttackStandoff: 1.8,
  experienceThresholds: [30, 100, 250, 600, 1500] as const,
};

export const gameplayTuning = deepFreeze(authoredGameplayTuning);

const authoredEnemyDefinitions = {
  scout: {
    maxHp: 24,
    damage: 3,
    moveSpeed: 3.2,
    attackEverySeconds: 1.2,
    respawnSeconds: 12,
    drops: { wood: 5, stone: 1, scrap: 0, essence: 0, bossCore: 0 },
  },
  brute: {
    maxHp: 38,
    damage: 5,
    moveSpeed: 1.35,
    attackEverySeconds: 1.5,
    respawnSeconds: 14,
    drops: { wood: 1, stone: 5, scrap: 2, essence: 0, bossCore: 0 },
  },
  spitter: {
    maxHp: 28,
    damage: 4,
    moveSpeed: 1.75,
    attackEverySeconds: 1.1,
    respawnSeconds: 13,
    drops: { wood: 2, stone: 1, scrap: 4, essence: 0, bossCore: 0 },
  },
  elite: {
    maxHp: 56,
    damage: 7,
    moveSpeed: 1.5,
    attackEverySeconds: 1.4,
    respawnSeconds: 20,
    drops: { wood: 7, stone: 7, scrap: 6, essence: 2, bossCore: 0 },
  },
  boss: {
    maxHp: 72,
    damage: 9,
    moveSpeed: 1.25,
    attackEverySeconds: 1.3,
    respawnSeconds: null,
    drops: { wood: 0, stone: 0, scrap: 0, essence: 0, bossCore: 1 },
  },
} satisfies Record<EnemyKind, EnemyDefinition>;

export const enemyDefinitions = deepFreeze(authoredEnemyDefinitions);

const authoredBuildingDefinitions = {
  Campfire: {
    label: "Campfire",
    baseCost: { wood: 0, stone: 0, scrap: 0, essence: 0, bossCore: 0 },
    description: "Bootstraps a settlement and permits manual saves.",
    levelEffects: [
      "L1: 6m build radius and manual save point.",
      "L2: 9m build radius and manual save point.",
      "L3: 12m build radius and manual save point.",
    ],
  },
  Workshop: {
    label: "Workshop",
    baseCost: { wood: 18, stone: 8, scrap: 2, essence: 0, bossCore: 0 },
    description: "Improves stationary basic-attack damage.",
    levelEffects: [
      "L1: +4 basic attack damage.",
      "L2: +9 basic attack damage.",
      "L3: +15 basic attack damage.",
    ],
  },
  Farm: {
    label: "Farm",
    baseCost: { wood: 12, stone: 4, scrap: 0, essence: 0, bossCore: 0 },
    description: "Harvests material bundles while the Wanderer is stationary.",
    levelEffects: [
      "L1: every 2s, harvest 2 Wood and 1 Stone.",
      "L2: every 2s, harvest 4 Wood, 2 Stone, and 1 Metal / Scrap.",
      "L3: every 2s, harvest 6 Wood, 3 Stone, 2 Metal / Scrap, and 1 Essence.",
    ],
  },
  Storage: {
    label: "Storage",
    baseCost: { wood: 20, stone: 8, scrap: 3, essence: 0, bossCore: 0 },
    description:
      "Enforces a higher per-material capacity for common resources.",
    levelEffects: [
      "L1: 180 per Wood, Stone, Metal / Scrap, and Essence.",
      "L2: 260 per Wood, Stone, Metal / Scrap, and Essence.",
      "L3: 360 per Wood, Stone, Metal / Scrap, and Essence.",
    ],
  },
  Healer: {
    label: "Healing Hut",
    baseCost: { wood: 10, stone: 10, scrap: 4, essence: 1, bossCore: 0 },
    description:
      "Heals a stationary Wanderer inside its own compact healing aura.",
    levelEffects: [
      "L1: 3m aura, +1 health/s while stationary inside it.",
      "L2: 4m aura, +3 health/s while stationary inside it.",
      "L3: 5m aura, +6 health/s while stationary inside it.",
    ],
  },
} satisfies Record<BuildingKind, BuildingDefinition>;

export const buildingDefinitions = deepFreeze(authoredBuildingDefinitions);

type UpgradeDefinitionCatalogue = {
  readonly [Id in UpgradeId]: UpgradeDefinition & { readonly id: Id };
};

const authoredUpgradeDefinitionsById = {
  "sharpened-blade": {
    id: "sharpened-blade",
    label: "Sharpened Blade",
    description: "+7 basic attack damage.",
    effect: { kind: "attack-damage", amount: 7 },
  },
  "quick-hands": {
    id: "quick-hands",
    label: "Quick Hands",
    description: "Attack 25% faster (attack interval ×0.75).",
    effect: { kind: "attack-interval", multiplier: 0.75 },
  },
  "iron-skin": {
    id: "iron-skin",
    label: "Iron Skin",
    description: "+25 maximum health and heal 25 immediately.",
    effect: { kind: "maximum-health", amount: 25 },
  },
  "ember-aura": {
    id: "ember-aura",
    label: "Ember Aura",
    description: "+3 basic attack damage.",
    effect: { kind: "attack-damage", amount: 3 },
  },
  "long-reach": {
    id: "long-reach",
    label: "Long Reach",
    description: "35% more basic-attack range.",
    effect: { kind: "attack-range", multiplier: 1.35 },
  },
  "chain-strike": {
    id: "chain-strike",
    label: "Chain Strike",
    description:
      "Each basic hit also strikes one other nearby target for 50% damage.",
    effect: {
      kind: "chain-strike",
      targetCount: 1,
      damageMultiplier: 0.5,
    },
  },
  "invigorating-edge": {
    id: "invigorating-edge",
    label: "Invigorating Edge",
    description: "Restore 1 health for every basic hit that lands.",
    effect: { kind: "hit-heal", amount: 1 },
  },
  trailblazer: {
    id: "trailblazer",
    label: "Trailblazer",
    description: "15% faster movement.",
    effect: { kind: "move-speed", multiplier: 1.15 },
  },
  "fortified-heart": {
    id: "fortified-heart",
    label: "Fortified Heart",
    description: "+15 maximum health and heal 15 immediately.",
    effect: { kind: "maximum-health", amount: 15 },
  },
  "keen-focus": {
    id: "keen-focus",
    label: "Keen Focus",
    description: "15% faster basic attacks (attack interval ×0.85).",
    effect: { kind: "attack-interval", multiplier: 0.85 },
  },
} satisfies UpgradeDefinitionCatalogue;

export const upgradeDefinitionsById = deepFreeze(
  authoredUpgradeDefinitionsById,
);

export const upgradeDefinitions = deepFreeze(
  upgradeIds.map((id) => upgradeDefinitionsById[id]),
);

export const upgradeDefinitionFor = (id: UpgradeId): UpgradeDefinition =>
  upgradeDefinitionsById[id];

const authoredClassDefinitions = {
  knight: {
    id: "knight",
    label: "Knight",
    description: "Close-range sweeping slashes that strike a forward arc.",
    attackStyle: "slash",
    damageMultiplier: 1.2,
    attackIntervalSeconds: 0.45,
    attackRange: 2.4,
    secondaryDamageMultiplier: 0.5,
    areaRadius: 2.4,
    arcCosine: 0.5,
    // The weaponless crescent damages every valid enemy in its forward arc.
    // Infinity is an explicit authored "no cap" policy; finite class values
    // remain bounded for projectile and splash attacks.
    secondaryTargets: Number.POSITIVE_INFINITY,
    passiveStats: {
      strength: 6,
      dexterity: 0,
      agility: 0,
      luck: 0,
      vitality: 6,
      magic: 0,
      defense: 3,
      magicDefense: 0,
    },
  },
  wizard: {
    id: "wizard",
    label: "Wizard",
    description: "Ranged magic that splashes nearby enemies on impact.",
    attackStyle: "magic",
    damageMultiplier: 1.15,
    attackIntervalSeconds: 0.7,
    attackRange: 5,
    secondaryDamageMultiplier: 0.7,
    areaRadius: 1.5,
    arcCosine: 1,
    secondaryTargets: 8,
    passiveStats: {
      strength: 0,
      dexterity: 0,
      agility: 3,
      luck: 0,
      vitality: 0,
      magic: 6,
      defense: 0,
      magicDefense: 3,
    },
  },
  archer: {
    id: "archer",
    label: "Archer",
    description: "Long-range bow shots aimed at a single target.",
    attackStyle: "arrow",
    damageMultiplier: 1,
    attackIntervalSeconds: 0.55,
    attackRange: 5.8,
    secondaryDamageMultiplier: 0.5,
    areaRadius: 0,
    arcCosine: 1,
    secondaryTargets: 0,
    passiveStats: {
      strength: 0,
      dexterity: 6,
      agility: 6,
      luck: 3,
      vitality: 0,
      magic: 0,
      defense: 0,
      magicDefense: 0,
    },
  },
} satisfies Record<PlayerClass, ClassDefinition>;

export const classDefinitionsById = deepFreeze(authoredClassDefinitions);
export const classDefinitions = deepFreeze(
  playerClasses.map((id) => classDefinitionsById[id]),
);
export const classDefinitionFor = (id: PlayerClass): ClassDefinition =>
  classDefinitionsById[id];

type ClassSkillCatalogue = {
  readonly [Id in ClassSkillId]: ClassSkillDefinition & { readonly id: Id };
};

const authoredClassSkillsById = {
  "knight-iron-guard": {
    id: "knight-iron-guard",
    playerClass: "knight",
    tier: 1,
    label: "Iron Guard",
    description: "+20 maximum health and heal 20 immediately.",
    effect: { kind: "maximum-health", amount: 20 },
  },
  "knight-wide-slash": {
    id: "knight-wide-slash",
    playerClass: "knight",
    tier: 1,
    label: "Wide Slash",
    description: "+0.6m crescent reach.",
    effect: { kind: "area-radius", amount: 0.6 },
  },
  "knight-heavy-blade": {
    id: "knight-heavy-blade",
    playerClass: "knight",
    tier: 2,
    label: "Heavy Blade",
    description: "+6 slash damage.",
    effect: { kind: "attack-damage", amount: 6 },
  },
  "knight-rapid-cuts": {
    id: "knight-rapid-cuts",
    playerClass: "knight",
    tier: 2,
    label: "Rapid Cuts",
    description: "Slash 20% faster.",
    effect: { kind: "attack-interval", multiplier: 0.8 },
  },
  "knight-execution-arc": {
    id: "knight-execution-arc",
    playerClass: "knight",
    tier: 3,
    label: "Execution Arc",
    description: "+10 slash damage.",
    effect: { kind: "attack-damage", amount: 10 },
  },
  "knight-crescent-sweep": {
    id: "knight-crescent-sweep",
    playerClass: "knight",
    tier: 3,
    label: "Crescent Sweep",
    description: "Widen the crescent from 120° to 150°.",
    effect: { kind: "arc-cosine", amount: -0.25 },
  },
  "knight-bulwark": {
    id: "knight-bulwark",
    playerClass: "knight",
    tier: 4,
    label: "Bulwark",
    description: "+30 maximum health and heal 30 immediately.",
    effect: { kind: "maximum-health", amount: 30 },
  },
  "knight-whirlwind": {
    id: "knight-whirlwind",
    playerClass: "knight",
    tier: 4,
    label: "Whirlwind",
    description: "Slash 30% faster.",
    effect: { kind: "attack-interval", multiplier: 0.7 },
  },
  "wizard-flame-orb": {
    id: "wizard-flame-orb",
    playerClass: "wizard",
    tier: 1,
    label: "Flame Orb",
    description: "+5 magic damage.",
    effect: { kind: "attack-damage", amount: 5 },
  },
  "wizard-wide-blast": {
    id: "wizard-wide-blast",
    playerClass: "wizard",
    tier: 1,
    label: "Wide Blast",
    description: "+0.7m magic splash radius.",
    effect: { kind: "area-radius", amount: 0.7 },
  },
  "wizard-arcane-haste": {
    id: "wizard-arcane-haste",
    playerClass: "wizard",
    tier: 2,
    label: "Arcane Haste",
    description: "Cast 20% faster.",
    effect: { kind: "attack-interval", multiplier: 0.8 },
  },
  "wizard-mana-siphon": {
    id: "wizard-mana-siphon",
    playerClass: "wizard",
    tier: 2,
    label: "Mana Siphon",
    description: "Restore 1 health per magic hit.",
    effect: { kind: "hit-heal", amount: 1 },
  },
  "wizard-nova": {
    id: "wizard-nova",
    playerClass: "wizard",
    tier: 3,
    label: "Nova",
    description: "+1m magic splash radius.",
    effect: { kind: "area-radius", amount: 1 },
  },
  "wizard-aether-ward": {
    id: "wizard-aether-ward",
    playerClass: "wizard",
    tier: 3,
    label: "Aether Ward",
    description: "+20 maximum health and heal 20 immediately.",
    effect: { kind: "maximum-health", amount: 20 },
  },
  "wizard-meteor": {
    id: "wizard-meteor",
    playerClass: "wizard",
    tier: 4,
    label: "Meteor",
    description: "+14 magic damage.",
    effect: { kind: "attack-damage", amount: 14 },
  },
  "wizard-spellweave": {
    id: "wizard-spellweave",
    playerClass: "wizard",
    tier: 4,
    label: "Spellweave",
    description: "Cast 25% faster.",
    effect: { kind: "attack-interval", multiplier: 0.75 },
  },
  "archer-longbow": {
    id: "archer-longbow",
    playerClass: "archer",
    tier: 1,
    label: "Longbow",
    description: "35% more bow range.",
    effect: { kind: "attack-range", multiplier: 1.35 },
  },
  "archer-barbed-arrow": {
    id: "archer-barbed-arrow",
    playerClass: "archer",
    tier: 1,
    label: "Barbed Arrow",
    description: "+6 bow damage.",
    effect: { kind: "attack-damage", amount: 6 },
  },
  "archer-quickdraw": {
    id: "archer-quickdraw",
    playerClass: "archer",
    tier: 2,
    label: "Quickdraw",
    description: "Fire 20% faster.",
    effect: { kind: "attack-interval", multiplier: 0.8 },
  },
  "archer-volley": {
    id: "archer-volley",
    playerClass: "archer",
    tier: 2,
    label: "Volley",
    description: "Each arrow also hits one nearby target for half damage.",
    effect: { kind: "secondary-targets", amount: 1 },
  },
  "archer-piercing-arrow": {
    id: "archer-piercing-arrow",
    playerClass: "archer",
    tier: 3,
    label: "Piercing Arrow",
    description:
      "Each arrow hits one additional nearby target for half damage.",
    effect: { kind: "secondary-targets", amount: 1 },
  },
  "archer-trailstep": {
    id: "archer-trailstep",
    playerClass: "archer",
    tier: 3,
    label: "Trailstep",
    description: "Move 15% faster.",
    effect: { kind: "move-speed", multiplier: 1.15 },
  },
  "archer-eagle-eye": {
    id: "archer-eagle-eye",
    playerClass: "archer",
    tier: 4,
    label: "Eagle Eye",
    description: "30% more bow range.",
    effect: { kind: "attack-range", multiplier: 1.3 },
  },
  "archer-multishot": {
    id: "archer-multishot",
    playerClass: "archer",
    tier: 4,
    label: "Multishot",
    description: "Each arrow also hits two nearby targets for half damage.",
    effect: { kind: "secondary-targets", amount: 2 },
  },
} satisfies ClassSkillCatalogue;

export const classSkillsById = deepFreeze(authoredClassSkillsById);
export const classSkillDefinitions = deepFreeze(
  classSkillIds.map((id) => classSkillsById[id]),
);
export const classSkillDefinitionFor = (
  id: ClassSkillId,
): ClassSkillDefinition => classSkillsById[id];
