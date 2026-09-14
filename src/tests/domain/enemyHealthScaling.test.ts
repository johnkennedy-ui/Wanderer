import { describe, expect, it } from "vitest";
import { enemyDefinitions } from "../../data/definitions";
import {
  enemyHitMultiplierForLevel,
  hpWithPreservedFraction,
  maxEnemyHpFor,
} from "../../domain/session/enemyHealthScaling";

describe("enemy health scaling", () => {
  it("uses the deterministic one-, two-, three-, and five-hit anchors", () => {
    expect(enemyHitMultiplierForLevel(0)).toBe(1);
    expect(enemyHitMultiplierForLevel(1)).toBe(1);
    expect(enemyHitMultiplierForLevel(2)).toBe(2);
    expect(enemyHitMultiplierForLevel(10)).toBe(3);
    expect(enemyHitMultiplierForLevel(25)).toBe(5);
    expect(enemyHitMultiplierForLevel(99)).toBe(5);
  });

  it("keeps a fractional damage floor exact for every enemy kind with the legacy multiplier default", () => {
    const normalPrimaryDamage = 26.4;
    for (const level of [1, 2, 10, 25]) {
      const requiredHits = enemyHitMultiplierForLevel(level);
      for (const definition of Object.values(enemyDefinitions)) {
        const maxHp = maxEnemyHpFor({
          authoredMaxHp: definition.maxHp,
          context: { level, normalPrimaryDamage },
        });
        expect(maxHp).toBeGreaterThanOrEqual(
          normalPrimaryDamage * requiredHits,
        );
      }
    }

    expect(
      maxEnemyHpFor({
        authoredMaxHp: 1,
        context: { level: 2, normalPrimaryDamage },
      }),
    ).toBe(52.8);
  });

  it("composes authored durability, danger, and wave-boss provenance", () => {
    expect(
      maxEnemyHpFor({
        authoredMaxHp: 72,
        spawnHealthMultiplier: 1.35,
        context: { level: 1, normalPrimaryDamage: 1 },
      }),
    ).toBe(98);
    expect(
      maxEnemyHpFor({
        authoredMaxHp: 1,
        spawnHealthMultiplier: 1.35,
        context: { level: 10, normalPrimaryDamage: 30 },
      }),
    ).toBeCloseTo(121.5, 8);
    expect(
      maxEnemyHpFor({
        authoredMaxHp: 1,
        spawnHealthMultiplier: 5,
        context: { level: 10, normalPrimaryDamage: 30 },
      }),
    ).toBe(450);
  });

  it("preserves living health fractions and never revives defeated enemies", () => {
    expect(
      hpWithPreservedFraction({ hp: 20, maxHp: 80, defeated: false }, 200),
    ).toBe(50);
    expect(
      hpWithPreservedFraction({ hp: 0, maxHp: 80, defeated: true }, 200),
    ).toBe(0);
    expect(
      hpWithPreservedFraction({ hp: -4, maxHp: 80, defeated: true }, 200),
    ).toBe(0);
  });
});
