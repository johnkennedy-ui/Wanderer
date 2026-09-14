import { describe, expect, it } from "vitest";
import { GameSession } from "../../domain/GameSession";
import { gameplayTuning } from "../../data/definitions";
import {
  emptyPlayerStatAllocations,
  type ClassProgression,
  type PlayerClass,
} from "../../domain/types";
import {
  toCurrentSaveStorageDocument,
  toSaveV2Document,
} from "../../domain/persistence/currentSave";
import { decodeSave } from "../../domain/persistence/decodeSave";
import {
  advanceAutoCombatPhase,
  advanceEnemyCombatPhase,
} from "../../domain/session/combatTickRuntime";
import { deterministicChanceSucceeds } from "../../domain/session/deterministicRoll";
import {
  applyClassPassiveToPlayer,
  applyLevelGrowthToPlayer,
  combatStatsFor,
  playerStatsFor,
  statPointsAvailableFor,
} from "../../domain/session/progressionRules";
import type { RuntimeEnemy } from "../../domain/session/sessionState";
import { savedAtHome } from "./session-test-helpers";

const experienceForLevel = [0, ...gameplayTuning.experienceThresholds] as const;

const progression = (
  playerClass: PlayerClass | null,
  level: ClassProgression["level"],
  allocatedStats = emptyPlayerStatAllocations(),
  weaponRank = 0,
): ClassProgression => ({
  experience: experienceForLevel[level],
  level,
  playerClass,
  skillIds: [],
  allocatedStats,
  weaponRank,
});

const enemy = (overrides: Partial<RuntimeEnemy> = {}): RuntimeEnemy => ({
  id: "enemy:ro-stat-test",
  kind: "scout",
  position: { x: 2, y: 0 },
  spawnPosition: { x: 2, y: 0 },
  hp: 100,
  maxHp: 100,
  damage: 3,
  dangerTier: 1,
  dropMultiplier: 1,
  moveSpeed: 0,
  attackEverySeconds: 1,
  respawnAt: null,
  defeated: false,
  attackElapsed: 0,
  attackEventOrdinal: 0,
  ...overrides,
});

const enemyPhaseBase = (enemies: ReadonlyMap<string, RuntimeEnemy>) => ({
  elapsed: 1,
  player: { position: { x: 0, y: 0 }, hp: 100, maxHp: 100 },
  resources: { wood: 0, stone: 0, scrap: 0, essence: 0, bossCore: 0 },
  enemies,
  committedSavePoint: {
    id: "campfire:home",
    label: "home",
    position: { x: 0, y: 0 },
    level: 1 as const,
  },
  input: { intent: { x: 0, y: 0 }, source: "system" as const, at: 0 },
  destination: null,
  attackElapsed: 0,
  enemyAttackStandoff: 1.8,
  deathResourceLossRate: 0.25,
  worldSeed: "ro-stat-seed",
});

describe("RO-inspired stat core", () => {
  it("grants identical class bases every level and derives defense from total Vitality and Magic", () => {
    const knightOne = progression("knight", 1);
    const knightTwo = progression("knight", 2);
    expect(playerStatsFor(knightOne)).toMatchObject({
      strength: 6,
      vitality: 6,
      defense: 3,
    });
    expect(playerStatsFor(knightTwo)).toMatchObject({
      strength: 12,
      vitality: 12,
      defense: 6,
    });
    expect(statPointsAvailableFor(knightOne)).toBe(3);
    expect(statPointsAvailableFor(knightTwo)).toBe(6);
    expect(
      applyLevelGrowthToPlayer(
        { position: { x: 0, y: 0 }, hp: 130, maxHp: 130 },
        knightOne,
        knightTwo,
      ),
    ).toEqual({ position: { x: 0, y: 0 }, hp: 160, maxHp: 160 });
    expect(
      applyClassPassiveToPlayer(
        { position: { x: 0, y: 0 }, hp: 100, maxHp: 100 },
        "knight",
        5,
      ),
    ).toEqual({ position: { x: 0, y: 0 }, hp: 250, maxHp: 250 });
  });

  it("allocates exactly three earned points per level through a typed, non-persisting command", () => {
    const session = new GameSession({
      saved: {
        ...savedAtHome(),
        classProgression: progression(null, 1),
      },
    });
    expect(session.allocateStat("strength")).toBe(false);
    expect(session.presentation().ui.notice).toEqual({
      kind: "stat-allocation.rejected.no-class",
    });
    expect(session.chooseClass("knight")).toBe(true);
    expect(session.presentation().ui.statPointsAvailable).toBe(3);
    expect(session.allocateStat("vitality")).toBe(true);
    expect(session.presentation().ui.player).toMatchObject({
      hp: 135,
      maxHp: 135,
    });
    expect(session.presentation().ui.playerStats).toMatchObject({
      vitality: 7,
      defense: 3,
    });
    expect(session.allocateStat("strength")).toBe(true);
    expect(session.allocateStat("luck")).toBe(true);
    expect(session.presentation().ui.statPointsAvailable).toBe(0);
    expect(session.allocateStat("magic")).toBe(false);
    expect(session.presentation().ui.notice).toEqual({
      kind: "stat-allocation.rejected.no-points",
    });
    const request = session.createValidCampfireSaveRequest(55);
    expect(request?.document.classProgression.allocatedStats).toEqual({
      strength: 1,
      agility: 0,
      vitality: 1,
      magic: 0,
      dexterity: 0,
      luck: 1,
    });
  });

  it("uses STR, DEX, and Magic as class-primary damage while AGI drives movement, dodge, and attack speed", () => {
    const knight = combatStatsFor([], [], progression("knight", 1));
    const archer = combatStatsFor([], [], progression("archer", 1));
    const wizard = combatStatsFor([], [], progression("wizard", 1));
    expect(knight.attackDamage).toBe(20.4);
    expect(archer).toMatchObject({
      attackDamage: 18,
      moveSpeed: 3.3,
      attackIntervalSeconds: 0.517,
      dodgeChance: 0.06,
    });
    expect(wizard.attackDamage).toBeCloseTo(19.8, 8);
    expect(wizard).toMatchObject({
      physicalCriticalChance: 0,
      magicDefense: 3,
    });
  });

  it("resolves LUK physical crits and AGI dodge by deterministic event identities", () => {
    const archerProgression = progression(
      "archer",
      5,
      { ...emptyPlayerStatAllocations(), luck: 15 },
      1,
    );
    const archerStats = combatStatsFor([], [], archerProgression);
    const targets = new Map([
      ["first", enemy({ id: "first" })],
      ["second", enemy({ id: "second", position: { x: 2.2, y: 0 } })],
    ]);
    const launch = () =>
      advanceAutoCombatPhase({
        delta: 1,
        playerPosition: { x: 0, y: 0 },
        enemies: targets,
        buildings: [],
        upgrades: new Set(),
        classProgression: archerProgression,
        projectiles: [],
        attackElapsed: 0,
        nextProjectileSerial: 1,
        nextAttackEventSerial: 1,
        worldSeed: "ro-stat-seed",
      });
    const firstLaunch = launch();
    const secondLaunch = launch();
    expect(firstLaunch.projectiles).toEqual(secondLaunch.projectiles);
    expect(
      firstLaunch.projectiles.map((projectile, index) => projectile.damage),
    ).toEqual(
      [0, 1].map((index) => {
        const critical = deterministicChanceSucceeds(
          archerStats.physicalCriticalChance,
          {
            worldSeed: "ro-stat-seed",
            domain: "physical-crit",
            eventSerial: 1_024 + index,
          },
        );
        return (
          archerStats.attackDamage *
          (critical ? archerStats.physicalCriticalDamageMultiplier : 1)
        );
      }),
    );

    const knightProgression = progression("knight", 5, {
      ...emptyPlayerStatAllocations(),
      luck: 15,
    });
    const knightStats = combatStatsFor([], [], knightProgression);
    const knightAttack = advanceAutoCombatPhase({
      delta: 1,
      playerPosition: { x: 0, y: 0 },
      enemies: targets,
      buildings: [],
      upgrades: new Set(),
      classProgression: knightProgression,
      projectiles: [],
      attackElapsed: 0,
      nextProjectileSerial: 1,
      nextAttackEventSerial: 1,
      worldSeed: "ro-stat-seed",
    });
    const knightCritical = deterministicChanceSucceeds(
      knightStats.physicalCriticalChance,
      {
        worldSeed: "ro-stat-seed",
        domain: "physical-crit",
        eventSerial: 1,
      },
    );
    expect(knightAttack.meleeImpacts[0]?.damage).toBe(
      knightStats.attackDamage *
        (knightCritical ? knightStats.physicalCriticalDamageMultiplier : 1),
    );
    expect(knightAttack.meleeImpacts[1]?.damage).toBe(
      knightAttack.meleeImpacts[0]!.damage * 0.5,
    );

    const attacker = enemy({ position: { x: 0, y: 0 }, attackElapsed: 0 });
    const dodged = advanceEnemyCombatPhase({
      ...enemyPhaseBase(new Map([[attacker.id, attacker]])),
      delta: 1,
      playerDodgeChance: 1,
    });
    expect(dodged.player.hp).toBe(100);
    expect(dodged.enemies.get(attacker.id)?.attackEventOrdinal).toBe(1);
  });

  it("uses physical defense with a one-damage floor and stable enemy attempt ordinals", () => {
    const attacker = enemy({ position: { x: 0, y: 0 } });
    const oneStep = advanceEnemyCombatPhase({
      ...enemyPhaseBase(new Map([[attacker.id, attacker]])),
      delta: 1,
      playerPhysicalDefense: 2,
    });
    expect(oneStep.player.hp).toBe(99);
    expect(oneStep.enemies.get(attacker.id)?.attackEventOrdinal).toBe(1);

    const firstPart = advanceEnemyCombatPhase({
      ...enemyPhaseBase(new Map([[attacker.id, attacker]])),
      delta: 0.4,
      playerDodgeChance: 0.5,
    });
    const split = advanceEnemyCombatPhase({
      ...enemyPhaseBase(firstPart.enemies),
      elapsed: 1,
      player: firstPart.player,
      resources: firstPart.resources,
      input: firstPart.input,
      destination: firstPart.destination,
      delta: 0.6,
      playerDodgeChance: 0.5,
    });
    const whole = advanceEnemyCombatPhase({
      ...enemyPhaseBase(new Map([[attacker.id, attacker]])),
      delta: 1,
      playerDodgeChance: 0.5,
    });
    expect(split.player.hp).toBe(whole.player.hp);
    expect(split.enemies.get(attacker.id)?.attackEventOrdinal).toBe(1);
    expect(whole.enemies.get(attacker.id)?.attackEventOrdinal).toBe(1);
  });

  it("migrates V2 class extensions to explicit V4 allocations without mutating the historical wire", () => {
    const current = savedAtHome();
    const v2 = {
      ...toSaveV2Document({
        ...current,
        player: { ...current.player, hp: 80, maxHp: 130 },
      }),
      classProgression: {
        experience: 300,
        level: 2,
        playerClass: "knight",
        skillIds: [],
        weaponRank: 0,
      },
    };
    const decoded = decodeSave(JSON.stringify(v2));
    expect(decoded).toMatchObject({
      ok: true,
      wireDocument: { schemaVersion: 2 },
      document: {
        schemaVersion: 4,
        player: { hp: 200, maxHp: 250 },
        classProgression: {
          level: 5,
          allocatedStats: emptyPlayerStatAllocations(),
        },
      },
    });
    expect(v2.player).toEqual({ ...current.player, hp: 80, maxHp: 130 });
    if (!decoded.ok) throw new Error(decoded.message);
    const storage = toCurrentSaveStorageDocument(decoded.document);
    expect(storage.schemaVersion).toBe(4);
    expect(decodeSave(JSON.stringify(storage))).toMatchObject({ ok: true });
  });
});
