import { describe, expect, it } from "vitest";
import { GameSession } from "../../domain/GameSession";
import {
  classSkillDefinitionFor,
  classSkillDefinitions,
  gameplayTuning,
} from "../../data/definitions";
import { decodeSave } from "../../domain/persistence/decodeSave";
import { advanceAutoCombatPhase } from "../../domain/session/combatTickRuntime";
import {
  combatStatsFor,
  movingAttackSpeedMultiplierFor,
  pendingClassSkillChoicesFor,
  playerLevelForExperience,
  playerStatsFor,
} from "../../domain/session/progressionRules";
import {
  emptyPlayerStatAllocations,
  maximumClassSkillTier,
  type ClassProgression,
} from "../../domain/types";
import type { RuntimeEnemy } from "../../domain/session/sessionState";
import { savedAtHome } from "./session-test-helpers";

const progression = (
  playerClass: ClassProgression["playerClass"],
  level: ClassProgression["level"] = 5,
  skillIds: ClassProgression["skillIds"] = [],
): ClassProgression => ({
  experience: [0, ...gameplayTuning.experienceThresholds][level],
  level,
  playerClass,
  skillIds,
  allocatedStats: emptyPlayerStatAllocations(),
});

const enemy = (
  id: string,
  position: { x: number; y: number },
): RuntimeEnemy => ({
  id,
  kind: "scout",
  position,
  spawnPosition: position,
  hp: 24,
  maxHp: 24,
  damage: 3,
  dangerTier: 1,
  dropMultiplier: 1,
  moveSpeed: 3,
  attackEverySeconds: 1,
  respawnAt: null,
  defeated: false,
  attackElapsed: 0,
});

describe("class progression", () => {
  it("uses cumulative deterministic experience thresholds through level 25", () => {
    expect(gameplayTuning.experienceThresholds).toEqual([
      6, 20, 50, 120, 300, 400, 520, 660, 820, 1000, 1200, 1420, 1660, 1920,
      2200, 2500, 2820, 3160, 3520, 3900, 4300, 4720, 5160, 5620, 6100,
    ]);
    expect(
      [
        0, 5, 6, 19, 20, 49, 50, 119, 120, 299, 300, 399, 400, 999, 1000, 6099,
        6100, 9999,
      ].map(playerLevelForExperience),
    ).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 9, 10, 24, 25, 25]);
  });

  it("offers two class-local choices per earned skill tier", () => {
    for (const playerClass of ["knight", "wizard", "archer"] as const) {
      for (const tier of [1, 2, 3, 4] as const) {
        expect(
          classSkillDefinitions.filter(
            (skill) => skill.playerClass === playerClass && skill.tier === tier,
          ),
        ).toHaveLength(2);
      }
    }
    const wizard = progression("wizard", 5);
    expect(pendingClassSkillChoicesFor(wizard)).toEqual([
      "wizard-flame-orb",
      "wizard-wide-blast",
    ]);
    const tierTwo = {
      ...wizard,
      skillIds: ["wizard-flame-orb"] as const,
    };
    expect(pendingClassSkillChoicesFor(tierTwo)).toEqual([
      "wizard-arcane-haste",
      "wizard-mana-siphon",
    ]);
    expect(classSkillDefinitionFor("archer-piercing-arrow").tier).toBe(3);
    const tierFour = {
      ...wizard,
      skillIds: [
        "wizard-flame-orb",
        "wizard-arcane-haste",
        "wizard-nova",
      ] as const,
    };
    expect(pendingClassSkillChoicesFor(tierFour)).toEqual([
      "wizard-meteor",
      "wizard-spellweave",
    ]);
  });

  it("branches each class into route-locked boss and AoE skills through tier 24", () => {
    const legacySkillsByClass = {
      knight: [
        "knight-iron-guard",
        "knight-heavy-blade",
        "knight-execution-arc",
        "knight-bulwark",
      ],
      wizard: [
        "wizard-flame-orb",
        "wizard-arcane-haste",
        "wizard-nova",
        "wizard-meteor",
      ],
      archer: [
        "archer-longbow",
        "archer-quickdraw",
        "archer-piercing-arrow",
        "archer-eagle-eye",
      ],
    } as const;

    for (const playerClass of ["knight", "wizard", "archer"] as const) {
      const atBranch = progression(
        playerClass,
        25,
        legacySkillsByClass[playerClass],
      );
      expect(pendingClassSkillChoicesFor(atBranch)).toEqual([
        `${playerClass}-boss-5`,
        `${playerClass}-aoe-5`,
      ]);
      const bossProgression = {
        ...atBranch,
        skillIds: [...atBranch.skillIds, `${playerClass}-boss-5`],
      } as ClassProgression;
      expect(pendingClassSkillChoicesFor(bossProgression)).toEqual([
        `${playerClass}-boss-6`,
      ]);
      const aoeProgression = {
        ...atBranch,
        skillIds: [...atBranch.skillIds, `${playerClass}-aoe-5`],
      } as ClassProgression;
      expect(pendingClassSkillChoicesFor(aoeProgression)).toEqual([
        `${playerClass}-aoe-6`,
      ]);
      expect(
        classSkillDefinitions.filter(
          (skill) => skill.playerClass === playerClass && skill.tier === 24,
        ),
      ).toHaveLength(2);
    }
    expect(maximumClassSkillTier).toBe(24);
    expect(classSkillDefinitionFor("knight-boss-24")).toMatchObject({
      label: "Worldbreaker",
      route: "boss",
      effect: { kind: "attack-damage", amount: 20 },
    });
    expect(classSkillDefinitionFor("wizard-aoe-24")).toMatchObject({
      label: "Apocalypse Nova",
      route: "aoe",
      effect: { kind: "secondary-targets", amount: 2 },
    });
    expect(classSkillDefinitionFor("archer-aoe-24")).toMatchObject({
      label: "Skyfall Barrage",
      route: "aoe",
      effect: { kind: "secondary-targets", amount: 2 },
    });
  });

  it("projects the authored class passives and applies their current combat roles", () => {
    expect(playerStatsFor(progression("knight"))).toEqual({
      strength: 30,
      dexterity: 0,
      agility: 0,
      luck: 0,
      vitality: 30,
      magic: 0,
      defense: 15,
      magicDefense: 0,
    });
    expect(playerStatsFor(progression("archer"))).toMatchObject({
      dexterity: 30,
      agility: 30,
      luck: 15,
    });
    expect(playerStatsFor(progression("wizard"))).toMatchObject({
      magic: 30,
      agility: 15,
      magicDefense: 15,
    });

    const knight = combatStatsFor([], new Set(), progression("knight"));
    const archer = combatStatsFor([], new Set(), progression("archer"));
    const wizard = combatStatsFor([], new Set(), progression("wizard"));
    expect(knight.attackDamage).toBe(44.4);
    expect(archer.attackDamage).toBe(42);
    expect(archer.moveSpeed).toBe(4.5);
    expect(wizard.attackDamage).toBeCloseTo(43.8, 8);
    expect(wizard.moveSpeed).toBe(3.75);
  });

  it("selects a class once, chooses one skill per tier, and persists only through campfire save", () => {
    const base = savedAtHome();
    const session = new GameSession({
      saved: {
        ...base,
        classProgression: progression(null, 1, []),
      },
    });
    expect(session.chooseClass("wizard")).toBe(true);
    expect(session.chooseClass("archer")).toBe(false);

    const beforeSkill = session.presentation().ui.player;
    const skilled = new GameSession({
      saved: {
        ...base,
        classProgression: progression("wizard", 5, []),
      },
    });
    expect(skilled.chooseClassSkill("wizard-wide-blast")).toBe(true);
    expect(skilled.chooseClassSkill("wizard-flame-orb")).toBe(false);
    expect(skilled.presentation().ui.player).toEqual(beforeSkill);
    const request = skilled.createValidCampfireSaveRequest(11);
    expect(request?.document.classProgression).toEqual({
      experience: 300,
      level: 5,
      playerClass: "wizard",
      skillIds: ["wizard-wide-blast"],
      allocatedStats: emptyPlayerStatAllocations(),
      weaponRank: 0,
    });
    const decoded = decodeSave(JSON.stringify(request?.document));
    if (!decoded.ok) throw new Error(decoded.message);
    const reloaded = new GameSession({ saved: decoded.document });
    expect(reloaded.presentation().ui.classProgression).toEqual(
      request?.document.classProgression,
    );
  });

  it("applies Knight vitality once when the class is selected", () => {
    const base = savedAtHome();
    const session = new GameSession({
      saved: {
        ...base,
        classProgression: progression(null, 1, []),
      },
    });
    expect(session.chooseClass("knight")).toBe(true);
    expect(session.presentation().ui.player).toMatchObject({
      hp: 130,
      maxHp: 130,
    });
  });

  it("gives Knight an immediate crescent, Wizard splash, and Archer a single long-range arrow", () => {
    const enemies = new Map([
      ["east", enemy("east", { x: 2, y: 0 })],
      ["arc", enemy("arc", { x: 1.8, y: 1 })],
      ["arc-east", enemy("arc-east", { x: 2.2, y: 0.4 })],
      ["arc-west", enemy("arc-west", { x: 1.8, y: -1 })],
      ["splash", enemy("splash", { x: 3.3, y: 0 })],
    ]);
    const attack = (classState: ClassProgression) =>
      advanceAutoCombatPhase({
        delta: 1,
        playerPosition: { x: 0, y: 0 },
        enemies,
        buildings: [],
        upgrades: new Set(),
        classProgression: classState,
        projectiles: [],
        attackElapsed: 0,
        nextProjectileSerial: 1,
      });

    const knightAttack = attack(progression("knight"));
    expect(knightAttack).toMatchObject({
      projectiles: [],
      crescentAttacks: [
        expect.objectContaining({
          id: "crescent:0001",
          radius: 2.4,
          arcCosine: 0.5,
        }),
      ],
    });
    expect(knightAttack.meleeImpacts).toEqual([
      { targetId: "east", damage: 44.4 },
      { targetId: "arc", damage: 22.2 },
      { targetId: "arc-west", damage: 22.2 },
      { targetId: "arc-east", damage: 22.2 },
    ]);
    expect(attack(progression("wizard")).projectiles[0]).toMatchObject({
      style: "magic",
      targetId: "east",
      chainTargetIds: ["arc", "arc-west", "arc-east", "splash"],
    });
    expect(attack(progression("archer")).projectiles[0]).toMatchObject({
      style: "arrow",
      targetId: "east",
      chainTargetIds: [],
    });
  });

  it("makes each Knight crescent skill meaningful without changing fixed secondary damage", () => {
    const enemies = new Map([
      ["primary", enemy("primary", { x: 2, y: 0 })],
      ["baseline-secondary", enemy("baseline-secondary", { x: 1.8, y: 1 })],
      ["reach-secondary", enemy("reach-secondary", { x: 2.8, y: 0 })],
      ["arc-secondary", enemy("arc-secondary", { x: 1, y: 2 })],
    ]);
    const attack = (skillId?: ClassProgression["skillIds"][number]) =>
      advanceAutoCombatPhase({
        delta: 1,
        playerPosition: { x: 0, y: 0 },
        enemies,
        buildings: [],
        upgrades: new Set(),
        classProgression: progression(
          "knight",
          5,
          skillId === undefined ? [] : [skillId],
        ),
        projectiles: [],
        attackElapsed: 0,
        nextProjectileSerial: 1,
      });

    const baseline = attack();
    expect(combatStatsFor([], new Set(), progression("knight"))).toMatchObject({
      attackRange: 2.4,
      classAreaRadius: 2.4,
      classArcCosine: 0.5,
      classSecondaryDamageMultiplier: 0.5,
    });
    expect(baseline.meleeImpacts).toEqual([
      { targetId: "primary", damage: 44.4 },
      { targetId: "baseline-secondary", damage: 22.2 },
    ]);

    const wideSlash = attack("knight-wide-slash");
    expect(
      combatStatsFor(
        [],
        new Set(),
        progression("knight", 5, ["knight-wide-slash"]),
      ),
    ).toMatchObject({ attackRange: 3, classAreaRadius: 3 });
    expect(wideSlash.meleeImpacts).toContainEqual({
      targetId: "reach-secondary",
      damage: 22.2,
    });
    expect(
      combatStatsFor(
        [],
        new Set(),
        progression("knight", 5, ["knight-wide-slash"]),
      ).classSecondaryDamageMultiplier,
    ).toBe(0.5);

    const crescentSweep = attack("knight-crescent-sweep");
    expect(
      combatStatsFor(
        [],
        new Set(),
        progression("knight", 5, ["knight-crescent-sweep"]),
      ).classArcCosine,
    ).toBe(0.25);
    expect(crescentSweep.meleeImpacts).toContainEqual({
      targetId: "arc-secondary",
      damage: 22.2,
    });
    expect(
      combatStatsFor(
        [],
        new Set(),
        progression("knight", 5, ["knight-crescent-sweep"]),
      ).classSecondaryDamageMultiplier,
    ).toBe(0.5);

    const whirlwind = attack("knight-whirlwind");
    const whirlwindStats = combatStatsFor(
      [],
      new Set(),
      progression("knight", 5, ["knight-whirlwind"]),
    );
    expect(whirlwindStats).toMatchObject({
      attackIntervalSeconds: 0.315,
      classSecondaryDamageMultiplier: 0.5,
    });
    const whirlwindSecondary = whirlwind.meleeImpacts.find(
      (impact) => impact.targetId === "baseline-secondary",
    );
    expect(whirlwindSecondary?.damage).toBeCloseTo(22.2, 8);
  });

  it("allows Knight and Archer to accumulate attacks at half speed while moving", () => {
    const enemies = new Map([["east", enemy("east", { x: 2, y: 0 })]]);
    const movingAttack = (playerClass: ClassProgression["playerClass"]) =>
      advanceAutoCombatPhase({
        delta: 0.9,
        attackSpeedMultiplier: movingAttackSpeedMultiplierFor(
          progression(playerClass),
        ),
        playerPosition: { x: 0, y: 0 },
        enemies,
        buildings: [],
        upgrades: new Set(),
        classProgression: progression(playerClass),
        projectiles: [],
        attackElapsed: 0,
        nextProjectileSerial: 1,
      });

    expect(movingAttack("knight").projectiles).toHaveLength(0);
    expect(movingAttack("knight").crescentAttacks).toHaveLength(1);
    expect(movingAttack("archer").projectiles).toHaveLength(1);
    expect(movingAttack("archer").attackElapsed).toBe(0);
    expect(movingAttack("wizard").projectiles).toHaveLength(0);
    expect(movingAttack("wizard").attackElapsed).toBe(0);
  });
});
