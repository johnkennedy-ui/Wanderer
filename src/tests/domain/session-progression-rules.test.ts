import { describe, expect, it } from "vitest";
import { upgradeDefinitionFor } from "../../data/definitions";
import {
  applyUpgradeEffectToPlayer,
  combatStatsFor,
  describeProgressionEffects,
  projectileUpgradeEffectsFor,
} from "../../domain/session/progressionRules";
import type { BuildingState, PlayerState, UpgradeId } from "../../domain/types";

const workshop = (level: 1 | 2 | 3): BuildingState => ({
  id: `workshop:${level}`,
  kind: "Workshop",
  position: { x: level, y: 0 },
  level,
});

const storage = (level: 1 | 2 | 3): BuildingState => ({
  id: `storage:${level}`,
  kind: "Storage",
  position: { x: level, y: 1 },
  level,
});

const upgrades = (ids: readonly UpgradeId[]): Set<UpgradeId> => new Set(ids);

describe("session progression rules", () => {
  it("derives baseline combat stats for no Workshop and each Workshop level", () => {
    expect(combatStatsFor([], upgrades([]))).toEqual({
      attackDamage: 12,
      attackIntervalSeconds: 0.5,
      attackRange: 3.2,
      moveSpeed: 3,
      chainTargets: 0,
      attackStyle: "basic",
      classSecondaryDamageMultiplier: 0,
      classAreaRadius: 0,
      classArcCosine: 1,
    });

    for (const [level, attackDamage] of [
      [1, 16],
      [2, 21],
      [3, 27],
    ] as const) {
      expect(combatStatsFor([workshop(level)], upgrades([]))).toEqual({
        attackDamage,
        attackIntervalSeconds: 0.5,
        attackRange: 3.2,
        moveSpeed: 3,
        chainTargets: 0,
        attackStyle: "basic",
        classSecondaryDamageMultiplier: 0,
        classAreaRadius: 0,
        classArcCosine: 1,
      });
    }
  });

  it("aggregates each combat-stat upgrade in caller iteration order", () => {
    expect(
      combatStatsFor(
        [workshop(2)],
        upgrades([
          "sharpened-blade",
          "quick-hands",
          "ember-aura",
          "long-reach",
          "chain-strike",
          "invigorating-edge",
          "trailblazer",
          "fortified-heart",
          "keen-focus",
        ]),
      ),
    ).toEqual({
      attackDamage: 31,
      attackIntervalSeconds: 0.31875,
      attackRange: 4.32,
      moveSpeed: 3.4499999999999997,
      chainTargets: 1,
      attackStyle: "basic",
      classSecondaryDamageMultiplier: 0,
      classAreaRadius: 0,
      classArcCosine: 1,
    });
  });

  it("derives Chain Strike projectile damage and Invigorating Edge healing only", () => {
    expect(projectileUpgradeEffectsFor(upgrades([]))).toEqual({
      chainDamageMultiplier: 0,
      hitHeal: 0,
    });
    expect(
      projectileUpgradeEffectsFor(
        upgrades([
          "chain-strike",
          "invigorating-edge",
          "sharpened-blade",
          "fortified-heart",
        ]),
      ),
    ).toEqual({ chainDamageMultiplier: 0.5, hitHeal: 1 });
  });

  it("returns a capped, non-mutating maximum-health transformation and no-ops other effects", () => {
    const player: PlayerState = Object.freeze({
      position: Object.freeze({ x: 3, y: -1 }),
      hp: 100,
      maxHp: 100,
    });
    const before = { ...player, position: { ...player.position } };

    const fortified = applyUpgradeEffectToPlayer(
      player,
      upgradeDefinitionFor("iron-skin").effect,
    );
    const raised = applyUpgradeEffectToPlayer(
      { ...player, hp: 70 },
      upgradeDefinitionFor("iron-skin").effect,
    );
    const unchanged = applyUpgradeEffectToPlayer(
      player,
      upgradeDefinitionFor("sharpened-blade").effect,
    );

    expect(fortified).toEqual({
      position: { x: 3, y: -1 },
      hp: 125,
      maxHp: 125,
    });
    expect(fortified).not.toBe(player);
    expect(raised).toEqual({
      position: { x: 3, y: -1 },
      hp: 95,
      maxHp: 125,
    });
    expect(unchanged).toEqual(player);
    expect(unchanged).not.toBe(player);
    expect(player).toEqual(before);
  });

  it("composes fixed effect text as base strings, building order, then upgrade order", () => {
    expect(
      describeProgressionEffects(
        [workshop(2), storage(1)],
        upgrades(["trailblazer", "iron-skin"]),
      ),
    ).toEqual([
      "Storage: 180 each for Wood, Stone, Metal / Scrap, and Essence; Boss Core is exempt.",
      "Hearth Ward: 2 health/s while stationary near a campfire.",
      "Death: 25% carried-resource loss; no death save.",
      "Workshop L2: L2: +9 basic attack damage.",
      "Storage L1: L1: 180 per Wood, Stone, Metal / Scrap, and Essence.",
      "Trailblazer: 15% faster movement.",
      "Iron Skin: +25 maximum health and heal 25 immediately.",
      "Experience: 0 / 30 · choose a class at level 1.",
    ]);
  });
});
