import type {
  BuildingKind,
  EnemyKind,
  ResourceBag,
  ResourceKind,
  UpgradeId,
} from "../domain/types";

export interface ResourceDefinition {
  readonly label: string;
  readonly storageLimited: boolean;
  readonly description: string;
}

export interface EnemyDefinition {
  readonly maxHp: number;
  readonly damage: number;
  readonly moveSpeed: number;
  readonly attackEverySeconds: number;
  readonly respawnSeconds: number | null;
  readonly drops: ResourceBag;
}

export interface BuildingDefinition {
  readonly label: string;
  readonly baseCost: ResourceBag;
  readonly description: string;
  readonly levelEffects: readonly [string, string, string];
}

export interface UpgradeModifier {
  readonly attackDamageAdd?: number;
  readonly attackIntervalMultiplier?: number;
  readonly attackRangeMultiplier?: number;
  readonly moveSpeedMultiplier?: number;
  readonly maxHealthAdd?: number;
  readonly chainTargets?: number;
  readonly chainDamageMultiplier?: number;
  readonly hitHeal?: number;
}

export interface UpgradeDefinition {
  readonly id: UpgradeId;
  readonly label: string;
  readonly description: string;
  readonly modifier: UpgradeModifier;
}

export const resourceDefinitions: Readonly<
  Record<ResourceKind, ResourceDefinition>
> = Object.freeze({
  wood: {
    label: "Wood",
    storageLimited: true,
    description: "Common construction timber.",
  },
  stone: {
    label: "Stone",
    storageLimited: true,
    description: "Common settlement masonry.",
  },
  scrap: {
    label: "Metal / Scrap",
    storageLimited: true,
    description: "Recovered metal for durable work.",
  },
  essence: {
    label: "Essence",
    storageLimited: true,
    description: "Elite energy used for advanced upgrades.",
  },
  bossCore: {
    label: "Boss Core",
    storageLimited: false,
    description:
      "Boss progression currency; saved but exempt from Storage capacity.",
  },
});

export const gameplayTuning = Object.freeze({
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
  ] as const satisfies readonly ResourceBag[],
  baseCampfireHealingPerSecond: 2,
  healerHealingBonusByLevel: [1, 3, 6] as const,
  buildingRefundRate: 0.5,
  baseAttackDamage: 12,
  baseAttackIntervalSeconds: 0.5,
  basicProjectileTravelSeconds: 0.3,
  baseAttackRange: 3.2,
  baseMoveSpeed: 3,
  enemyAttackStandoff: 1.8,
});

export const enemyDefinitions: Readonly<Record<EnemyKind, EnemyDefinition>> =
  Object.freeze({
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
  });

export const buildingDefinitions: Readonly<
  Record<BuildingKind, BuildingDefinition>
> = Object.freeze({
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
});

export const upgradeDefinitions: readonly UpgradeDefinition[] = Object.freeze([
  {
    id: "sharpened-blade",
    label: "Sharpened Blade",
    description: "+7 basic attack damage.",
    modifier: { attackDamageAdd: 7 },
  },
  {
    id: "quick-hands",
    label: "Quick Hands",
    description: "Attack 25% faster (attack interval ×0.75).",
    modifier: { attackIntervalMultiplier: 0.75 },
  },
  {
    id: "iron-skin",
    label: "Iron Skin",
    description: "+25 maximum health and heal 25 immediately.",
    modifier: { maxHealthAdd: 25 },
  },
  {
    id: "ember-aura",
    label: "Ember Aura",
    description: "+3 basic attack damage.",
    modifier: { attackDamageAdd: 3 },
  },
  {
    id: "long-reach",
    label: "Long Reach",
    description: "35% more basic-attack range.",
    modifier: { attackRangeMultiplier: 1.35 },
  },
  {
    id: "chain-strike",
    label: "Chain Strike",
    description:
      "Each basic hit also strikes one other nearby target for 50% damage.",
    modifier: { chainTargets: 1, chainDamageMultiplier: 0.5 },
  },
  {
    id: "invigorating-edge",
    label: "Invigorating Edge",
    description: "Restore 1 health for every basic hit that lands.",
    modifier: { hitHeal: 1 },
  },
  {
    id: "trailblazer",
    label: "Trailblazer",
    description: "15% faster movement.",
    modifier: { moveSpeedMultiplier: 1.15 },
  },
  {
    id: "fortified-heart",
    label: "Fortified Heart",
    description: "+15 maximum health and heal 15 immediately.",
    modifier: { maxHealthAdd: 15 },
  },
  {
    id: "keen-focus",
    label: "Keen Focus",
    description: "15% faster basic attacks (attack interval ×0.85).",
    modifier: { attackIntervalMultiplier: 0.85 },
  },
]);

export const upgradeDefinitionFor = (
  id: UpgradeId,
): UpgradeDefinition | undefined =>
  upgradeDefinitions.find((upgrade) => upgrade.id === id);
