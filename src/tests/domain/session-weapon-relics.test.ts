import { describe, expect, it } from "vitest";
import { gameplayTuning } from "../../data/definitions";
import { GameSession } from "../../domain/GameSession";
import { toSaveV2Document } from "../../domain/persistence/currentSave";
import { decodeSave } from "../../domain/persistence/decodeSave";
import { advanceAutoCombatPhase } from "../../domain/session/combatTickRuntime";
import { resolveMeleeCombatPhase } from "../../domain/session/meleeCombatRuntime";
import { advanceProjectileCombatPhase } from "../../domain/session/projectileCombatRuntime";
import {
  combatStatsFor,
  weaponRelicEffectsFor,
} from "../../domain/session/progressionRules";
import {
  collectNearbyWeaponRelics,
  weaponRelicDropForWaveBoss,
} from "../../domain/session/weaponRelicPolicy";
import type {
  ClassProgression,
  PlayerClass,
  UpgradeId,
} from "../../domain/types";
import { createBrowserSaveStorage } from "../../platform/storage/browserSaveStorage";
import { MemoryStore, savedAtHome } from "./session-test-helpers";
import type {
  RuntimeEnemy,
  RuntimeProjectile,
} from "../../domain/session/sessionState";

const progression = (
  playerClass: PlayerClass | null,
  weaponRank = 0,
): ClassProgression => ({
  experience: 1500,
  level: 5,
  playerClass,
  skillIds: [],
  weaponRank,
});

const enemy = (overrides: Partial<RuntimeEnemy> = {}): RuntimeEnemy => ({
  id: "enemy:wave-boss",
  kind: "boss",
  position: { x: 2, y: 0 },
  spawnPosition: { x: 2, y: 0 },
  hp: 20,
  maxHp: 20,
  damage: 8,
  dangerTier: 3,
  dropMultiplier: 5,
  moveSpeed: 1,
  attackEverySeconds: 1,
  respawnAt: null,
  defeated: false,
  attackElapsed: 0,
  ...overrides,
});

const waveBoss = (): RuntimeEnemy =>
  enemy({
    isWaveBoss: true,
    waveIndex: 1,
    bossName: "The Ashen Colossus",
  });

const phaseInput = (enemies: ReadonlyMap<string, RuntimeEnemy>) => ({
  elapsed: 1,
  enemies,
  floorDrops: [],
  weaponRelicDrops: [],
  defeatedBossIds: new Set<string>(),
  pendingUpgradeChoices: [],
  nextFloorDropSerial: 1,
  worldSeed: "weapon-relic-fixture",
  upgrades: new Set<UpgradeId>(),
  floorDropOffsetDistance: gameplayTuning.floorDropOffsetDistance,
});

describe("weapon relic progression", () => {
  it("drops only from wave bosses and waits for a selected class before collection", () => {
    const relic = weaponRelicDropForWaveBoss(waveBoss());
    if (relic === null) throw new Error("wave boss should draft a relic");
    expect(weaponRelicDropForWaveBoss(enemy())).toBeNull();

    const unselected = collectNearbyWeaponRelics({
      playerPosition: relic.position,
      drops: [relic],
      progression: progression(null),
      collectDistance: gameplayTuning.floorDropCollectDistance,
    });
    expect(unselected).toMatchObject({
      drops: [relic],
      collectedRank: null,
      playerClass: null,
    });

    const collected = collectNearbyWeaponRelics({
      playerPosition: relic.position,
      drops: [relic, { ...relic, id: "weapon-relic:second" }],
      progression: progression("archer"),
      collectDistance: gameplayTuning.floorDropCollectDistance,
    });
    expect(collected).toMatchObject({
      drops: [],
      collectedRank: 2,
      playerClass: "archer",
      progression: { weaponRank: 2 },
    });
  });

  it("turns rank one into the authored class weapon abilities and scales later ranks", () => {
    const weaponlessKnight = combatStatsFor(
      [],
      new Set(),
      progression("knight"),
    );
    const rankedKnight = combatStatsFor(
      [],
      new Set(),
      progression("knight", 1),
    );
    expect(weaponlessKnight).toMatchObject({
      attackStyle: "slash",
      classSecondaryDamageMultiplier: 0.5,
      classAreaRadius: 2.4,
      weaponProjectileCount: 1,
    });
    expect(rankedKnight.classAreaRadius).toBeCloseTo(3.2, 8);
    expect(rankedKnight.attackDamage).toBeGreaterThan(
      weaponlessKnight.attackDamage,
    );
    const knightRankTwo = weaponRelicEffectsFor(progression("knight", 2));
    expect(knightRankTwo.crescentRadiusBonus).toBe(1);
    expect(knightRankTwo.crescentDamageMultiplier).toBeCloseTo(1.4, 8);

    const targets = new Map([
      [
        "first",
        enemy({ id: "first", kind: "scout", position: { x: 2, y: 0 } }),
      ],
      [
        "second",
        enemy({ id: "second", kind: "scout", position: { x: 2.5, y: 0 } }),
      ],
    ]);
    const archer = advanceAutoCombatPhase({
      delta: 1,
      playerPosition: { x: 0, y: 0 },
      enemies: targets,
      buildings: [],
      upgrades: new Set(),
      classProgression: progression("archer", 1),
      projectiles: [],
      attackElapsed: 0,
      nextProjectileSerial: 1,
    });
    expect(archer.projectiles).toMatchObject([
      { id: "projectile:0001", style: "arrow", targetId: "first" },
      { id: "projectile:0002", style: "arrow", targetId: "second" },
    ]);
    expect(archer.nextProjectileSerial).toBe(3);

    const wizard = advanceAutoCombatPhase({
      delta: 1,
      playerPosition: { x: 0, y: 0 },
      enemies: targets,
      buildings: [],
      upgrades: new Set(),
      classProgression: progression("wizard", 1),
      projectiles: [],
      attackElapsed: 0,
      nextProjectileSerial: 1,
    });
    expect(wizard.projectiles).toMatchObject([
      { style: "magic", homing: true },
    ]);
  });

  it("retargets only a homing projectile when its original target is defeated", () => {
    const defeated = enemy({ id: "defeated", defeated: true, hp: 0 });
    const replacement = enemy({
      id: "replacement",
      kind: "scout",
      position: { x: 5, y: 0 },
    });
    const homing: RuntimeProjectile = {
      id: "projectile:homing",
      origin: { x: 0, y: 0 },
      targetId: defeated.id,
      targetPosition: defeated.position,
      damage: 1,
      chainTargetIds: [],
      chainDamage: 0,
      hitHeal: 0,
      style: "magic",
      homing: true,
      elapsed: 0,
    };
    const result = advanceProjectileCombatPhase({
      delta: 0.1,
      playerHp: 100,
      playerMaxHp: 100,
      projectiles: [homing],
      projectileTravelSeconds: 1,
      ...phaseInput(
        new Map([
          [defeated.id, defeated],
          [replacement.id, replacement],
        ]),
      ),
    });
    expect(result.projectiles[0]).toMatchObject({
      targetId: replacement.id,
      targetPosition: replacement.position,
      homing: true,
    });
    expect(homing.targetId).toBe(defeated.id);
  });

  it("keeps a homing replacement out of its original splash list", () => {
    const defeated = enemy({ id: "defeated", defeated: true, hp: 0 });
    const replacement = enemy({
      id: "replacement",
      kind: "scout",
      position: { x: 5, y: 0 },
    });
    const homing: RuntimeProjectile = {
      id: "projectile:homing-splash",
      origin: { x: 0, y: 0 },
      targetId: defeated.id,
      targetPosition: defeated.position,
      damage: 10,
      chainTargetIds: [replacement.id],
      chainDamage: 7,
      hitHeal: 0,
      style: "magic",
      homing: true,
      elapsed: 0,
    };
    const result = advanceProjectileCombatPhase({
      delta: 1,
      playerHp: 100,
      playerMaxHp: 100,
      projectiles: [homing],
      projectileTravelSeconds: 0.3,
      ...phaseInput(
        new Map([
          [defeated.id, defeated],
          [replacement.id, replacement],
        ]),
      ),
    });
    expect(result.enemies.get(replacement.id)?.hp).toBe(10);
    expect(homing).toMatchObject({
      targetId: defeated.id,
      chainTargetIds: [replacement.id],
    });
  });

  it("resolves every ranked relic damage effect through launch and impact", () => {
    const archerTargets = () =>
      new Map([
        ["first", enemy({ id: "first", kind: "scout", hp: 100, maxHp: 100 })],
        [
          "second",
          enemy({
            id: "second",
            kind: "scout",
            hp: 100,
            maxHp: 100,
            position: { x: 3, y: 0 },
          }),
        ],
      ]);
    const launchArcher = (rank: number) =>
      advanceAutoCombatPhase({
        delta: 1,
        playerPosition: { x: 0, y: 0 },
        enemies: archerTargets(),
        buildings: [],
        upgrades: new Set(),
        classProgression: {
          ...progression("archer", rank),
          skillIds: ["archer-volley"],
        },
        projectiles: [],
        attackElapsed: 0,
        nextProjectileSerial: 1,
      });
    const archerRankOne = launchArcher(1);
    const archerRankTwo = launchArcher(2);
    expect(archerRankOne.projectiles).toMatchObject([
      { targetId: "first", chainTargetIds: ["second"] },
      { targetId: "second", chainTargetIds: ["first"] },
    ]);
    const archerSingleTarget = advanceAutoCombatPhase({
      delta: 1,
      playerPosition: { x: 0, y: 0 },
      enemies: new Map([["first", enemy({ id: "first", kind: "scout" })]]),
      buildings: [],
      upgrades: new Set(),
      classProgression: {
        ...progression("archer", 1),
        skillIds: ["archer-volley"],
      },
      projectiles: [],
      attackElapsed: 0,
      nextProjectileSerial: 1,
    });
    expect(archerSingleTarget.projectiles).toMatchObject([
      { targetId: "first", chainTargetIds: [] },
      { targetId: "first", chainTargetIds: [] },
    ]);
    expect(archerRankTwo.projectiles.map(({ damage }) => damage)).toEqual(
      archerRankOne.projectiles.map(({ damage }) => damage * 1.1),
    );
    for (const [projectiles, expectedHp] of [
      [archerRankOne.projectiles, 73],
      [archerRankTwo.projectiles, 70.3],
    ] as const) {
      const impact = advanceProjectileCombatPhase({
        delta: 1,
        playerHp: 100,
        playerMaxHp: 100,
        projectiles,
        projectileTravelSeconds: 0.3,
        ...phaseInput(archerTargets()),
      });
      expect(impact.enemies.get("first")?.hp).toBeCloseTo(expectedHp, 8);
      expect(impact.enemies.get("second")?.hp).toBeCloseTo(expectedHp, 8);
    }

    const wizardTarget = enemy({ id: "wizard-target", hp: 100, maxHp: 100 });
    const launchWizard = (rank: number) =>
      advanceAutoCombatPhase({
        delta: 1,
        playerPosition: { x: 0, y: 0 },
        enemies: new Map([[wizardTarget.id, wizardTarget]]),
        buildings: [],
        upgrades: new Set(),
        classProgression: progression("wizard", rank),
        projectiles: [],
        attackElapsed: 0,
        nextProjectileSerial: 1,
      });
    const wizardRankOne = launchWizard(1);
    const wizardRankTwo = launchWizard(2);
    expect(wizardRankTwo.projectiles[0].damage).toBeCloseTo(
      wizardRankOne.projectiles[0].damage * 1.15,
      8,
    );
    for (const [projectile, expectedHp] of [
      [wizardRankOne.projectiles[0], 80.2],
      [wizardRankTwo.projectiles[0], 77.23],
    ] as const) {
      const impact = advanceProjectileCombatPhase({
        delta: 1,
        playerHp: 100,
        playerMaxHp: 100,
        projectiles: [projectile],
        projectileTravelSeconds: 0.3,
        ...phaseInput(new Map([[wizardTarget.id, wizardTarget]])),
      });
      expect(impact.enemies.get(wizardTarget.id)?.hp).toBeCloseTo(
        expectedHp,
        8,
      );
    }

    const knightTargets = archerTargets();
    const knight = advanceAutoCombatPhase({
      delta: 1,
      playerPosition: { x: 0, y: 0 },
      enemies: knightTargets,
      buildings: [],
      upgrades: new Set(),
      classProgression: progression("knight", 1),
      projectiles: [],
      attackElapsed: 0,
      nextProjectileSerial: 1,
    });
    expect(knight.projectiles).toEqual([]);
    expect(knight.meleeImpacts).toEqual([
      { targetId: "first", damage: 24.72 },
      { targetId: "second", damage: 12.36 },
    ]);
  });

  it("emits a relic from both direct crescent and projectile wave-boss defeats", () => {
    const meleeBoss = waveBoss();
    const melee = resolveMeleeCombatPhase({
      impacts: [{ targetId: meleeBoss.id, damage: 999 }],
      ...phaseInput(new Map([[meleeBoss.id, meleeBoss]])),
    });
    expect(melee).toMatchObject({
      weaponRelicDrops: [
        expect.objectContaining({ id: `weapon-relic:${meleeBoss.id}` }),
      ],
      defeatedBossIds: new Set(),
      pendingUpgradeChoices: [],
      notice: {
        kind: "weapon-relic.dropped",
        bossName: "The Ashen Colossus",
      },
    });

    const projectileBoss = waveBoss();
    const projectile: RuntimeProjectile = {
      id: "projectile:wave-boss",
      origin: { x: 0, y: 0 },
      targetId: projectileBoss.id,
      targetPosition: projectileBoss.position,
      damage: 999,
      chainTargetIds: [],
      chainDamage: 0,
      hitHeal: 0,
      elapsed: 0.2,
    };
    const projectileResult = advanceProjectileCombatPhase({
      delta: 0.1,
      playerHp: 100,
      playerMaxHp: 100,
      projectiles: [projectile],
      projectileTravelSeconds: 0.3,
      ...phaseInput(new Map([[projectileBoss.id, projectileBoss]])),
    });
    expect(projectileResult).toMatchObject({
      weaponRelicDrops: [
        expect.objectContaining({ id: `weapon-relic:${projectileBoss.id}` }),
      ],
      defeatedBossIds: new Set(),
      pendingUpgradeChoices: [],
      notice: {
        kind: "weapon-relic.dropped",
        bossName: "The Ashen Colossus",
      },
    });
  });

  it("retains ranked relics only through explicit current-save browser storage", () => {
    const legacy = savedAtHome();
    const legacyDecoded = decodeSave(JSON.stringify(toSaveV2Document(legacy)));
    expect(legacyDecoded).toMatchObject({
      ok: true,
      document: { classProgression: { weaponRank: 0 } },
    });

    const session = new GameSession({
      saved: { ...legacy, classProgression: progression("wizard", 2) },
    });
    const request = session.createValidCampfireSaveRequest(99);
    if (request === null) throw new Error("home campfire should save");
    expect(request.document.classProgression).toMatchObject({ weaponRank: 2 });
    expect(toSaveV2Document(request.document)).not.toHaveProperty(
      "classProgression",
    );

    const storage = createBrowserSaveStorage(new MemoryStore());
    expect(storage.commit(request.document)).toMatchObject({ ok: true });
    expect(storage.load()).toMatchObject({
      ok: true,
      document: { classProgression: { weaponRank: 2 } },
    });
  });
});
