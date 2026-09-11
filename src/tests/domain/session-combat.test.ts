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
import { selectBossUpgradeChoices as selectPureBossUpgradeChoices } from "../../domain/session/bossUpgradeChoices";
import { combatStatsFor } from "../../domain/session/progressionRules";
import { resourceKinds } from "../../domain/types";
import { advance, savedAtHome } from "./session-test-helpers";

const frozenReviewChoiceTrio = [
  "chain-strike",
  "invigorating-edge",
  "trailblazer",
] as const;

describe("GameSession combat", () => {
  it("projects a live target position while a transient projectile is in flight", () => {
    const session = new GameSession();
    advance(session, gameplayTuning.baseAttackIntervalSeconds);
    const launched = session.presentation().renderer;
    const launchedProjectile = launched.projectiles[0];
    if (launchedProjectile === undefined)
      throw new Error("stationary auto-combat should launch a projectile");

    session.move({ intent: { x: -1, y: 0 }, source: "keyboard", at: 1 });
    session.tick(0.1);
    const inFlight = session.presentation().renderer;
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
    const before = session.presentation().renderer;
    const targetBefore = before.enemies.find(
      (enemy) => enemy.id === "enemy:starter-scout",
    );
    if (targetBefore === undefined)
      throw new Error("starter scout should be active near the initial player");

    advance(session, gameplayTuning.baseAttackIntervalSeconds);
    const launched = session.presentation().renderer;
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
      new GameSession({ saved: request.document }).presentation().renderer
        .projectiles,
    ).toEqual([]);

    session.move({ intent: { x: 1, y: 0 }, source: "keyboard", at: 1 });
    advance(session, gameplayTuning.basicProjectileTravelSeconds);
    const completed = session.presentation();
    const targetAfter = completed.renderer.enemies.find(
      (enemy) => enemy.id === targetBefore.id,
    );
    expect(completed.renderer.projectiles).toEqual([]);
    expect(targetAfter?.hp).toBe(
      targetBefore.hp - combatStatsFor([], []).attackDamage,
    );

    advance(session, 1);
    expect(session.presentation().renderer.projectiles).toEqual([]);
    expect(
      session
        .presentation()
        .renderer.enemies.find((enemy) => enemy.id === targetBefore.id)?.hp,
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
    expect(
      Object.keys(new GameSession().presentation().ui.resources).sort(),
    ).toEqual([...resourceKinds].sort());
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

  it("leaves lethal projectile drops on the floor until contact, collects all resources, and excludes them from saves", () => {
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
    const afterDefeat = session.presentation();
    const drops = afterDefeat.renderer.floorDrops;
    expect(afterDefeat.ui.notice).toEqual({
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
    expect(afterDefeat.ui.resources.wood).toBe(118);
    expect(afterDefeat.ui.resources.stone).toBe(119);

    for (const drop of drops) {
      session.setDestination({
        destination: drop.position,
        source: "tap-to-move",
        at: 1,
      });
      advance(session, 1);
    }
    const afterContact = session.presentation();
    expect(afterContact.ui.resources.wood).toBe(123);
    expect(afterContact.ui.resources.stone).toBe(120);
    expect(afterContact.renderer.floorDrops).toEqual([]);

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

  it("keeps normal respawn timing and deterministic floor-drop details public", () => {
    const session = new GameSession();
    advance(session, 1.4);
    const defeatedScout = session
      .presentation()
      .renderer.enemies.find((enemy) => enemy.id === "enemy:starter-scout");
    expect(defeatedScout).toBeUndefined();
    expect(
      session
        .presentation()
        .renderer.floorDrops.filter((drop) =>
          drop.id.startsWith("drop:enemy:starter-scout:"),
        ),
    ).toEqual([
      {
        id: "drop:enemy:starter-scout:1:wood",
        resource: "wood",
        amount: 5,
        position: { x: 2.2, y: -0.14 },
      },
      {
        id: "drop:enemy:starter-scout:1:stone",
        resource: "stone",
        amount: 1,
        position: { x: 1.4, y: 0.14 },
      },
    ]);

    advance(session, enemyDefinitions.scout.respawnSeconds! - 0.2);
    expect(
      session
        .presentation()
        .renderer.enemies.find((enemy) => enemy.id === "enemy:starter-scout"),
    ).toBeUndefined();
    advance(session, 0.2);
    expect(
      session
        .presentation()
        .renderer.enemies.find((enemy) => enemy.id === "enemy:starter-scout"),
    ).toMatchObject({
      defeated: false,
      hp: enemyDefinitions.scout.maxHp,
      position: { x: 2.4, y: 0 },
    });
  });

  it("offers only distinct unowned trios and makes Chain Strike change hit resolution", () => {
    expect(upgradeDefinitions).toHaveLength(10);
    const owned = ["sharpened-blade", "quick-hands"] as const;
    const legacyChoices = selectBossUpgradeChoices("review-seed", owned);
    const pureChoices = selectPureBossUpgradeChoices("review-seed", owned);
    expect(legacyChoices).toEqual(frozenReviewChoiceTrio);
    expect(pureChoices).toEqual(frozenReviewChoiceTrio);
    expect(legacyChoices).not.toBe(pureChoices);
    expect(new Set(pureChoices).size).toBe(3);

    legacyChoices.pop();
    expect(selectBossUpgradeChoices("review-seed", owned)).toEqual(
      frozenReviewChoiceTrio,
    );
    expect(selectPureBossUpgradeChoices("review-seed", owned)).toEqual(
      frozenReviewChoiceTrio,
    );
    expect(
      selectPureBossUpgradeChoices(
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
    const before = session.presentation().renderer.enemies;
    const scoutBefore = before.find(
      (enemy) => enemy.id === "enemy:starter-scout",
    );
    advance(
      session,
      gameplayTuning.baseAttackIntervalSeconds +
        gameplayTuning.basicProjectileTravelSeconds +
        0.1,
    );
    const after = session.presentation().renderer.enemies;
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
    expect(session.presentation().ui.effects.join(" ")).toContain(
      "Chain Strike",
    );
  });

  it("preserves tagged upgrade damage, timing, range, movement, and hit-healing semantics", () => {
    const base = savedAtHome();
    const stats = combatStatsFor(base.buildings, [
      "sharpened-blade",
      "quick-hands",
      "ember-aura",
      "long-reach",
      "chain-strike",
      "trailblazer",
      "keen-focus",
    ]);
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
    expect(withHitHealing.presentation().ui.player.hp).toBeCloseTo(
      withoutHitHealing.presentation().ui.player.hp + 1,
      8,
    );
  });
});
