import { describe, expect, it } from "vitest";
import {
  advanceAutoCombatPhase,
  advanceEnemyCombatPhase,
} from "../../domain/session/combatTickRuntime";
import { wallBlocksSegment } from "../../domain/session/buildingGeometry";
import { advanceProjectileCombatPhase } from "../../domain/session/projectileCombatRuntime";
import type {
  RuntimeEnemy,
  RuntimeProjectile,
} from "../../domain/session/sessionState";
import type {
  BuildingState,
  ChunkRecipe,
  WorldIdentity,
} from "../../domain/types";
import { emptyPlayerStatAllocations } from "../../domain/types";
import { WANDERER_WEB_V3 } from "../../domain/world";
import { terrainBlocksProjectileSegment } from "../../domain/world/projectileCollision";

const enemy = (id: string, x: number, hp = 24): RuntimeEnemy => ({
  id,
  kind: "scout",
  position: { x, y: 0 },
  spawnPosition: { x, y: 0 },
  hp,
  maxHp: hp,
  damage: 3,
  dangerTier: 1,
  dropMultiplier: 1,
  moveSpeed: 0,
  attackEverySeconds: 1,
  respawnAt: null,
  defeated: false,
  attackElapsed: 0,
});
const projectile = (targetId: string): RuntimeProjectile => ({
  id: "projectile:test",
  origin: { x: 0, y: 0 },
  targetId,
  targetPosition: { x: 8, y: 0 },
  damage: 30,
  chainTargetIds: [],
  chainDamage: 0,
  hitHeal: 2,
  elapsed: 0,
});
const phase = (
  projectiles: readonly RuntimeProjectile[],
  enemies: ReadonlyMap<string, RuntimeEnemy>,
  isFlightBlocked?: (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => boolean,
) =>
  advanceProjectileCombatPhase({
    delta: 1,
    elapsed: 1,
    playerHp: 50,
    playerMaxHp: 100,
    enemies,
    projectiles,
    floorDrops: [],
    defeatedBossIds: new Set(),
    pendingUpgradeChoices: [],
    nextFloorDropSerial: 1,
    worldSeed: "test",
    upgrades: new Set(),
    projectileTravelSeconds: 1,
    floorDropOffsetDistance: 0.42,
    isFlightBlocked,
  });

describe("projectile obstacles", () => {
  it("removes a blocked long-step projectile without damage, healing, drops, or input mutation", () => {
    const target = enemy("enemy:primary", 8);
    const shot = projectile(target.id);
    const result = phase([shot], new Map([[target.id, target]]), () => true);
    expect(result.projectiles).toEqual([]);
    expect(result.enemies.get(target.id)?.hp).toBe(24);
    expect(result.playerHp).toBe(50);
    expect(result.floorDrops).toEqual([]);
    expect(target.hp).toBe(24);
    expect(shot.elapsed).toBe(0);
  });

  it("keeps unobstructed impacts and blocks only occluded secondary targets", () => {
    const primary = enemy("enemy:primary", 8);
    const visible = enemy("enemy:visible", 9);
    const blocked = enemy("enemy:blocked", 10);
    const shot = {
      ...projectile(primary.id),
      chainTargetIds: [visible.id, blocked.id],
      chainDamage: 5,
    };
    const result = phase(
      [shot],
      new Map([
        [primary.id, primary],
        [visible.id, visible],
        [blocked.id, blocked],
      ]),
      (from, to) => from.x === 8 && to.x === 10,
    );
    expect(result.enemies.get(primary.id)?.defeated).toBe(true);
    expect(result.enemies.get(visible.id)?.hp).toBe(19);
    expect(result.enemies.get(blocked.id)?.hp).toBe(24);
    expect(result.playerHp).toBe(54);
    expect(result.experienceEarned).toBe(1);
  });

  it("uses solid terrain footprints, including legacy rocks, but excludes water", () => {
    const world: WorldIdentity = {
      seed: "terrain",
      generatorVersion: WANDERER_WEB_V3,
    };
    const source = (
      _world: WorldIdentity,
      coordinate: { x: number; y: number },
    ): ChunkRecipe => ({
      coordinate,
      key: `${coordinate.x},${coordinate.y}`,
      domainSeeds: {},
      obstacles:
        coordinate.x === 0
          ? [
              {
                id: "water",
                kind: "water",
                radius: 1,
                position: { x: 2, y: 0 },
              },
              { id: "legacy-rock", position: { x: 6, y: 0 } },
            ]
          : [],
      campfires: [],
      spawns: [],
    });
    expect(
      terrainBlocksProjectileSegment(
        world,
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        source,
      ),
    ).toBe(false);
    expect(
      terrainBlocksProjectileSegment(
        world,
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        source,
      ),
    ).toBe(true);
    expect(
      terrainBlocksProjectileSegment(
        world,
        { x: 6, y: 0 },
        { x: 6, y: 0 },
        source,
      ),
    ).toBe(true);
  });

  it("makes an enemy wait when its in-range attack is wall-blocked", () => {
    const attacker = enemy("enemy:attacker", 1);
    const result = advanceEnemyCombatPhase({
      delta: 1,
      elapsed: 1,
      player: { position: { x: 0, y: 0 }, hp: 10, maxHp: 10 },
      resources: { wood: 0, stone: 0, scrap: 0, essence: 0, bossCore: 0 },
      enemies: new Map([[attacker.id, attacker]]),
      committedSavePoint: {
        id: "campfire",
        label: "home",
        position: { x: 0, y: 0 },
        level: 1,
      },
      input: { intent: { x: 0, y: 0 }, source: "system", at: 0 },
      destination: null,
      attackElapsed: 0,
      enemyAttackStandoff: 2,
      deathResourceLossRate: 0,
      isAttackBlocked: () => true,
    });
    expect(result.player.hp).toBe(10);
    expect(result.enemies.get(attacker.id)?.attackElapsed).toBe(0);
  });
});

const wall = (x: number, y: number): BuildingState => ({
  id: `building:regression:${x}:${y}`,
  kind: "StoneWall",
  position: { x, y },
  level: 1,
});

describe("projectile wall regression witnesses", () => {
  it.each(["basic", "arrow", "magic"] as const)(
    "stops a swept %s shot at a real wall with no rewards",
    (style) => {
      const target = enemy("target", 8);
      const shot = { ...projectile(target.id), style };
      const result = phase([shot], new Map([[target.id, target]]), (from, to) =>
        wallBlocksSegment(from, to, [wall(4, 0)]),
      );
      expect(result.projectiles).toEqual([]);
      expect(result.enemies.get(target.id)?.hp).toBe(24);
      expect(result.playerHp).toBe(50);
      expect(result.experienceEarned).toBe(0);
      expect(result.floorDrops).toEqual([]);
      expect(result.weaponRelicDrops).toEqual([]);
      expect(result.nextFloorDropSerial).toBe(1);
      const clear = phase([shot], new Map([[target.id, target]]));
      expect(clear.enemies.get(target.id)?.defeated).toBe(true);
      expect(clear.playerHp).toBe(52);
      expect(clear.experienceEarned).toBe(1);
    },
  );

  it.each([false, true])(
    "sweeps from the previous rendered homing point on lateral retarget (replacement=%s)",
    (replacement) => {
      const original = enemy("original", 8);
      const target = {
        ...enemy(replacement ? "replacement" : "original", 0),
        position: { x: 0, y: 8 },
      };
      const enemies = replacement
        ? new Map([
            [original.id, { ...original, defeated: true, hp: 0 }],
            [target.id, target],
          ])
        : new Map([[target.id, target]]);
      const shot = {
        ...projectile(original.id),
        homing: true,
        elapsed: 0.5,
        style: "magic" as const,
      };
      const walls = [wall(3, 2)];
      expect(wallBlocksSegment({ x: 4, y: 0 }, { x: 0, y: 8 }, walls)).toBe(
        true,
      );
      expect(wallBlocksSegment({ x: 0, y: 4 }, { x: 0, y: 8 }, walls)).toBe(
        false,
      );
      const result = phase([shot], enemies, (from, to) =>
        wallBlocksSegment(from, to, walls),
      );
      expect(result.projectiles).toEqual([]);
      expect(result.enemies.get(target.id)?.hp).toBe(24);
      expect(result.playerHp).toBe(50);
      expect(result.experienceEarned).toBe(0);
      expect(shot.targetPosition).toEqual({ x: 8, y: 0 });
      expect(shot.elapsed).toBe(0.5);
    },
  );

  it("still occludes secondary impacts when the primary target has despawned", () => {
    const secondary = enemy("secondary", 10, 4);
    const shot = {
      ...projectile("expired-wave-target"),
      chainTargetIds: [secondary.id],
      chainDamage: 5,
    };
    const result = phase(
      [shot],
      new Map([[secondary.id, secondary]]),
      (from, to) => wallBlocksSegment(from, to, [wall(9, 0)]),
    );
    expect(result.projectiles).toEqual([]);
    expect(result.enemies.get(secondary.id)?.hp).toBe(4);
    expect(result.playerHp).toBe(50);
    expect(result.experienceEarned).toBe(0);
    expect(result.floorDrops).toEqual([]);
    const clear = phase([shot], new Map([[secondary.id, secondary]]));
    expect(clear.enemies.get(secondary.id)?.defeated).toBe(true);
    expect(clear.experienceEarned).toBe(1);
    expect(clear.playerHp).toBe(52);
  });

  it("does not apply a non-homing impact to a target that moved behind a wall", () => {
    const target = { ...enemy("target", 8), position: { x: 8, y: 2 } };
    const result = phase(
      [projectile(target.id)],
      new Map([[target.id, target]]),
      (from, to) => wallBlocksSegment(from, to, [wall(8, 1)]),
    );
    expect(result.enemies.get(target.id)?.hp).toBe(24);
    expect(result.playerHp).toBe(50);
    expect(result.floorDrops).toEqual([]);
    expect(result.experienceEarned).toBe(0);
  });

  it.each([1, -1])(
    "queries solid footprints over the %s chunk edge",
    (sign) => {
      const source = (
        _world: WorldIdentity,
        coordinate: { x: number; y: number },
      ): ChunkRecipe => ({
        coordinate,
        key: `${coordinate.x},${coordinate.y}`,
        domainSeeds: {},
        campfires: [],
        spawns: [],
        obstacles:
          coordinate.x === Math.floor((sign * 16.1) / 16) && coordinate.y === 0
            ? [
                {
                  id: "edge-mountain",
                  kind: "mountain",
                  radius: 1.35,
                  position: { x: sign * 16.1, y: 0 },
                },
              ]
            : [],
      });
      expect(
        terrainBlocksProjectileSegment(
          { seed: "edge", generatorVersion: WANDERER_WEB_V3 },
          { x: sign * 14.95, y: -0.25 },
          { x: sign * 14.95, y: 0.25 },
          source,
        ),
      ).toBe(true);
    },
  );

  it("fails closed on invalid or unbounded segments without generating terrain", () => {
    let calls = 0;
    const source = (): ChunkRecipe => {
      calls += 1;
      throw new Error("must not query terrain");
    };
    const world = { seed: "guard", generatorVersion: WANDERER_WEB_V3 };
    for (const to of [
      { x: Infinity, y: 0 },
      { x: NaN, y: 0 },
      { x: 1e300, y: 1e300 },
      { x: 1e6, y: 1e6 },
    ])
      expect(
        terrainBlocksProjectileSegment(world, { x: 0, y: 0 }, to, source),
      ).toBe(true);
    expect(calls).toBe(0);
  });

  it("blocks melee across a wall while letting a ranged shot enter its collision-tested flight", () => {
    const target = enemy("target", 1);
    const input = {
      delta: 1,
      playerPosition: { x: 0, y: 0 },
      enemies: new Map([[target.id, target]]),
      buildings: [],
      upgrades: new Set<never>(),
      projectiles: [],
      attackElapsed: 1,
      nextProjectileSerial: 1,
      classProgression: {
        experience: 6,
        level: 1 as const,
        playerClass: "knight" as const,
        skillIds: [],
        allocatedStats: emptyPlayerStatAllocations(),
        weaponRank: 0,
      },
    };
    const clear = advanceAutoCombatPhase(input);
    expect(
      clear.meleeImpacts.some((impact) => impact.targetId === target.id),
    ).toBe(true);
    expect(
      advanceAutoCombatPhase({ ...input, isAttackBlocked: () => true })
        .meleeImpacts,
    ).toEqual([]);
    const ranged = advanceAutoCombatPhase({
      ...input,
      classProgression: { ...input.classProgression, playerClass: "archer" },
      isAttackBlocked: () => true,
    });
    expect(ranged.projectiles.length).toBeGreaterThan(0);
  });
});
