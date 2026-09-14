import { classDefinitionFor, gameplayTuning } from "../../data/definitions";
import { emptyPlayerStatAllocations } from "../types";
import type { ClassProgression } from "../types";
import { playerLevelForExperience } from "../session/progressionRules";
import type { CurrentSave } from "./currentSave";
import type { LegacyClassProgression } from "./currentSave";
import type { SaveV2Document } from "./saveV2";
import type { SaveV3Document } from "./saveV3";

const defaultClassProgression = (): ClassProgression => ({
  experience: 0,
  level: 0,
  playerClass: null,
  skillIds: [],
  allocatedStats: emptyPlayerStatAllocations(),
  weaponRank: 0,
});

const normalizeLegacyProgression = (
  legacy: LegacyClassProgression | undefined,
): ClassProgression => {
  if (legacy === undefined) return defaultClassProgression();
  return {
    experience: legacy.experience,
    level: playerLevelForExperience(legacy.experience),
    playerClass: legacy.playerClass,
    skillIds: [...legacy.skillIds],
    allocatedStats: {
      ...emptyPlayerStatAllocations(),
      ...(legacy.allocatedStats ?? {}),
    },
    weaponRank: legacy.weaponRank ?? 0,
  };
};

/**
 * V2 Knight saves already contain level-one base Vitality (the former class
 * selection passive). Current V4 applies the identical base at every level,
 * so this migration adds only the missing levels and preserves prior
 * upgrade/skill health. It is pure and never writes storage.
 */
const migratedPlayerFor = (
  document: SaveV2Document,
  progression: ClassProgression,
) => {
  const vitalityGrowth =
    progression.playerClass === null
      ? 0
      : Math.max(0, progression.level - 1) *
        classDefinitionFor(progression.playerClass).passiveStats.vitality *
        gameplayTuning.vitalityHealthPerPoint;
  const maxHp = document.player.maxHp + vitalityGrowth;
  return {
    position: { x: document.player.position.x, y: document.player.position.y },
    hp: Math.min(maxHp, document.player.hp + vitalityGrowth),
    maxHp,
  };
};

/**
 * Pure in-memory migration from the released V2 DTO to the current V4 model.
 * It deliberately performs no persistence or GameSession mutation.
 */
export const migrateSaveV2 = (
  document: SaveV2Document,
  classProgression?: LegacyClassProgression,
): CurrentSave => {
  const progression = normalizeLegacyProgression(classProgression);
  return {
    schemaVersion: 4,
    world: {
      seed: document.world.seed,
      generatorVersion: document.world.generatorVersion,
    },
    player: migratedPlayerFor(document, progression),
    resources: {
      wood: document.resources.wood,
      stone: document.resources.stone,
      scrap: document.resources.scrap,
      essence: document.resources.essence,
      bossCore: document.resources.bossCore,
    },
    buildings: document.buildings.map((building) => ({
      id: building.id,
      kind: building.kind,
      position: { x: building.position.x, y: building.position.y },
      level: building.level,
    })),
    defeatedBossIds: [...document.defeatedBossIds],
    upgrades: [...document.upgrades],
    nextBuildingSerial: document.nextBuildingSerial,
    committedAt: document.committedAt,
    savePointId: document.savePointId,
    savePointPosition: {
      x: document.savePointPosition.x,
      y: document.savePointPosition.y,
    },
    classProgression: progression,
  };
};

/**
 * V3 player health already includes base vitality through its historical L5
 * level. Preserve that state and grant only the newly earned current levels.
 */
const migratedV3PlayerFor = (
  document: SaveV3Document,
  progression: ClassProgression,
) => {
  const legacy = document.classProgression;
  const vitalityGrowth =
    progression.playerClass === null
      ? 0
      : Math.max(0, progression.level - legacy.level) *
        classDefinitionFor(progression.playerClass).passiveStats.vitality *
        gameplayTuning.vitalityHealthPerPoint;
  const maxHp = document.player.maxHp + vitalityGrowth;
  return {
    position: { x: document.player.position.x, y: document.player.position.y },
    hp: Math.min(maxHp, document.player.hp + vitalityGrowth),
    maxHp,
  };
};

/**
 * Pure in-memory migration from frozen V3 semantics to the current V4 model.
 * It never writes storage and intentionally retains the original skill prefix,
 * allocations, and relic rank.
 */
export const migrateSaveV3 = (document: SaveV3Document): CurrentSave => {
  const progression = normalizeLegacyProgression(document.classProgression);
  return {
    schemaVersion: 4,
    world: {
      seed: document.world.seed,
      generatorVersion: document.world.generatorVersion,
    },
    player: migratedV3PlayerFor(document, progression),
    resources: {
      wood: document.resources.wood,
      stone: document.resources.stone,
      scrap: document.resources.scrap,
      essence: document.resources.essence,
      bossCore: document.resources.bossCore,
    },
    buildings: document.buildings.map((building) => ({
      id: building.id,
      kind: building.kind,
      position: { x: building.position.x, y: building.position.y },
      level: building.level,
    })),
    defeatedBossIds: [...document.defeatedBossIds],
    upgrades: [...document.upgrades],
    nextBuildingSerial: document.nextBuildingSerial,
    committedAt: document.committedAt,
    savePointId: document.savePointId,
    savePointPosition: {
      x: document.savePointPosition.x,
      y: document.savePointPosition.y,
    },
    classProgression: progression,
  };
};
