import { classSkillIds, playerClasses } from "../types";
import type { ClassProgression, CurrentSave } from "../types";
import { isSupportedWorldGeneratorVersion } from "../world";
import { isSaveV2Document } from "./saveV2";
import type { SaveV2Document } from "./saveV2";

/**
 * The canonical in-memory save/hydration representation may evolve with the
 * runtime. The historical wire representation in saveV2.ts may not.
 */
export type { CurrentSave } from "../types";

export const isClassProgression = (
  value: unknown,
): value is ClassProgression => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Number.isInteger(candidate.experience) &&
    (candidate.experience as number) >= 0 &&
    (candidate.level === 0 ||
      candidate.level === 1 ||
      candidate.level === 2 ||
      candidate.level === 3 ||
      candidate.level === 4 ||
      candidate.level === 5) &&
    (candidate.playerClass === null ||
      playerClasses.includes(
        candidate.playerClass as (typeof playerClasses)[number],
      )) &&
    Array.isArray(candidate.skillIds) &&
    candidate.skillIds.every((id) =>
      classSkillIds.includes(id as (typeof classSkillIds)[number]),
    ) &&
    new Set(candidate.skillIds).size === candidate.skillIds.length &&
    (candidate.weaponRank === undefined ||
      (Number.isInteger(candidate.weaponRank) &&
        (candidate.weaponRank as number) >= 0))
  );
};

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

/**
 * Browser storage can retain released current-save extensions while the
 * historical `toSaveV2Document` helper remains an exact frozen V2 DTO.
 */
export const toCurrentSaveStorageDocument = (
  save: CurrentSave,
): CurrentSave => ({
  ...toSaveV2Document(save),
  ...(save.classProgression === undefined
    ? {}
    : {
        classProgression: {
          ...save.classProgression,
          skillIds: [...save.classProgression.skillIds],
          weaponRank: save.classProgression.weaponRank ?? 0,
        },
      }),
});

/** Current runtime validation is intentionally separate from V2 wire parsing. */
export const isCurrentSave = (value: unknown): value is CurrentSave =>
  isSaveV2Document(value) &&
  isSupportedWorldGeneratorVersion(value.world.generatorVersion) &&
  (typeof value !== "object" ||
    value === null ||
    !("classProgression" in value) ||
    isClassProgression(
      (value as { readonly classProgression?: unknown }).classProgression,
    ));
