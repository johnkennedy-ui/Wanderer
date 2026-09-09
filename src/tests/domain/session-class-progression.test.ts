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
  pendingClassSkillChoicesFor,
  playerLevelForExperience,
} from "../../domain/session/progressionRules";
import type { ClassProgression } from "../../domain/types";
import type { RuntimeEnemy } from "../../domain/session/sessionState";
import { savedAtHome } from "./session-test-helpers";

const progression = (
  playerClass: ClassProgression["playerClass"],
  level: ClassProgression["level"] = 4,
  skillIds: ClassProgression["skillIds"] = [],
): ClassProgression => ({ experience: 10, level, playerClass, skillIds });

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
  it("uses cumulative deterministic experience thresholds for four initial levels", () => {
    expect(gameplayTuning.experienceThresholds).toEqual([1, 3, 6, 10]);
    expect(
      [0, 1, 2, 3, 5, 6, 9, 10, 999].map(playerLevelForExperience),
    ).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("offers two class-local choices per earned skill tier", () => {
    for (const playerClass of ["knight", "wizard", "archer"] as const) {
      for (const tier of [1, 2, 3] as const) {
        expect(
          classSkillDefinitions.filter(
            (skill) => skill.playerClass === playerClass && skill.tier === tier,
          ),
        ).toHaveLength(2);
      }
    }
    const wizard = progression("wizard", 4);
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
        classProgression: progression("wizard", 4, []),
      },
    });
    expect(skilled.chooseClassSkill("wizard-wide-blast")).toBe(true);
    expect(skilled.chooseClassSkill("wizard-flame-orb")).toBe(false);
    expect(skilled.presentation().ui.player).toEqual(beforeSkill);
    const request = skilled.createValidCampfireSaveRequest(11);
    expect(request?.document.classProgression).toEqual({
      experience: 10,
      level: 4,
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
});
