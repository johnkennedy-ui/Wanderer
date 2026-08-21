import { resourceKinds, upgradeIds } from "./types";
import type {
  BuildingState,
  ResourceBag,
  SaveDocument,
  UpgradeId,
  Vector2,
  WorldIdentity,
} from "./types";

const buildingKinds = [
  "Campfire",
  "Workshop",
  "Farm",
  "Storage",
  "Healer",
] as const;

const hasExactKeys = (value: object, expected: readonly string[]): boolean => {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index])
  );
};

const validVector = (value: unknown): value is Vector2 =>
  typeof value === "object" &&
  value !== null &&
  Number.isFinite((value as Vector2).x) &&
  Number.isFinite((value as Vector2).y);

const validResources = (value: unknown): value is ResourceBag => {
  if (typeof value !== "object" || value === null) return false;
  const resource = value as ResourceBag;
  return (
    hasExactKeys(resource, resourceKinds) &&
    resourceKinds.every(
      (kind) => Number.isInteger(resource[kind]) && resource[kind] >= 0,
    )
  );
};

const validBuilding = (value: unknown): value is BuildingState => {
  if (typeof value !== "object" || value === null) return false;
  const building = value as BuildingState;
  return (
    typeof building.id === "string" &&
    building.id.length > 0 &&
    buildingKinds.includes(building.kind) &&
    [1, 2, 3].includes(building.level) &&
    validVector(building.position)
  );
};

const validWorld = (value: unknown): value is WorldIdentity =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as WorldIdentity).seed === "string" &&
  typeof (value as WorldIdentity).generatorVersion === "string";

const validUpgrades = (value: unknown): value is readonly UpgradeId[] =>
  Array.isArray(value) &&
  value.every((id) => upgradeIds.includes(id as UpgradeId)) &&
  new Set(value).size === value.length;

export const isSaveDocument = (value: unknown): value is SaveDocument => {
  if (typeof value !== "object" || value === null) return false;
  const save = value as SaveDocument;
  const buildingIds = Array.isArray(save.buildings)
    ? save.buildings.map((building) => building.id)
    : [];
  return (
    save.schemaVersion === 2 &&
    validWorld(save.world) &&
    typeof save.player === "object" &&
    save.player !== null &&
    validVector(save.player.position) &&
    Number.isFinite(save.player.hp) &&
    Number.isFinite(save.player.maxHp) &&
    save.player.hp >= 0 &&
    save.player.maxHp > 0 &&
    save.player.hp <= save.player.maxHp &&
    validResources(save.resources) &&
    Array.isArray(save.buildings) &&
    save.buildings.every(validBuilding) &&
    new Set(buildingIds).size === buildingIds.length &&
    Array.isArray(save.defeatedBossIds) &&
    save.defeatedBossIds.every((id) => typeof id === "string") &&
    new Set(save.defeatedBossIds).size === save.defeatedBossIds.length &&
    validUpgrades(save.upgrades) &&
    Number.isInteger(save.nextBuildingSerial) &&
    save.nextBuildingSerial >= 1 &&
    Number.isFinite(save.committedAt) &&
    typeof save.savePointId === "string" &&
    save.savePointId.length > 0 &&
    validVector(save.savePointPosition)
  );
};

export const parseSaveDocument = (
  serialized: string | null,
): SaveDocument | null => {
  if (serialized === null) return null;
  try {
    const candidate: unknown = JSON.parse(serialized);
    return isSaveDocument(candidate) ? candidate : null;
  } catch {
    return null;
  }
};
