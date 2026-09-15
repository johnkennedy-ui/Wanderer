import { describe, expect, it } from "vitest";
import {
  advanceAutoCombatPhase,
  advanceEnemyCombatPhase,
} from "../../domain/session/combatTickRuntime";
import type { RuntimeEnemy } from "../../domain/session/sessionState";

const enemy = (overrides: Partial<RuntimeEnemy> = {}): RuntimeEnemy => ({
  id: "enemy:cue",
  kind: "scout",
  position: { x: 2, y: 0 },
  spawnPosition: { x: 2, y: 0 },
  hp: 24,
  maxHp: 24,
  damage: 3,
  dangerTier: 1,
  dropMultiplier: 1,
  moveSpeed: 0,
  attackEverySeconds: 0.1,
  respawnAt: null,
  defeated: false,
  attackElapsed: 0,
  ...overrides,
});

describe("combat presentation commitments", () => {
  it("copies one player event for a volley without changing projectile count, target, or damage", () => {
    const target = enemy();
    const result = advanceAutoCombatPhase({
      delta: 0.1,
      playerPosition: { x: 0, y: 0 },
      enemies: new Map([[target.id, target]]),
      buildings: [],
      upgrades: new Set(),
      projectiles: [],
      attackElapsed: 0.4,
      nextProjectileSerial: 9,
      nextAttackEventSerial: 12,
    });
    expect(result.projectiles).toMatchObject([
      { id: "projectile:0009", targetId: target.id, damage: 12 },
    ]);
    expect(result.presentationAttack).toEqual({
      actorId: "player",
      sequence: 12,
      direction: { x: 1, y: 0 },
      style: "basic",
      committedAt: 0,
    });
  });

  it("copies only an existing enemy attack resolution and leaves save-shaped inputs untouched", () => {
    const attacker = enemy({ attackElapsed: 0.1 });
    const result = advanceEnemyCombatPhase({
      delta: 0.1,
      elapsed: 3,
      player: { position: { x: 0, y: 0 }, hp: 100, maxHp: 100 },
      resources: { wood: 0, stone: 0, scrap: 0, essence: 0, bossCore: 0 },
      enemies: new Map([[attacker.id, attacker]]),
      committedSavePoint: {
        id: "campfire:home",
        label: "home",
        position: { x: 0, y: 0 },
        level: 1,
      },
      input: { intent: { x: 0, y: 0 }, source: "system", at: 3 },
      destination: null,
      attackElapsed: 0,
      enemyAttackStandoff: 3,
      deathResourceLossRate: 0.25,
    });
    expect(result.presentationAttacks).toEqual([
      {
        actorId: attacker.id,
        sequence: 1,
        direction: { x: -1, y: 0 },
        committedAt: 0,
      },
    ]);
    expect(result.player.hp).toBe(97);
    expect(attacker.attackEventOrdinal).toBeUndefined();
  });
});
