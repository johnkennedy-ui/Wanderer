import { upgradeIds } from "../domain/types";
import type {
  BuildingKind,
  EnemyKind,
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
    label: "Healer",
    baseCost: { wood: 10, stone: 10, scrap: 4, essence: 1, bossCore: 0 },
    description: "Strengthens stationary healing near a campfire.",
    levelEffects: [
      "L1: +1 health/s near a campfire.",
      "L2: +3 health/s near a campfire.",
      "L3: +6 health/s near a campfire.",
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
