import { legacyClassSkillIds, playerClasses } from "../types";
import type {
  CurrentSave,
  LegacyClassSkillId,
  PlayerStatAllocations,
} from "../types";
import { isSupportedWorldGeneratorVersion } from "../world";
import { isClassProgressionV4, isSaveV4Document } from "./saveV4";
import type { SaveV4Document } from "./saveV4";
import type { SaveV2Document } from "./saveV2";

/**
 * The canonical in-memory save/hydration representation may evolve with the
 * runtime. The historical wire representation in saveV2.ts remains frozen.
 */
export type { CurrentSave } from "../types";

/** Strict V4 validation is also the current progression validator. */
export const isClassProgression = isClassProgressionV4;

/**
 * Released schema-2 documents could carry a non-wire progression extension.
 * It predates allocations, so its level is intentionally normalized during
 * pure migration rather than trusted as a current V4 value.
 */
export interface LegacyClassProgression {
  readonly experience: number;
  readonly level: 0 | 1 | 2 | 3 | 4 | 5;
  readonly playerClass: (typeof playerClasses)[number] | null;
  readonly skillIds: readonly LegacyClassSkillId[];
  readonly allocatedStats?: PlayerStatAllocations;
  readonly weaponRank?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Validates only fields that historical V2 extensions could safely contain. */
export const isLegacyClassProgression = (
  value: unknown,
): value is LegacyClassProgression => {
  if (!isRecord(value)) return false;
  return (
    Number.isInteger(value.experience) &&
    (value.experience as number) >= 0 &&
    (value.level === 0 ||
      value.level === 1 ||
      value.level === 2 ||
      value.level === 3 ||
      value.level === 4 ||
      value.level === 5) &&
    (value.playerClass === null ||
      playerClasses.includes(
        value.playerClass as (typeof playerClasses)[number],
      )) &&
    Array.isArray(value.skillIds) &&
    value.skillIds.every((id) =>
      legacyClassSkillIds.includes(id as (typeof legacyClassSkillIds)[number]),
    ) &&
    new Set(value.skillIds).size === value.skillIds.length &&
    (value.weaponRank === undefined ||
      (Number.isInteger(value.weaponRank) &&
        (value.weaponRank as number) >= 0)) &&
    value.allocatedStats === undefined
  );
};

/** Retains an exact frozen V2 projection for historical fixture comparisons. */
export const toSaveV2Document = (save: CurrentSave): SaveV2Document => ({
  schemaVersion: 2,
  world: {
    seed: save.world.seed,
    generatorVersion: save.world.generatorVersion,
  },
  player: {
    position: { x: save.player.position.x, y: save.player.position.y },
    hp: save.player.hp,
    maxHp: save.player.maxHp,
  },
  resources: {
    wood: save.resources.wood,
    stone: save.resources.stone,
    scrap: save.resources.scrap,
    essence: save.resources.essence,
    bossCore: save.resources.bossCore,
  },
  buildings: save.buildings.map((building) => ({
    id: building.id,
    kind: building.kind,
    position: { x: building.position.x, y: building.position.y },
    level: building.level,
  })),
  defeatedBossIds: [...save.defeatedBossIds],
  upgrades: [...save.upgrades],
  nextBuildingSerial: save.nextBuildingSerial,
  committedAt: save.committedAt,
  savePointId: save.savePointId,
  savePointPosition: {
    x: save.savePointPosition.x,
    y: save.savePointPosition.y,
  },
});

/** Copies the active V4 wire document without retaining runtime aliases. */
export const toCurrentSaveStorageDocument = (
  save: CurrentSave,
): SaveV4Document => ({
  ...toSaveV2Document(save),
  schemaVersion: 4,
  classProgression: {
    ...save.classProgression,
    skillIds: [...save.classProgression.skillIds],
    allocatedStats: { ...save.classProgression.allocatedStats },
    weaponRank: save.classProgression.weaponRank ?? 0,
  },
});

/** Current runtime validation is intentionally separate from historical V2 parsing. */
export const isCurrentSave = (value: unknown): value is CurrentSave =>
  isSaveV4Document(value) &&
  isSupportedWorldGeneratorVersion(value.world.generatorVersion);
