/**
 * Historical schema-2 wire contract.
 *
 * This module deliberately owns the literals released with schema version 2.
 * It must not import current runtime aggregates or active content catalogues:
 * future content changes must not silently redefine what an old save means.
 */
export const SAVE_V2_SCHEMA_VERSION = 2 as const;

export const saveV2ResourceKeys = Object.freeze([
  "wood",
  "stone",
  "scrap",
  "essence",
  "bossCore",
] as const);

export const saveV2BuildingKinds = Object.freeze([
  "Campfire",
  "Workshop",
  "Farm",
  "Storage",
  "Healer",
] as const);

export const saveV2UpgradeIds = Object.freeze([
  "sharpened-blade",
  "quick-hands",
  "iron-skin",
  "ember-aura",
  "long-reach",
  "chain-strike",
  "invigorating-edge",
  "trailblazer",
  "fortified-heart",
  "keen-focus",
] as const);

export type SaveV2ResourceKey = (typeof saveV2ResourceKeys)[number];
export type SaveV2BuildingKind = (typeof saveV2BuildingKinds)[number];
export type SaveV2UpgradeId = (typeof saveV2UpgradeIds)[number];

export interface SaveV2Vector {
  readonly x: number;
  readonly y: number;
}

export interface SaveV2World {
  readonly seed: string;
  readonly generatorVersion: string;
}

export interface SaveV2Player {
  readonly position: SaveV2Vector;
  readonly hp: number;
  readonly maxHp: number;
}

export type SaveV2ResourceBag = Readonly<Record<SaveV2ResourceKey, number>>;

export interface SaveV2Building {
  readonly id: string;
  readonly kind: SaveV2BuildingKind;
  readonly position: SaveV2Vector;
  readonly level: 1 | 2 | 3;
}

export interface SaveV2Document {
  readonly schemaVersion: typeof SAVE_V2_SCHEMA_VERSION;
  readonly world: SaveV2World;
  readonly player: SaveV2Player;
  readonly resources: SaveV2ResourceBag;
  readonly buildings: readonly SaveV2Building[];
  readonly defeatedBossIds: readonly string[];
  readonly upgrades: readonly SaveV2UpgradeId[];
  readonly nextBuildingSerial: number;
  readonly committedAt: number;
  readonly savePointId: string;
  readonly savePointPosition: SaveV2Vector;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasExactKeys = (value: Record<string, unknown>): boolean => {
  const keys = Object.keys(value).sort();
  const expected = [...saveV2ResourceKeys].sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  );
};

const isFiniteVector = (value: unknown): value is SaveV2Vector =>
  isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);

const isResourceBag = (value: unknown): value is SaveV2ResourceBag =>
  isRecord(value) &&
  hasExactKeys(value) &&
  saveV2ResourceKeys.every(
    (key) => Number.isInteger(value[key]) && (value[key] as number) >= 0,
  );

const isBuilding = (value: unknown): value is SaveV2Building =>
  isRecord(value) &&
  typeof value.id === "string" &&
  value.id.length > 0 &&
  typeof value.kind === "string" &&
  saveV2BuildingKinds.includes(value.kind as SaveV2BuildingKind) &&
  (value.level === 1 || value.level === 2 || value.level === 3) &&
  isFiniteVector(value.position);

const isWorld = (value: unknown): value is SaveV2World =>
  isRecord(value) &&
  typeof value.seed === "string" &&
  typeof value.generatorVersion === "string";

const isPlayer = (value: unknown): value is SaveV2Player =>
  isRecord(value) &&
  isFiniteVector(value.position) &&
  Number.isFinite(value.hp) &&
  Number.isFinite(value.maxHp) &&
  (value.hp as number) >= 0 &&
  (value.maxHp as number) > 0 &&
  (value.hp as number) <= (value.maxHp as number);

const isUniqueStrings = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.every((item) => typeof item === "string") &&
  new Set(value).size === value.length;

const isKnownUpgradeList = (
  value: unknown,
): value is readonly SaveV2UpgradeId[] =>
  Array.isArray(value) &&
  value.every(
    (id) =>
      typeof id === "string" &&
      saveV2UpgradeIds.includes(id as SaveV2UpgradeId),
  ) &&
  new Set(value).size === value.length;

/** Validates the exact historical V2 shape while allowing released extra fields. */
export const isSaveV2Document = (value: unknown): value is SaveV2Document => {
  if (!isRecord(value) || value.schemaVersion !== SAVE_V2_SCHEMA_VERSION)
    return false;
  const buildings = Array.isArray(value.buildings) ? value.buildings : [];
  const buildingIds = buildings.map((building) =>
    isRecord(building) ? building.id : undefined,
  );
  return (
    isWorld(value.world) &&
    isPlayer(value.player) &&
    isResourceBag(value.resources) &&
    Array.isArray(value.buildings) &&
    value.buildings.every(isBuilding) &&
    new Set(buildingIds).size === buildingIds.length &&
    isUniqueStrings(value.defeatedBossIds) &&
    isKnownUpgradeList(value.upgrades) &&
    Number.isInteger(value.nextBuildingSerial) &&
    (value.nextBuildingSerial as number) >= 1 &&
    Number.isFinite(value.committedAt) &&
    typeof value.savePointId === "string" &&
    value.savePointId.length > 0 &&
    isFiniteVector(value.savePointPosition)
  );
};
