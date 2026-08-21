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
import type { SaveDocument } from "../../domain/types";
import {
  createBrowserSaveStorage,
  type KeyValueStore,
} from "../../platform/storage/browserSaveStorage";

const advance = (session: GameSession, seconds: number): void => {
  for (let tick = 0; tick < Math.ceil(seconds * 10); tick += 1)
    session.tick(0.1);
};

class MemoryStore implements KeyValueStore {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const savedAtHome = (): SaveDocument => {
  const request = new GameSession().createValidCampfireSaveRequest(42);
  if (request === null)
    throw new Error("home campfire should issue a save request");
  return request.document;
};

const placeAndUpgradeTo = (
  session: GameSession,
  kind: "Workshop" | "Farm" | "Storage" | "Healer",
  level: 1 | 2 | 3,
) => {
  const built = session.placeBuilding(kind, { x: 1, y: 1 });
  if (!built.ok || built.building === undefined)
    throw new Error(`could not place ${kind}`);
  let building = built.building;
  while (building.level < level) {
    const upgraded = session.upgradeBuilding(building.id);
    if (!upgraded.ok || upgraded.building === undefined)
      throw new Error(`could not upgrade ${kind}`);
    building = upgraded.building;
  }
  return building;
};

describe("GameSession", () => {
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

  it("immediately suppresses basic attacks while meaningful movement is present", () => {
    const session = new GameSession();
    const scoutBefore = session
      .snapshot()
      .enemies.find((enemy) => enemy.id === "enemy:starter-scout");
    session.move({ intent: { x: 1, y: 0 }, source: "keyboard", at: 1 });
    advance(session, 0.8);
    const scoutAfter = session
      .snapshot()
      .enemies.find((enemy) => enemy.id === "enemy:starter-scout");

    expect(session.snapshot().moving).toBe(true);
    expect(session.snapshot().combatStatus).toContain("suppressed");
    expect(session.snapshot().projectiles).toEqual([]);
    expect(scoutAfter?.hp).toBe(scoutBefore?.hp);

    session.move({ intent: { x: 0, y: 0 }, source: "keyboard", at: 2 });
    advance(session, 0.6);
    expect(session.snapshot().combatStatus).toContain("Auto-attacking");
  });

  it("pursues the player's current location at a data-defined speed without crossing attack standoff", () => {
    const session = new GameSession();
    const scoutBefore = session
      .snapshot()
      .enemies.find((enemy) => enemy.id === "enemy:starter-scout");
    if (scoutBefore === undefined)
      throw new Error("starter scout should be active near the initial player");

    const standoff = gameplayTuning.enemyAttackStandoff;
    const tickSeconds = 0.1;
    const moveAwayFromScout = {
      x: -scoutBefore.position.x,
      y: -scoutBefore.position.y,
    };
    session.move({
      intent: moveAwayFromScout,
      source: "keyboard",
      at: 1,
    });
    session.tick(tickSeconds);

    const afterMovingPlayer = session.snapshot();
    const scoutAfterFirstPursuit = afterMovingPlayer.enemies.find(
      (enemy) => enemy.id === scoutBefore.id,
    );
    if (scoutAfterFirstPursuit === undefined)
      throw new Error("active scout should remain in the snapshot");
    const currentPlayerSeparation = {
      x: afterMovingPlayer.player.position.x - scoutBefore.position.x,
      y: afterMovingPlayer.player.position.y - scoutBefore.position.y,
    };
    const currentPlayerDistance = Math.hypot(
      currentPlayerSeparation.x,
      currentPlayerSeparation.y,
    );
    const expectedTravel = Math.min(
      enemyDefinitions.scout.moveSpeed * tickSeconds,
      currentPlayerDistance - standoff,
    );
    expect(expectedTravel).toBeGreaterThan(0);
    expect(scoutAfterFirstPursuit.position.x).toBeCloseTo(
      scoutBefore.position.x +
        (currentPlayerSeparation.x / currentPlayerDistance) * expectedTravel,
      6,
    );
    expect(scoutAfterFirstPursuit.position.y).toBeCloseTo(
      scoutBefore.position.y +
        (currentPlayerSeparation.y / currentPlayerDistance) * expectedTravel,
      6,
    );

    session.move({ intent: { x: 0, y: 0 }, source: "keyboard", at: 2 });
    const distanceAfterFirstPursuit = Math.hypot(
      afterMovingPlayer.player.position.x - scoutAfterFirstPursuit.position.x,
      afterMovingPlayer.player.position.y - scoutAfterFirstPursuit.position.y,
    );
    const remainingTicks = Math.ceil(
      Math.max(
        0,
        (distanceAfterFirstPursuit - standoff) /
          (enemyDefinitions.scout.moveSpeed * tickSeconds),
      ),
    );
    for (let tick = 0; tick < remainingTicks; tick += 1)
      session.tick(tickSeconds);

    const settledSnapshot = session.snapshot();
    const settledScout = settledSnapshot.enemies.find(
      (enemy) => enemy.id === scoutBefore.id,
    );
    if (settledScout === undefined)
      throw new Error("scout should not be defeated before reaching standoff");
    const settledDistance = Math.hypot(
      settledSnapshot.player.position.x - settledScout.position.x,
      settledSnapshot.player.position.y - settledScout.position.y,
    );
    expect(settledDistance).toBeGreaterThanOrEqual(standoff - 0.000_001);
    expect(settledDistance).toBeCloseTo(standoff, 6);
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

  it("applies all three Campfire radii in actual placement validation", () => {
    const session = new GameSession();
    const campfire = session.placeBuilding("Campfire", { x: 8, y: 2 });
    expect(campfire.ok).toBe(true);
    if (campfire.building === undefined)
      throw new Error("Campfire was not built");

    expect(session.placeBuilding("Workshop", { x: 8, y: 10 }).reason).toBe(
      "outside the 6m campfire settlement radius",
    );
    expect(session.upgradeBuilding(campfire.building.id).ok).toBe(true);
    expect(session.placeBuilding("Workshop", { x: 8, y: 10 }).ok).toBe(true);
    expect(session.placeBuilding("Healer", { x: 8, y: 13 }).reason).toBe(
      "outside the 9m campfire settlement radius",
    );
    expect(session.upgradeBuilding(campfire.building.id).ok).toBe(true);
    expect(session.placeBuilding("Healer", { x: 8, y: 13 }).ok).toBe(true);
    expect(session.snapshot().buildRadius).toBe(
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
      expect(session.snapshot().combatStats.attackDamage).toBe(damage);
    }

    for (const [level, capacity] of [
      [1, 180],
      [2, 260],
      [3, 360],
    ] as const) {
      const session = new GameSession();
      placeAndUpgradeTo(session, "Storage", level);
      expect(session.snapshot().materialCapacity).toBe(capacity);
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
      const before = session.snapshot().resources;
      advance(session, gameplayTuning.farmHarvestEverySeconds);
      const after = session.snapshot().resources;
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
      expect(session.snapshot().player.hp).toBeCloseTo(50 + expectedHealing, 6);
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
    expect(session.snapshot().resources).toEqual({
      wood: 180,
      stone: 180,
      scrap: 180,
      essence: 180,
      bossCore: 4,
    });
    expect(session.snapshot().effects.join(" ")).toContain(
      "Boss Core is exempt",
    );
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

  it("keeps Boss Core and upgrades runtime-only until a later manual campfire commit", () => {
    const baseline = savedAtHome();
    const session = new GameSession({ saved: baseline });
    session.move({ intent: { x: 1, y: 0 }, source: "keyboard", at: 1 });
    advance(session, 1);
    session.move({ intent: { x: 0, y: 0 }, source: "keyboard", at: 2 });
    advance(session, 4.2 + gameplayTuning.basicProjectileTravelSeconds);
    const choices = session.snapshot().pendingUpgradeChoices;
    expect(session.snapshot().resources.bossCore).toBe(1);
    expect(choices).toHaveLength(3);
    expect(session.chooseUpgrade(choices[0])).toBe(true);

    const unsavedReload = new GameSession({ saved: baseline });
    expect(unsavedReload.snapshot().resources.bossCore).toBe(0);
    expect(unsavedReload.snapshot().upgrades).toEqual([]);

    session.move({ intent: { x: -1, y: 0 }, source: "keyboard", at: 3 });
    advance(session, 1);
    session.move({ intent: { x: 0, y: 0 }, source: "keyboard", at: 4 });
    const request = session.createValidCampfireSaveRequest(99);
    expect(request).not.toBeNull();
    const storage = createBrowserSaveStorage(new MemoryStore());
    expect(storage.commit(request!.document).ok).toBe(true);
    session.recordSaveCommitted(request!.document);
    const savedReload = new GameSession({
      saved: storage.load().document ?? undefined,
    });
    expect(savedReload.snapshot().resources.bossCore).toBe(1);
    expect(savedReload.snapshot().upgrades).toContain(choices[0]);
  });

  it("respawns at the committed save-point position, applies the configured 25% loss, and never commits on death", () => {
    const base = savedAtHome();
    const committed: SaveDocument = {
      ...base,
      player: { position: { x: 6, y: 0 }, hp: 1, maxHp: 100 },
      resources: {
        wood: 100,
        stone: 100,
        scrap: 100,
        essence: 100,
        bossCore: 8,
      },
      savePointId: "campfire:player:committed",
      savePointPosition: { x: -1, y: -1 },
    };
    const storage = createBrowserSaveStorage(new MemoryStore());
    expect(storage.commit(committed).ok).toBe(true);
    const session = new GameSession({ saved: committed });
    advance(session, 1.4);

    expect(session.snapshot().player.position).toEqual({ x: -1, y: -1 });
    expect(session.snapshot().resources).toEqual({
      wood: 75,
      stone: 75,
      scrap: 75,
      essence: 75,
      bossCore: 6,
    });
    expect(session.snapshot().message).toContain("25% of carried resources");
    expect(storage.load().document).toEqual(committed);
  });
});
