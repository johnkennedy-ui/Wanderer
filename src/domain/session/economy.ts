import { gameplayTuning, resourceDefinitions } from "../../data/definitions";
import { commonResourceKinds, emptyResources, resourceKinds } from "../types";
import type { BuildingState, ReadonlyResourceBag, ResourceBag } from "../types";

/** Returns a fresh resource bag with every amount multiplied by a level. */
export const resourcesForLevel = (
  resources: ReadonlyResourceBag,
  level: number,
): ResourceBag => {
  const scaled = emptyResources();
  for (const kind of resourceKinds) scaled[kind] = resources[kind] * level;
  return scaled;
};

/** Returns a fresh bag containing the per-resource sum. */
export const addResourceBags = (
  left: ReadonlyResourceBag,
  right: ReadonlyResourceBag,
): ResourceBag => {
  const total = emptyResources();
  for (const kind of resourceKinds) total[kind] = left[kind] + right[kind];
  return total;
};

/** Returns a fresh bag containing the per-resource difference. */
export const subtractResourceBags = (
  left: ReadonlyResourceBag,
  right: ReadonlyResourceBag,
): ResourceBag => {
  const total = emptyResources();
  for (const kind of resourceKinds) total[kind] = left[kind] - right[kind];
  return total;
};

/** Returns a fresh bag with each resource scaled down using current floor rules. */
export const scaleResourceBag = (
  resources: ReadonlyResourceBag,
  multiplier: number,
): ResourceBag => {
  const scaled = emptyResources();
  for (const kind of resourceKinds)
    scaled[kind] = Math.floor(resources[kind] * multiplier);
  return scaled;
};

/** True only when every named resource can cover its corresponding cost. */
export const canAffordResources = (
  have: ReadonlyResourceBag,
  cost: ReadonlyResourceBag,
): boolean => resourceKinds.every((kind) => have[kind] >= cost[kind]);

/** Calculates the shared common-material capacity supplied by Storage buildings. */
export const materialCapacityFor = (
  buildings: readonly BuildingState[],
): number =>
  gameplayTuning.baseMaterialCapacity +
  buildings
    .filter((building) => building.kind === "Storage")
    .reduce(
      (total, building) =>
        total + gameplayTuning.storageCapacityBonusByLevel[building.level - 1],
      0,
    );

/** Returns a fresh bag with common materials capped and Boss Core non-negative. */
export const clampResourcesToCapacity = (
  resources: ReadonlyResourceBag,
  capacity: number,
): ResourceBag => {
  const clamped = { ...resources };
  for (const kind of commonResourceKinds)
    if (resourceDefinitions[kind].storageLimited)
      clamped[kind] = Math.min(capacity, Math.max(0, resources[kind]));
  clamped.bossCore = Math.max(0, resources.bossCore);
  return clamped;
};

/** Adds an incoming bag before applying the current capacity policy. */
export const collectResourcesWithinCapacity = (
  current: ReadonlyResourceBag,
  delta: ReadonlyResourceBag,
  capacity: number,
): ResourceBag =>
  clampResourcesToCapacity(addResourceBags(current, delta), capacity);
