import type {
  BuildingState,
  ResourceBag,
  SaveDocument,
  UpgradeId,
  Vector2,
  WorldIdentity,
} from "./types";

const validVector = (value: unknown): value is Vector2 =>
  typeof value === "object" &&
  value !== null &&
  Number.isFinite((value as Vector2).x) &&
  Number.isFinite((value as Vector2).y);

const validResources = (value: unknown): value is ResourceBag => {
  if (typeof value !== "object" || value === null) return false;
  const resource = value as ResourceBag;
  return ["wood", "ore", "food", "bossCore"].every(
    (key) =>
      Number.isInteger(resource[key as keyof ResourceBag]) &&
      resource[key as keyof ResourceBag] >= 0,
  );
};

const validBuilding = (value: unknown): value is BuildingState => {
  if (typeof value !== "object" || value === null) return false;
  const building = value as BuildingState;
  return (
    typeof building.id === "string" &&
    ["Campfire", "Workshop", "Farm", "Storage", "Healer"].includes(
      building.kind,
    ) &&
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
  value.every((id) =>
    ["sharpened-blade", "quick-hands", "iron-skin", "ember-aura"].includes(id),
  ) &&
  new Set(value).size === value.length;

export const isSaveDocument = (value: unknown): value is SaveDocument => {
  if (typeof value !== "object" || value === null) return false;
  const save = value as SaveDocument;
  return (
    save.schemaVersion === 1 &&
    validWorld(save.world) &&
    typeof save.player === "object" &&
    save.player !== null &&
    validVector(save.player.position) &&
    Number.isFinite(save.player.hp) &&
    Number.isFinite(save.player.maxHp) &&
    save.player.hp >= 0 &&
    save.player.maxHp > 0 &&
    validResources(save.resources) &&
    Array.isArray(save.buildings) &&
    save.buildings.every(validBuilding) &&
    Array.isArray(save.defeatedBossIds) &&
    save.defeatedBossIds.every((id) => typeof id === "string") &&
    validUpgrades(save.upgrades) &&
    Number.isInteger(save.nextBuildingSerial) &&
    save.nextBuildingSerial >= 1 &&
    Number.isFinite(save.committedAt) &&
    typeof save.savePointId === "string"
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
