import { describe, expect, it } from "vitest";

import {
  buildingDefinitions,
  enemyDefinitions,
  gameplayTuning,
  resourceDefinitions,
  upgradeDefinitions,
} from "../../data/definitions";
import { deepFreeze } from "../../data/deepFreeze";

const expectDeepFrozen = (
  value: unknown,
  visited = new Set<object>(),
): void => {
  if (value === null || typeof value !== "object" || visited.has(value)) return;
  visited.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeepFrozen(nested, visited);
};

const verifyNestedDefinitionTypesAreReadonly = (): void => {
  // @ts-expect-error Authored enemy drops are not mutable runtime resources.
  enemyDefinitions.scout.drops.wood = 999;
  // @ts-expect-error Authored building costs are not mutable runtime resources.
  buildingDefinitions.Workshop.baseCost.wood = 999;
};
void verifyNestedDefinitionTypesAreReadonly;

describe("authored definitions", () => {
  it("deep-freezes every authored catalogue and its nested records", () => {
    for (const catalogue of [
      resourceDefinitions,
      gameplayTuning,
      enemyDefinitions,
      buildingDefinitions,
      upgradeDefinitions,
    ])
      expectDeepFrozen(catalogue);

    expect(() => {
      (enemyDefinitions.scout.drops as { wood: number }).wood = 999;
    }).toThrow(TypeError);
  });

  it("handles cyclic authored structures without retaining a mutable reference", () => {
    const circular: { readonly nested: { label: string }; self?: unknown } = {
      nested: { label: "catalogue" },
    };
    circular.self = circular;

    const frozen = deepFreeze(circular);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.nested)).toBe(true);
    expect(frozen.self).toBe(frozen);
  });
});
