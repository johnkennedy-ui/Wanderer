import { describe, expect, it } from "vitest";
import { resolveMeleeCombatPhase } from "../../domain/session/meleeCombatRuntime";
import type { RuntimeEnemy } from "../../domain/session/sessionState";

const enemy = (
  id: string,
  position: { x: number; y: number },
  hp = 100,
): RuntimeEnemy => ({
  id,
  kind: "scout",
  position,
  spawnPosition: position,
  hp,
  maxHp: hp,
  damage: 1,
  dangerTier: 1,
  dropMultiplier: 1,
  moveSpeed: 1,
  attackEverySeconds: 1,
  respawnAt: null,
  defeated: false,
  attackElapsed: 0,
});

describe("melee combat runtime", () => {
  it("applies the authored full primary and half secondary crescent impacts immediately", () => {
    const primary = enemy("primary", { x: 2, y: 0 });
    const secondary = enemy("secondary", { x: 1.9, y: 0.7 });
    const result = resolveMeleeCombatPhase({
      impacts: [
        { targetId: primary.id, damage: 20 },
        { targetId: secondary.id, damage: 10 },
      ],
      elapsed: 9,
      enemies: new Map([
        [primary.id, primary],
        [secondary.id, secondary],
      ]),
      floorDrops: [],
      defeatedBossIds: new Set(),
      pendingUpgradeChoices: [],
      nextFloorDropSerial: 1,
      worldSeed: "melee-test-seed",
      upgrades: new Set(),
      floorDropOffsetDistance: 0.42,
    });

    expect(result.enemies.get(primary.id)?.hp).toBe(80);
    expect(result.enemies.get(secondary.id)?.hp).toBe(90);
    expect(result.experienceEarned).toBe(0);
    expect(primary.hp).toBe(100);
    expect(secondary.hp).toBe(100);
  });
});
