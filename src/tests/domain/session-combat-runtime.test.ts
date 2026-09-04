import { describe, expect, it } from "vitest";
import {
  advanceAutoCombatPhase,
  advanceEnemyCombatPhase,
} from "../../domain/session/combatTickRuntime";
import { advanceProjectileCombatPhase } from "../../domain/session/projectileCombatRuntime";
import type {
  RuntimeEnemy,
  RuntimeProjectile,
} from "../../domain/session/sessionState";
import type { UpgradeId } from "../../domain/types";

const runtimeEnemy = (overrides: Partial<RuntimeEnemy> = {}): RuntimeEnemy => ({
  id: "enemy:test-scout",
  kind: "scout",
  position: { x: 2, y: 0 },
  spawnPosition: { x: 2, y: 0 },
  hp: 24,
  maxHp: 24,
  damage: 3,
  dangerTier: 1,
  dropMultiplier: 1,
  moveSpeed: 3.2,
  attackEverySeconds: 1.2,
  respawnAt: null,
  defeated: false,
  attackElapsed: 0,
  ...overrides,
});

describe("session combat tick runtime", () => {
  it("resolves a completed normal-enemy hit without erasing boss choices or mutating inputs", () => {
    const enemy = runtimeEnemy({ hp: 5 });
    const enemies = new Map([[enemy.id, enemy]]);
    const projectile: RuntimeProjectile = {
      id: "projectile:0007",
      origin: { x: 0, y: 0 },
      targetId: enemy.id,
      targetPosition: { x: 2, y: 0 },
      damage: 12,
      chainTargetIds: [],
      chainDamage: 0,
      hitHeal: 2,
      elapsed: 0.2,
    };
    const pendingUpgradeChoices: UpgradeId[] = [
      "chain-strike",
      "invigorating-edge",
      "trailblazer",
    ];

    const result = advanceProjectileCombatPhase({
      delta: 0.1,
      elapsed: 4,
      playerHp: 90,
      playerMaxHp: 100,
      enemies,
      projectiles: [projectile],
      floorDrops: [],
      defeatedBossIds: new Set(),
      pendingUpgradeChoices,
      nextFloorDropSerial: 7,
      worldSeed: "runtime-test-seed",
      upgrades: new Set(),
      projectileTravelSeconds: 0.3,
      floorDropOffsetDistance: 0.42,
    });

    expect(result.playerHp).toBe(92);
    expect(result.projectiles).toEqual([]);
    expect(result.enemies.get(enemy.id)).toMatchObject({
      hp: -7,
      defeated: true,
      respawnAt: 16,
    });
    expect(
      result.floorDrops.map((drop) => [drop.resource, drop.amount]),
    ).toEqual([
      ["wood", 5],
      ["stone", 1],
    ]);
    expect(result.pendingUpgradeChoices).toEqual(pendingUpgradeChoices);
    expect(result.pendingUpgradeChoices).not.toBe(pendingUpgradeChoices);
    expect(result.nextFloorDropSerial).toBe(8);
    expect(result.notice).toEqual({
      kind: "enemy.defeated",
      enemyKind: "scout",
      respawns: true,
    });
    expect(enemy).toEqual(runtimeEnemy({ hp: 5 }));
    expect(projectile.elapsed).toBe(0.2);
    expect(pendingUpgradeChoices).toEqual([
      "chain-strike",
      "invigorating-edge",
      "trailblazer",
    ]);
  });

  it("launches a serial-owned projectile from fresh collections", () => {
    const enemy = runtimeEnemy();
    const enemies = new Map([[enemy.id, enemy]]);

    const result = advanceAutoCombatPhase({
      delta: 0.1,
      playerPosition: { x: 0, y: 0 },
      enemies,
      buildings: [],
      upgrades: new Set(),
      projectiles: [],
      attackElapsed: 0.4,
      nextProjectileSerial: 9,
    });

    expect(result.projectiles).toEqual([
      {
        id: "projectile:0009",
        origin: { x: 0, y: 0 },
        targetId: enemy.id,
        targetPosition: enemy.position,
        damage: 12,
        chainTargetIds: [],
        chainDamage: 0,
        hitHeal: 0,
        elapsed: 0,
      },
    ]);
    expect(result.attackElapsed).toBe(0);
    expect(result.nextProjectileSerial).toBe(10);
    expect(result.combatStatus).toBe("Auto-attacking scout (24/24)");
    expect(enemies.get(enemy.id)).toBe(enemy);
    expect(enemy).toEqual(runtimeEnemy());
  });

  it("preserves pursuit-respawn-attack order and returns death recovery without input mutation", () => {
    const respawning = runtimeEnemy({
      id: "enemy:respawning",
      position: { x: 9, y: 9 },
      spawnPosition: { x: 1, y: 0 },
      hp: 0,
      defeated: true,
      respawnAt: 2,
      attackElapsed: 1.1,
    });
    const attacker = runtimeEnemy({
      id: "enemy:attacker",
      position: { x: 0, y: 0 },
      spawnPosition: { x: 0, y: 0 },
      attackElapsed: 1.1,
    });
    const enemies = new Map([
      [respawning.id, respawning],
      [attacker.id, attacker],
    ]);
    const player = { position: { x: 0, y: 0 }, hp: 2, maxHp: 100 };
    const resources = {
      wood: 8,
      stone: 4,
      scrap: 0,
      essence: 0,
      bossCore: 1,
    };
    const input = {
      intent: { x: 1, y: 0 },
      source: "keyboard" as const,
      at: 1,
    };

    const result = advanceEnemyCombatPhase({
      delta: 0.1,
      elapsed: 2,
      player,
      resources,
      enemies,
      committedSavePoint: {
        id: "campfire:home",
        label: "home campfire",
        position: { x: -2, y: 3 },
        level: 1,
      },
      input,
      destination: { x: 5, y: 5 },
      attackElapsed: 0.25,
      enemyAttackStandoff: 1.8,
      deathResourceLossRate: 0.25,
    });

    expect(result.player).toEqual({
      position: { x: -2, y: 3 },
      hp: 100,
      maxHp: 100,
    });
    expect(result.resources).toEqual({
      wood: 6,
      stone: 3,
      scrap: 0,
      essence: 0,
      bossCore: 1,
    });
    expect(result.enemies.get(respawning.id)).toMatchObject({
      position: { x: 1, y: 0 },
      hp: 24,
      defeated: false,
      respawnAt: null,
      attackElapsed: 0.1,
    });
    expect(result.input).toEqual({
      intent: { x: 0, y: 0 },
      source: "system",
      at: 2,
    });
    expect(result.destination).toBeNull();
    expect(result.attackElapsed).toBe(0);
    expect(result.notice).toEqual({
      kind: "player.died",
      savePointLabel: "home campfire",
      resourceLossRate: 0.25,
    });
    expect(result.resetHarvest).toBe(true);
    expect(respawning).toEqual(
      runtimeEnemy({
        id: "enemy:respawning",
        position: { x: 9, y: 9 },
        spawnPosition: { x: 1, y: 0 },
        hp: 0,
        defeated: true,
        respawnAt: 2,
        attackElapsed: 1.1,
      }),
    );
    expect(attacker.attackElapsed).toBe(1.1);
    expect(player).toEqual({ position: { x: 0, y: 0 }, hp: 2, maxHp: 100 });
    expect(resources).toEqual({
      wood: 8,
      stone: 4,
      scrap: 0,
      essence: 0,
      bossCore: 1,
    });
    expect(input).toEqual({
      intent: { x: 1, y: 0 },
      source: "keyboard",
      at: 1,
    });
  });
});
