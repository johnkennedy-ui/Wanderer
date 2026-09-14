import { describe, expect, it } from "vitest";
import {
  addResourceBags,
  canAffordResources,
  clampResourcesToCapacity,
  collectResourcesWithinCapacity,
  materialCapacityFor,
  resourcesForLevel,
  scaleResourceBag,
  subtractResourceBags,
} from "../../domain/session/economy";
import { resourceKinds } from "../../domain/types";
import type {
  BuildingState,
  ReadonlyResourceBag,
  ResourceBag,
} from "../../domain/types";

const resources = (values: Partial<ResourceBag> = {}): ResourceBag => ({
  wood: 0,
  stone: 0,
  scrap: 0,
  essence: 0,
  bossCore: 0,
  ...values,
});

const storage = (level: 1 | 2 | 3): BuildingState => ({
  id: `storage:${level}`,
  kind: "Storage",
  position: { x: level, y: 0 },
  level,
});

describe("session economy policy", () => {
  it("returns fresh bags without mutating caller-owned resource or building inputs", () => {
    const left = Object.freeze(
      resources({ wood: 5, stone: 4, scrap: 3, essence: 2, bossCore: 1 }),
    );
    const right = Object.freeze(
      resources({ wood: 1, stone: 2, scrap: 3, essence: 4, bossCore: 5 }),
    );
    const buildings = Object.freeze([storage(2)]);
    const leftBefore = { ...left };
    const rightBefore = { ...right };
    const buildingsBefore = buildings.map((building) => ({
      ...building,
      position: { ...building.position },
    }));

    const outputs = [
      resourcesForLevel(left, 3),
      addResourceBags(left, right),
      subtractResourceBags(left, right),
      scaleResourceBag(left, 0.5),
      clampResourcesToCapacity(left),
      collectResourcesWithinCapacity(left, right),
    ];

    for (const output of outputs) {
      expect(output).not.toBe(left);
      expect(output).not.toBe(right);
    }
    expect(canAffordResources(left, right)).toBe(false);
    expect(materialCapacityFor(buildings)).toBe(Number.POSITIVE_INFINITY);
    expect(left).toEqual(leftBefore);
    expect(right).toEqual(rightBefore);
    expect(buildings).toEqual(buildingsBefore);

    outputs[0]!.wood = 999;
    expect(left.wood).toBe(5);
  });

  it("multiplies level costs exactly for L1, L2, and L3", () => {
    const base = resources({
      wood: 3,
      stone: 2,
      scrap: 1,
      essence: 4,
      bossCore: 1,
    });

    expect(resourcesForLevel(base, 1)).toEqual(base);
    expect(resourcesForLevel(base, 2)).toEqual({
      wood: 6,
      stone: 4,
      scrap: 2,
      essence: 8,
      bossCore: 2,
    });
    expect(resourcesForLevel(base, 3)).toEqual({
      wood: 9,
      stone: 6,
      scrap: 3,
      essence: 12,
      bossCore: 3,
    });
  });

  it("adds and subtracts every resource exactly before a caller chooses to clamp", () => {
    const left = resources({
      wood: 8,
      stone: 7,
      scrap: 6,
      essence: 5,
      bossCore: 4,
    });
    const right = resources({
      wood: 3,
      stone: 2,
      scrap: 1,
      essence: 6,
      bossCore: 5,
    });

    expect(addResourceBags(left, right)).toEqual({
      wood: 11,
      stone: 9,
      scrap: 7,
      essence: 11,
      bossCore: 9,
    });
    expect(subtractResourceBags(left, right)).toEqual({
      wood: 5,
      stone: 5,
      scrap: 5,
      essence: -1,
      bossCore: -1,
    });
  });

  it("requires affordability across every named resource", () => {
    const cost = resources({
      wood: 1,
      stone: 2,
      scrap: 3,
      essence: 4,
      bossCore: 5,
    });
    expect(canAffordResources(cost, cost)).toBe(true);

    for (const kind of resourceKinds) {
      const missing: ResourceBag = {
        ...cost,
        [kind]: cost[kind] - 1,
      };
      expect(canAffordResources(missing, cost)).toBe(false);
    }
  });

  it("uses Math.floor for fractional resource scaling", () => {
    const input: ReadonlyResourceBag = resources({
      wood: 5,
      stone: 7,
      scrap: 1,
      essence: 0,
      bossCore: 3,
    });
    expect(scaleResourceBag(input, 0.5)).toEqual({
      wood: 2,
      stone: 3,
      scrap: 0,
      essence: 0,
      bossCore: 1,
    });
  });

  it("reports no active capacity for fresh or legacy Storage building lists", () => {
    expect(materialCapacityFor([])).toBe(Number.POSITIVE_INFINITY);
    expect(materialCapacityFor([storage(1)])).toBe(Number.POSITIVE_INFINITY);
    expect(materialCapacityFor([storage(2)])).toBe(Number.POSITIVE_INFINITY);
    expect(materialCapacityFor([storage(3)])).toBe(Number.POSITIVE_INFINITY);
  });

  it("normalizes only negative resources and never caps common materials", () => {
    expect(
      clampResourcesToCapacity(
        resources({
          wood: -1,
          stone: 121,
          scrap: 120,
          essence: 119,
          bossCore: 999,
        }),
      ),
    ).toEqual({
      wood: 0,
      stone: 121,
      scrap: 120,
      essence: 119,
      bossCore: 999,
    });
    expect(
      clampResourcesToCapacity(resources({ wood: 1, bossCore: -1 })),
    ).toEqual(resources({ wood: 1 }));
  });

  it("adds incoming resources without a Storage-derived cap", () => {
    expect(
      collectResourcesWithinCapacity(
        resources({ wood: 119, stone: -2, bossCore: 3 }),
        resources({ wood: 4, stone: 1, bossCore: 5 }),
      ),
    ).toEqual(resources({ wood: 123, stone: 0, bossCore: 8 }));
  });
});
