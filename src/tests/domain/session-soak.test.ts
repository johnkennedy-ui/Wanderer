import { describe, expect, it } from "vitest";
import {
  canonicalHash,
  runSoak,
  SOAK_HALF_STEPS,
} from "./session-soak-fixture";

describe("fixed-seed fixed-step M4 soak", () => {
  for (const reloadAtMidpoint of [false, true]) {
    it(`repeats canonical state and measured maxima (midpoint reload=${reloadAtMidpoint})`, () => {
      const first = runSoak(reloadAtMidpoint);
      const second = runSoak(reloadAtMidpoint);
      expect(second).toEqual(first);
      expect(first.steps).toBe(SOAK_HALF_STEPS * 2);
      expect(first.finalHash).toMatch(/^[a-f0-9]{64}$/);
      expect(first.midpointHash).toBe(first.hydratedHash);
      expect(first.midpointRuntimeReset).toBe(true);
      expect(first.maxima.projectiles).toBeGreaterThan(0);
      expect(first.maxima.floorDrops).toBeGreaterThan(0);
      expect(first.maxima.cachedChunks).toBe(0);
      expect(first.maxima.retainedEnemyDeltas).toBeGreaterThan(
        first.retainedAtStart,
      );
      expect(first.revisits).toBeGreaterThan(0);
      expect(first.deathReturns).toBeGreaterThan(0);
      expect(first.buildingActions).toBe(2);
      const coordinates = first.visitedChunks.map((key) =>
        key.split(",").map(Number),
      );
      expect(coordinates.some(([x]) => x >= 1)).toBe(true);
      expect(coordinates.some(([x]) => x <= -1)).toBe(true);
      expect(coordinates.some(([, y]) => y >= 1)).toBe(true);
      expect(coordinates.some(([, y]) => y <= -1)).toBe(true);
      // Captured by root's test log; values are measured, never invented goldens.
      console.info("M4_SOAK_EVIDENCE", JSON.stringify(first));
    }, 60_000);
  }

  it("canonicalizes object keys without erasing ordered simulation arrays", () => {
    expect(canonicalHash({ b: 2, a: 1 })).toBe(canonicalHash({ a: 1, b: 2 }));
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
    expect(() => canonicalHash({ x: NaN })).toThrow("non-finite");
    expect(() => canonicalHash({ x: Infinity })).toThrow("non-finite");
    expect(() => canonicalHash(new Map())).toThrow("non-plain");
  });
});
