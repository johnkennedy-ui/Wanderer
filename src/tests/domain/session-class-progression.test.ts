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
import type { ClassProgression } from "../../domain/types";
import type { RuntimeEnemy } from "../../domain/session/sessionState";
import { savedAtHome } from "./session-test-helpers";

const progression = (
  playerClass: ClassProgression["playerClass"],
  level: ClassProgression["level"] = 5,
  skillIds: ClassProgression["skillIds"] = [],
): ClassProgression => ({ experience: 1500, level, playerClass, skillIds });

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
  it("uses cumulative deterministic experience thresholds for five levels", () => {
    expect(gameplayTuning.experienceThresholds).toEqual([
      30, 100, 250, 600, 1500,
    ]);
    expect(
      [0, 29, 30, 99, 100, 249, 250, 599, 600, 1499, 1500, 9999].map(
        playerLevelForExperience,
      ),
    ).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
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

  it("projects the authored class passives and applies their current combat roles", () => {
    expect(playerStatsFor(progression("knight"))).toEqual({
      strength: 6,
      dexterity: 0,
      agility: 0,
      luck: 0,
      vitality: 6,
      magic: 0,
      defense: 3,
      magicDefense: 0,
    });
    expect(playerStatsFor(progression("archer"))).toMatchObject({
      dexterity: 6,
      agility: 6,
      luck: 3,
    });
    expect(playerStatsFor(progression("wizard"))).toMatchObject({
      magic: 6,
      agility: 3,
      magicDefense: 3,
    });

    const knight = combatStatsFor([], new Set(), progression("knight"));
    const archer = combatStatsFor([], new Set(), progression("archer"));
    const wizard = combatStatsFor([], new Set(), progression("wizard"));
    expect(knight.attackDamage).toBe(20.4);
    expect(archer.attackDamage).toBe(18);
    expect(archer.moveSpeed).toBe(3.3);
    expect(wizard.attackDamage).toBeCloseTo(19.8, 8);
    expect(wizard.moveSpeed).toBe(3.15);
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
      experience: 1500,
      level: 5,
      playerClass: "wizard",
      skillIds: ["wizard-wide-blast"],
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

  it("gives Knight arcs, Wizard splash, and Archer a single long-range arrow", () => {
    const enemies = new Map([
      ["east", enemy("east", { x: 2, y: 0 })],
      ["arc", enemy("arc", { x: 1.8, y: 1 })],
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
      }).projectiles[0];

    expect(attack(progression("knight"))).toMatchObject({
      style: "slash",
      targetId: "east",
      chainTargetIds: ["arc"],
    });
    expect(attack(progression("wizard"))).toMatchObject({
      style: "magic",
      targetId: "east",
      chainTargetIds: ["arc", "splash"],
    });
    expect(attack(progression("archer"))).toMatchObject({
      style: "arrow",
      targetId: "east",
      chainTargetIds: [],
    });
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

    expect(movingAttack("knight").projectiles).toHaveLength(1);
    expect(movingAttack("archer").projectiles).toHaveLength(0);
    expect(movingAttack("archer").attackElapsed).toBeCloseTo(0.45, 8);
    expect(movingAttack("wizard").projectiles).toHaveLength(0);
    expect(movingAttack("wizard").attackElapsed).toBe(0);
  });
});
