import { emptyResources, resourceKinds } from "../types";
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

/**
 * Legacy compatibility helper retained for an older progression-description
 * consumer. Runtime collection no longer reads this value, so Storage has no
 * active resource effect.
 */
export const materialCapacityFor = (
  _buildings: readonly BuildingState[],
): number => Number.POSITIVE_INFINITY;

/** Returns a fresh non-negative resource bag without applying a cap. */
export const clampResourcesToCapacity = (
  resources: ReadonlyResourceBag,
): ResourceBag => {
  const clamped = emptyResources();
  for (const kind of resourceKinds)
    clamped[kind] = Math.max(0, resources[kind]);
  return clamped;
};

/** Adds an incoming bag without applying a Storage-derived cap. */
export const collectResourcesWithinCapacity = (
  current: ReadonlyResourceBag,
  delta: ReadonlyResourceBag,
): ResourceBag => clampResourcesToCapacity(addResourceBags(current, delta));
