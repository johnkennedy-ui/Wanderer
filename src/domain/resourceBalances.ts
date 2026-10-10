import { resourceKinds } from "./types";
import type { ResourceBag, ResourceKind, ReadonlyResourceBag } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The active resource domain: exactly six non-negative safe-integer balances. */
export const isSafeResourceBag = (
  value: unknown,
): value is ReadonlyResourceBag => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === resourceKinds.length &&
    keys.every((key) => resourceKinds.includes(key as ResourceKind)) &&
    resourceKinds.every((kind) => {
      const amount = value[kind];
      return (
        typeof amount === "number" &&
        Number.isSafeInteger(amount) &&
        amount >= 0
      );
    })
  );
};

/**
 * Adds complete resource bags without a gameplay/storage cap. A null result means an
 * input is outside the current balance domain or any one addition would exceed
 * JavaScript's exact safe-integer range; no resource is partially applied.
 */
export const tryAddResourceBags = (
  current: ReadonlyResourceBag,
  delta: Partial<ReadonlyResourceBag>,
): ResourceBag | null => {
  if (!isSafeResourceBag(current) || !isRecord(delta)) return null;
  const keys = Object.keys(delta);
  if (
    !keys.every((key) => resourceKinds.includes(key as ResourceKind)) ||
    !keys.every((key) => {
      const amount = delta[key as ResourceKind];
      return (
        typeof amount === "number" &&
        Number.isSafeInteger(amount) &&
        amount >= 0
      );
    })
  )
    return null;

  const next: ResourceBag = { ...current };
  for (const kind of resourceKinds) {
    const amount = Object.prototype.hasOwnProperty.call(delta, kind)
      ? (delta[kind] ?? 0)
      : 0;
    if (amount > Number.MAX_SAFE_INTEGER - current[kind]) return null;
    next[kind] = current[kind] + amount;
  }
  return next;
};
