import { describe, expect, it } from "vitest";

import {
  buildingDefinitions,
  enemyDefinitions,
  gameplayTuning,
  resourceDefinitions,
  upgradeDefinitionFor,
  upgradeDefinitions,
  upgradeDefinitionsById,
} from "../../data/definitions";
import { deepFreeze } from "../../data/deepFreeze";
import { saveV2BuildingKinds } from "../../domain/persistence/saveV2";
import {
  buildingKinds,
  enemyKinds,
  resourceKinds,
  upgradeIds,
} from "../../domain/types";
import {
  buildingColors,
  enemyPresentation,
} from "../../platform/render/threeRenderer";

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
  const chainStrike = upgradeDefinitionFor("chain-strike").effect;
  if (chainStrike.kind === "chain-strike") {
    // @ts-expect-error Authored upgrade effect values are immutable.
    chainStrike.targetCount = 999;
  }
};
void verifyNestedDefinitionTypesAreReadonly;

describe("authored definitions", () => {
  it("deep-freezes every authored catalogue and its nested records", () => {
    for (const catalogue of [
      resourceDefinitions,
      gameplayTuning,
      enemyDefinitions,
      buildingDefinitions,
      upgradeDefinitionsById,
      upgradeDefinitions,
      resourceKinds,
      buildingKinds,
      enemyKinds,
      upgradeIds,
      buildingColors,
      enemyPresentation,
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

  it("covers each active identifier exactly once and resolves every upgrade", () => {
    expect(Object.keys(resourceDefinitions).sort()).toEqual(
      [...resourceKinds].sort(),
    );
    expect(Object.keys(buildingDefinitions).sort()).toEqual(
      [...buildingKinds].sort(),
    );
    expect(Object.keys(enemyDefinitions).sort()).toEqual(
      [...enemyKinds].sort(),
    );
    expect(upgradeDefinitions.map((upgrade) => upgrade.id)).toEqual(upgradeIds);
    expect(Object.keys(upgradeDefinitionsById).sort()).toEqual(
      [...upgradeIds].sort(),
    );

    for (const id of upgradeIds) expect(upgradeDefinitionFor(id).id).toBe(id);
  });

  it("keeps each canonical active identifier unique", () => {
    for (const ids of [resourceKinds, buildingKinds, enemyKinds, upgradeIds])
      expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every active building and enemy in renderer presentation records", () => {
    expect(Object.keys(buildingColors).sort()).toEqual(
      [...buildingKinds].sort(),
    );
    expect(Object.keys(enemyPresentation).sort()).toEqual(
      [...enemyKinds].sort(),
    );
  });

  it("keeps the historical Healer save ID while presenting a level-scaling Healing Hut", () => {
    expect(saveV2BuildingKinds).toContain("Healer");
    expect(buildingDefinitions.Healer.label).toBe("Healing Hut");
    expect(gameplayTuning.healingHutRadiusByLevel).toEqual([3, 4, 5]);
    expect(buildingDefinitions.Healer.levelEffects).toEqual([
      "L1: 3m aura, +1 health/s while stationary inside it.",
      "L2: 4m aura, +3 health/s while stationary inside it.",
      "L3: 5m aura, +6 health/s while stationary inside it.",
    ]);
  });

  it("represents every upgrade as one explicit qualitative effect", () => {
    expect(
      Object.fromEntries(
        upgradeDefinitions.map((upgrade) => [upgrade.id, upgrade.effect]),
      ),
    ).toEqual({
      "sharpened-blade": { kind: "attack-damage", amount: 7 },
      "quick-hands": { kind: "attack-interval", multiplier: 0.75 },
      "iron-skin": { kind: "maximum-health", amount: 25 },
      "ember-aura": { kind: "attack-damage", amount: 3 },
      "long-reach": { kind: "attack-range", multiplier: 1.35 },
      "chain-strike": {
        kind: "chain-strike",
        targetCount: 1,
        damageMultiplier: 0.5,
      },
      "invigorating-edge": { kind: "hit-heal", amount: 1 },
      trailblazer: { kind: "move-speed", multiplier: 1.15 },
      "fortified-heart": { kind: "maximum-health", amount: 15 },
      "keen-focus": { kind: "attack-interval", multiplier: 0.85 },
    });
  });
});
