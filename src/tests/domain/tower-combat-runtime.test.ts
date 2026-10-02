import { describe, expect, it } from "vitest";
import { advanceTowerCombatPhase } from "../../domain/session/towerCombatRuntime";
import type { RuntimeEnemy } from "../../domain/session/sessionState";
import type {
  BuildingState,
  TowerBuildingKind,
  Vector2,
} from "../../domain/types";

const tower = (
  kind: TowerBuildingKind,
  id: string,
  position: Vector2 = { x: 0, y: 0 },
): BuildingState => ({ id, kind, position, level: 1 });

const enemy = (id: string, position: Vector2): RuntimeEnemy => ({
  id,
  kind: "scout",
  position,
  spawnPosition: position,
  hp: 24,
  maxHp: 24,
  damage: 3,
  dangerTier: 1,
  dropMultiplier: 1,
  moveSpeed: 0,
  attackEverySeconds: 1,
  respawnAt: null,
  defeated: false,
  attackElapsed: 0,
});

const phase = ({
  delta,
  buildings,
  enemies,
  isAttackBlocked = () => false,
}: {
  readonly delta: number;
  readonly buildings: readonly BuildingState[];
  readonly enemies: readonly RuntimeEnemy[];
  readonly isAttackBlocked?: (from: Vector2, to: Vector2) => boolean;
}) =>
  advanceTowerCombatPhase({
    delta,
    buildings,
    enemies: new Map(enemies.map((candidate) => [candidate.id, candidate])),
    projectiles: [],
    elapsedByTowerId: new Map(),
    nextProjectileSerial: 7,
    nextAttackSequence: 11,
    isAttackBlocked,
  });

describe("tower combat runtime", () => {
  it("selects the nearest stable target and launches a ballista bolt with its tower cue", () => {
    const result = phase({
      delta: 1.1,
      buildings: [tower("ArcherTower", "tower:archer")],
      enemies: [
        enemy("enemy:beta", { x: 3, y: 0 }),
        enemy("enemy:alpha", { x: -3, y: 0 }),
      ],
    });

    expect(result.projectiles).toEqual([
      expect.objectContaining({
        id: "tower-projectile:0007",
        targetId: "enemy:alpha",
        targetPosition: { x: -3, y: 0 },
        damage: 12,
        chainTargetIds: [],
        style: "arrow",
        visual: "tower-ballista",
      }),
    ]);
    expect(result.presentationAttacks).toEqual([
      expect.objectContaining({
        actorId: "tower:archer",
        sequence: 11,
        direction: { x: -1, y: 0 },
        style: "arrow",
        durationSeconds: 1.1,
      }),
    ]);
    expect(result.nextProjectileSerial).toBe(8);
    expect(result.nextAttackSequence).toBe(12);
  });

  it("chains a crystal bolt only to the two closest enemies around its impact", () => {
    const result = phase({
      delta: 1.3,
      buildings: [tower("MageTower", "tower:mage")],
      enemies: [
        enemy("enemy:primary", { x: 3, y: 0 }),
        enemy("enemy:beta", { x: 3, y: 1 }),
        enemy("enemy:alpha", { x: 3, y: -1 }),
        enemy("enemy:far", { x: 3, y: 2 }),
      ],
    });

    expect(result.projectiles).toEqual([
      expect.objectContaining({
        targetId: "enemy:primary",
        damage: 9,
        chainTargetIds: ["enemy:alpha", "enemy:beta"],
        style: "magic",
        visual: "tower-crystal",
      }),
    ]);
    expect(result.projectiles[0]?.chainDamage).toBeCloseTo(5.4);
  });

  it("sweeps every visible enemy in sword range while a blocked line never starts a cooldown", () => {
    const sword = phase({
      delta: 1.2,
      buildings: [tower("SwordTower", "tower:sword")],
      enemies: [
        enemy("enemy:primary", { x: 1, y: 0 }),
        enemy("enemy:visible", { x: 0, y: -1 }),
        enemy("enemy:blocked", { x: 0, y: 1 }),
        enemy("enemy:outside", { x: 1.8, y: 0 }),
      ],
      isAttackBlocked: (_from, to) => to.y > 0,
    });
    expect(sword.projectiles).toEqual([]);
    expect(sword.sweepAttacks).toEqual([
      expect.objectContaining({
        id: "tower-sweep:tower:sword:0011",
        origin: { x: 0, y: 0 },
        radius: 1.75,
        arcCosine: -1,
        centered: true,
      }),
    ]);
    expect(sword.meleeImpacts).toEqual([
      { targetId: "enemy:primary", damage: 14 },
      { targetId: "enemy:visible", damage: 14 },
    ]);

    const blockedArcher = phase({
      delta: 5,
      buildings: [tower("ArcherTower", "tower:archer")],
      enemies: [enemy("enemy:blocked", { x: 3, y: 0 })],
      isAttackBlocked: () => true,
    });
    expect(blockedArcher).toMatchObject({
      projectiles: [],
      presentationAttacks: [],
      nextProjectileSerial: 7,
      nextAttackSequence: 11,
    });
    expect(blockedArcher.elapsedByTowerId).toEqual(new Map());
  });
});
