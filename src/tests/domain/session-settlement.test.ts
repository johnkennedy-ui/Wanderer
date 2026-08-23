import { describe, expect, it } from "vitest";
import { gameplayTuning } from "../../data/definitions";
import { GameSession } from "../../domain/GameSession";
import { combatStatsFor } from "../../domain/session/progressionRules";
import {
  advance,
  placeAndUpgradeTo,
  savedAtHome,
} from "./session-test-helpers";

describe("GameSession settlement", () => {
  it("applies all three Campfire radii in actual placement validation", () => {
    const session = new GameSession();
    const campfire = session.placeBuilding("Campfire", { x: 8, y: 2 });
    expect(campfire.ok).toBe(true);
    if (campfire.building === undefined)
      throw new Error("Campfire was not built");

    expect(session.placeBuilding("Workshop", { x: 8, y: 10 })).toMatchObject({
      ok: false,
      rejection: { kind: "outside-settlement-radius", radius: 6 },
    });
    expect(session.upgradeBuilding(campfire.building.id).ok).toBe(true);
    expect(session.placeBuilding("Workshop", { x: 8, y: 10 }).ok).toBe(true);
    expect(session.placeBuilding("Healer", { x: 8, y: 13 })).toMatchObject({
      ok: false,
      rejection: { kind: "outside-settlement-radius", radius: 9 },
    });
    expect(session.upgradeBuilding(campfire.building.id).ok).toBe(true);
    expect(session.placeBuilding("Healer", { x: 8, y: 13 }).ok).toBe(true);
    expect(session.presentation().ui.buildRadius).toBe(
      gameplayTuning.campfireBuildRadiusByLevel[2],
    );
  });

  it("applies distinct L1-L3 Workshop, Farm, Storage, and Healer effects", () => {
    for (const [level, damage] of [
      [1, 16],
      [2, 21],
      [3, 27],
    ] as const) {
      const session = new GameSession();
      placeAndUpgradeTo(session, "Workshop", level);
      const request = session.createValidCampfireSaveRequest(level);
      if (request === null)
        throw new Error("home workshop should create a save document");
      expect(
        combatStatsFor(request.document.buildings, request.document.upgrades)
          .attackDamage,
      ).toBe(damage);
    }

    for (const [level, capacity] of [
      [1, 180],
      [2, 260],
      [3, 360],
    ] as const) {
      const session = new GameSession();
      placeAndUpgradeTo(session, "Storage", level);
      expect(session.presentation().ui.materialCapacity).toBe(capacity);
    }

    for (const [level, harvest] of [
      [1, { wood: 2, stone: 1, scrap: 0, essence: 0 }],
      [2, { wood: 4, stone: 2, scrap: 1, essence: 0 }],
      [3, { wood: 6, stone: 3, scrap: 2, essence: 1 }],
    ] as const) {
      const base = savedAtHome();
      const session = new GameSession({
        saved: {
          ...base,
          player: { position: { x: 0, y: -10 }, hp: 100, maxHp: 100 },
          resources: { ...base.resources, scrap: 100 },
        },
      });
      placeAndUpgradeTo(session, "Farm", level);
      const before = session.presentation().ui.resources;
      advance(session, gameplayTuning.farmHarvestEverySeconds);
      const after = session.presentation().ui.resources;
      expect(after.wood - before.wood).toBe(harvest.wood);
      expect(after.stone - before.stone).toBe(harvest.stone);
      expect(after.scrap - before.scrap).toBe(harvest.scrap);
      expect(after.essence - before.essence).toBe(harvest.essence);
    }

    for (const [level, expectedHealing] of [
      [1, 3],
      [2, 5],
      [3, 8],
    ] as const) {
      const base = savedAtHome();
      const session = new GameSession({
        saved: {
          ...base,
          player: { position: { x: 0, y: 0 }, hp: 50, maxHp: 100 },
        },
      });
      placeAndUpgradeTo(session, "Healer", level);
      advance(session, 1);
      expect(session.presentation().ui.player.hp).toBeCloseTo(
        50 + expectedHealing,
        6,
      );
    }
  });

  it("enforces Storage capacity for all common materials while exempting Boss Core", () => {
    const base = savedAtHome();
    const session = new GameSession({
      saved: {
        ...base,
        resources: {
          wood: 180,
          stone: 180,
          scrap: 180,
          essence: 180,
          bossCore: 4,
        },
        buildings: [
          {
            id: "storage:l1",
            kind: "Storage",
            position: { x: 1, y: 1 },
            level: 1,
          },
          {
            id: "farm:l3",
            kind: "Farm",
            position: { x: 2.5, y: 1 },
            level: 3,
          },
        ],
      },
    });
    advance(session, gameplayTuning.farmHarvestEverySeconds);
    expect(session.presentation().ui.resources).toEqual({
      wood: 180,
      stone: 180,
      scrap: 180,
      essence: 180,
      bossCore: 4,
    });
    expect(session.presentation().ui.effects.join(" ")).toContain(
      "Boss Core is exempt",
    );
  });
});
