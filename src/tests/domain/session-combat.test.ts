import { describe, expect, it } from "vitest";
import {
  enemyDefinitions,
  gameplayTuning,
  upgradeDefinitions,
} from "../../data/definitions";
import {
  GameSession,
  selectBossUpgradeChoices,
} from "../../domain/GameSession";
import { resourceKinds } from "../../domain/types";
import { advance, savedAtHome } from "./session-test-helpers";

describe("GameSession combat", () => {
  it("projects a live target position while a transient projectile is in flight", () => {
    const session = new GameSession();
    advance(session, gameplayTuning.baseAttackIntervalSeconds);
    const launched = session.snapshot();
    const launchedProjectile = launched.projectiles[0];
    if (launchedProjectile === undefined)
      throw new Error("stationary auto-combat should launch a projectile");

    session.move({ intent: { x: -1, y: 0 }, source: "keyboard", at: 1 });
    session.tick(0.1);
    const inFlight = session.snapshot();
    const projectile = inFlight.projectiles[0];
    const target = inFlight.enemies.find(
      (enemy) => enemy.id === launchedProjectile.targetId,
    );

    expect(projectile).toBeDefined();
    expect(target).toBeDefined();
    expect(projectile?.targetPosition).toEqual(target?.position);
    expect(projectile?.targetPosition).not.toEqual(
      launchedProjectile.targetPosition,
    );
  });

  it("launches a transient projectile that completes while movement suppresses later attacks", () => {
    const session = new GameSession();
    const before = session.snapshot();
    const targetBefore = before.enemies.find(
      (enemy) => enemy.id === "enemy:starter-scout",
    );
    if (targetBefore === undefined)
      throw new Error("starter scout should be active near the initial player");

    advance(session, gameplayTuning.baseAttackIntervalSeconds);
    const launched = session.snapshot();
    expect(launched.projectiles).toHaveLength(1);
    expect(launched.projectiles[0]).toMatchObject({
      origin: { x: 0, y: 0 },
      targetId: targetBefore.id,
      progress: 0,
    });
    expect(
      launched.enemies.find((enemy) => enemy.id === targetBefore.id)?.hp,
    ).toBe(targetBefore.hp);

    const request = session.createValidCampfireSaveRequest(77);
    if (request === null)
      throw new Error("home campfire should issue a save request");
    expect(
      new GameSession({ saved: request.document }).snapshot().projectiles,
    ).toEqual([]);

    session.move({ intent: { x: 1, y: 0 }, source: "keyboard", at: 1 });
    advance(session, gameplayTuning.basicProjectileTravelSeconds);
    const completed = session.snapshot();
    const targetAfter = completed.enemies.find(
      (enemy) => enemy.id === targetBefore.id,
    );
    expect(completed.moving).toBe(true);
    expect(completed.projectiles).toEqual([]);
    expect(targetAfter?.hp).toBe(
      targetBefore.hp - launched.combatStats.attackDamage,
    );

    advance(session, 1);
    expect(session.snapshot().projectiles).toEqual([]);
    expect(
      session.snapshot().enemies.find((enemy) => enemy.id === targetBefore.id)
        ?.hp,
    ).toBe(targetAfter?.hp);
  });

  it("uses exactly five named data-backed resources with data-driven normal, elite, and boss drops", () => {
    expect(resourceKinds).toEqual([
      "wood",
      "stone",
      "scrap",
      "essence",
      "bossCore",
    ]);
    expect(Object.keys(new GameSession().snapshot().resources).sort()).toEqual(
      [...resourceKinds].sort(),
    );
    expect(enemyDefinitions.scout.drops.wood).toBeGreaterThan(0);
    expect(enemyDefinitions.brute.drops.stone).toBeGreaterThan(0);
    expect(enemyDefinitions.spitter.drops.scrap).toBeGreaterThan(0);
    expect(enemyDefinitions.elite.drops.essence).toBeGreaterThan(0);
    expect(enemyDefinitions.boss.drops).toEqual({
      wood: 0,
      stone: 0,
      scrap: 0,
      essence: 0,
      bossCore: 1,
    });
  });

  it("leaves lethal projectile drops on the floor until contact, preserves capacity, and excludes them from saves", () => {
    const base = savedAtHome();
    const session = new GameSession({
      saved: {
        ...base,
        resources: {
          wood: 118,
          stone: 119,
          scrap: 0,
          essence: 0,
          bossCore: 0,
        },
      },
    });
    advance(
      session,
      gameplayTuning.baseAttackIntervalSeconds * 2 +
        gameplayTuning.basicProjectileTravelSeconds +
        0.2,
    );
    const afterDefeat = session.snapshot();
    const drops = afterDefeat.floorDrops;
    expect(afterDefeat.notice).toEqual({
      kind: "enemy.defeated",
      enemyKind: "scout",
      respawns: true,
    });
    expect(drops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resource: "wood", amount: 5 }),
        expect.objectContaining({ resource: "stone", amount: 1 }),
      ]),
    );
    expect(afterDefeat.resources.wood).toBe(118);
    expect(afterDefeat.resources.stone).toBe(119);

    for (const drop of drops) {
      session.setDestination({
        destination: drop.position,
        source: "tap-to-move",
        at: 1,
      });
      advance(session, 1);
    }
    const afterContact = session.snapshot();
    expect(afterContact.resources.wood).toBe(120);
    expect(afterContact.resources.stone).toBe(120);
    expect(afterContact.floorDrops).toEqual([
      expect.objectContaining({ resource: "wood", amount: 3 }),
    ]);

    session.setDestination({
      destination: { x: 0, y: 0 },
      source: "tap-to-move",
      at: 2,
    });
    advance(session, 1);
    const request = session.createValidCampfireSaveRequest(77);
    expect(request).not.toBeNull();
    expect(request?.document).not.toHaveProperty("floorDrops");
  });

  it("offers only distinct unowned trios and makes Chain Strike change hit resolution", () => {
    expect(upgradeDefinitions).toHaveLength(10);
    expect(selectBossUpgradeChoices("review-seed", [])).toHaveLength(3);
    expect(new Set(selectBossUpgradeChoices("review-seed", [])).size).toBe(3);
    expect(
      selectBossUpgradeChoices(
        "review-seed",
        upgradeDefinitions.slice(0, 8).map((upgrade) => upgrade.id),
      ),
    ).toEqual([]);

    const base = savedAtHome();
    const session = new GameSession({
      saved: {
        ...base,
        upgrades: ["chain-strike", "long-reach"],
      },
    });
    const before = session.snapshot().enemies;
    const scoutBefore = before.find(
      (enemy) => enemy.id === "enemy:starter-scout",
    );
    advance(
      session,
      gameplayTuning.baseAttackIntervalSeconds +
        gameplayTuning.basicProjectileTravelSeconds +
        0.1,
    );
    const after = session.snapshot().enemies;
    const scoutAfter = after.find(
      (enemy) => enemy.id === "enemy:starter-scout",
    );
    expect(scoutAfter?.hp).toBeLessThan(
      scoutBefore?.hp ?? Number.POSITIVE_INFINITY,
    );
    expect(
      after.some((enemy) => {
        const beforeEnemy = before.find(
          (candidate) => candidate.id === enemy.id,
        );
        return (
          enemy.id !== "enemy:starter-scout" &&
          enemy.hp < (beforeEnemy?.hp ?? 0)
        );
      }),
    ).toBe(true);
    expect(session.snapshot().effects.join(" ")).toContain("Chain Strike");
  });

  it("preserves tagged upgrade damage, timing, range, movement, and hit-healing semantics", () => {
    const base = savedAtHome();
    const session = new GameSession({
      saved: {
        ...base,
        upgrades: [
          "sharpened-blade",
          "quick-hands",
          "ember-aura",
          "long-reach",
          "chain-strike",
          "trailblazer",
          "keen-focus",
        ],
      },
    });

    const stats = session.snapshot().combatStats;
    expect(stats.attackDamage).toBe(22);
    expect(stats.attackRange).toBeCloseTo(4.32, 8);
    expect(stats.moveSpeed).toBeCloseTo(3.45, 8);
    expect(stats.chainTargets).toBe(1);
    expect(stats.attackIntervalSeconds).toBeCloseTo(0.31875, 8);

    const withoutHitHealing = new GameSession({
      saved: { ...base, player: { ...base.player, hp: 80 } },
    });
    const withHitHealing = new GameSession({
      saved: {
        ...base,
        player: { ...base.player, hp: 80 },
        upgrades: ["invigorating-edge"],
      },
    });
    advance(
      withoutHitHealing,
      gameplayTuning.baseAttackIntervalSeconds +
        gameplayTuning.basicProjectileTravelSeconds,
    );
    advance(
      withHitHealing,
      gameplayTuning.baseAttackIntervalSeconds +
        gameplayTuning.basicProjectileTravelSeconds,
    );
    expect(withHitHealing.snapshot().player.hp).toBeCloseTo(
      withoutHitHealing.snapshot().player.hp + 1,
      8,
    );
  });
});
