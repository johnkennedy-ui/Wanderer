import { classSkillDefinitionFor } from "../../data/definitions";
import {
  allocatablePlayerStatKinds,
  classSkillIds,
  legacyClassSkillIds,
  maximumClassSkillTier,
  playerClasses,
} from "../types";
import type {
  ClassProgression,
  ClassSkillId,
  LegacyClassSkillId,
  PlayerClass,
  PlayerStatAllocations,
} from "../types";
import { playerLevelForExperience } from "../session/progressionRules";
import { isSaveV2Document } from "./saveV2";
import type { SaveV2Document } from "./saveV2";

/** Current explicit wire format for the level-25 progression catalogue. */
export const SAVE_V4_SCHEMA_VERSION = 4 as const;

export interface SaveV4Document extends Omit<SaveV2Document, "schemaVersion"> {
  readonly schemaVersion: typeof SAVE_V4_SCHEMA_VERSION;
  readonly classProgression: ClassProgression;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isAllocationRecord = (value: unknown): value is PlayerStatAllocations => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [...allocatablePlayerStatKinds].sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]) &&
    allocatablePlayerStatKinds.every(
      (stat) => Number.isInteger(value[stat]) && (value[stat] as number) >= 0,
    )
  );
};

const isContiguousClassSkillPrefix = (
  playerClass: PlayerClass,
  level: number,
  skillIds: readonly ClassSkillId[],
): boolean => {
  if (
    skillIds.length > maximumClassSkillTier ||
    skillIds.length > Math.max(0, level - 1)
  )
    return false;

  let selectedRoute: "boss" | "aoe" | undefined;
  for (const [index, skillId] of skillIds.entries()) {
    const tier = index + 1;
    const definition = classSkillDefinitionFor(skillId);
    if (
      definition.playerClass !== playerClass ||
      definition.tier !== tier ||
      (tier < 5 && definition.route !== undefined)
    )
      return false;
    if (tier === 5) {
      if (definition.route === undefined) return false;
      selectedRoute = definition.route;
    }
    if (tier > 5 && definition.route !== selectedRoute) return false;
  }
  return true;
};

/**
 * V2/V3 accepted any unique known legacy IDs for a selected class. Most
 * runtime-produced documents were canonical prefixes, but a decoder-valid
 * historical selection must not become unloadable merely because V4 adds
 * route continuity. The explicit marker keeps this compatibility lane bounded
 * to the frozen legacy catalogue rather than relaxing ordinary V4 validation.
 */
const isMarkedLegacySkillSelection = (
  playerClass: PlayerClass | null,
  skillIds: readonly ClassSkillId[],
): boolean =>
  playerClass !== null &&
  skillIds.every((id) =>
    legacyClassSkillIds.includes(id as LegacyClassSkillId),
  );

/** Validates current progression, including route continuity after tier 5. */
export const isClassProgressionV4 = (
  value: unknown,
): value is ClassProgression => {
  if (!isRecord(value) || !isAllocationRecord(value.allocatedStats))
    return false;
  if (
    value.legacySkillSelection !== undefined &&
    value.legacySkillSelection !== true
  )
    return false;
  if (
    !Number.isInteger(value.experience) ||
    (value.experience as number) < 0 ||
    value.level !== playerLevelForExperience(value.experience as number) ||
    !Array.isArray(value.skillIds) ||
    !value.skillIds.every((id) => classSkillIds.includes(id as ClassSkillId)) ||
    new Set(value.skillIds).size !== value.skillIds.length ||
    (value.playerClass !== null &&
      !playerClasses.includes(
        value.playerClass as (typeof playerClasses)[number],
      )) ||
    (value.weaponRank !== undefined &&
      (!Number.isInteger(value.weaponRank) || (value.weaponRank as number) < 0))
  )
    return false;

  const allocatedStats = value.allocatedStats;
  const allocationTotal = allocatablePlayerStatKinds.reduce(
    (total, stat) => total + allocatedStats[stat],
    0,
  );
  if (allocationTotal > (value.level as number) * 3) return false;
  const playerClass = value.playerClass as PlayerClass | null;
  const skillIds = value.skillIds as readonly ClassSkillId[];
  if (value.legacySkillSelection === true)
    return isMarkedLegacySkillSelection(playerClass, skillIds);
  if (playerClass === null)
    return allocationTotal === 0 && value.skillIds.length === 0;
  return isContiguousClassSkillPrefix(
    playerClass,
    value.level as number,
    skillIds,
  );
};

/** Validates V4 base fields through frozen V2 rules plus current progression. */
export const isSaveV4Document = (value: unknown): value is SaveV4Document => {
  if (!isRecord(value) || value.schemaVersion !== SAVE_V4_SCHEMA_VERSION)
    return false;
  const historicalShape = { ...value, schemaVersion: 2 as const };
  return (
    isSaveV2Document(historicalShape) &&
    isClassProgressionV4(value.classProgression)
  );
};
