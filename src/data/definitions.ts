import type {
  BuildingKind,
  EnemyKind,
  ResourceBag,
  UpgradeId,
} from "../domain/types";

export interface EnemyDefinition {
  readonly maxHp: number;
  readonly damage: number;
  readonly attackEverySeconds: number;
  readonly respawnSeconds: number | null;
  readonly drops: ResourceBag;
}

export interface BuildingDefinition {
  readonly label: string;
  readonly baseCost: ResourceBag;
  readonly description: string;
}

export interface UpgradeDefinition {
  readonly id: UpgradeId;
  readonly label: string;
  readonly description: string;
}

export const enemyDefinitions: Readonly<Record<EnemyKind, EnemyDefinition>> =
  Object.freeze({
    scout: {
      maxHp: 24,
      damage: 3,
      attackEverySeconds: 1.2,
      respawnSeconds: 12,
      drops: { wood: 4, ore: 0, food: 0, bossCore: 0 },
    },
    brute: {
      maxHp: 38,
      damage: 5,
      attackEverySeconds: 1.5,
      respawnSeconds: 14,
      drops: { wood: 3, ore: 3, food: 0, bossCore: 0 },
    },
    spitter: {
      maxHp: 28,
      damage: 4,
      attackEverySeconds: 1.1,
      respawnSeconds: 13,
      drops: { wood: 1, ore: 2, food: 2, bossCore: 0 },
    },
    elite: {
      maxHp: 56,
      damage: 7,
      attackEverySeconds: 1.4,
      respawnSeconds: 20,
      drops: { wood: 6, ore: 6, food: 4, bossCore: 0 },
    },
    boss: {
      maxHp: 72,
      damage: 9,
      attackEverySeconds: 1.3,
      respawnSeconds: null,
      drops: { wood: 0, ore: 0, food: 0, bossCore: 1 },
    },
  });

export const buildingDefinitions: Readonly<
  Record<BuildingKind, BuildingDefinition>
> = Object.freeze({
  Campfire: {
    label: "Campfire",
    baseCost: { wood: 0, ore: 0, food: 0, bossCore: 0 },
    description: "Bootstraps a settlement and permits manual saves.",
  },
  Workshop: {
    label: "Workshop",
    baseCost: { wood: 18, ore: 8, food: 0, bossCore: 0 },
    description: "+4 basic attack damage per level.",
  },
  Farm: {
    label: "Farm",
    baseCost: { wood: 12, ore: 0, food: 10, bossCore: 0 },
    description: "Restores health while stationary.",
  },
  Storage: {
    label: "Storage",
    baseCost: { wood: 20, ore: 8, food: 0, bossCore: 0 },
    description: "Raises the visible settlement stock capacity.",
  },
  Healer: {
    label: "Healer",
    baseCost: { wood: 10, ore: 12, food: 14, bossCore: 0 },
    description: "Strengthens hearth healing around campfires.",
  },
});

export const upgradeDefinitions: readonly UpgradeDefinition[] = Object.freeze([
  {
    id: "sharpened-blade",
    label: "Sharpened Blade",
    description: "+7 basic attack damage.",
  },
  {
    id: "quick-hands",
    label: "Quick Hands",
    description: "Attack 25% faster.",
  },
  {
    id: "iron-skin",
    label: "Iron Skin",
    description: "+25 maximum health and heal 25.",
  },
  {
    id: "ember-aura",
    label: "Ember Aura",
    description: "Adds 3 damage to nearby auto-attacks.",
  },
]);
