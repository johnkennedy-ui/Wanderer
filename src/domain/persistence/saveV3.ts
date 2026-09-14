import {
  allocatablePlayerStatKinds,
  classSkillIds,
  playerClasses,
} from "../types";
import type { ClassProgression, PlayerStatAllocations } from "../types";
import { playerLevelForExperience } from "../session/progressionRules";
import { isSaveV2Document } from "./saveV2";
import type { SaveV2Document } from "./saveV2";

/** The active explicit wire format for stat allocations and progression. */
export const SAVE_V3_SCHEMA_VERSION = 3 as const;

export interface SaveV3Document
  extends Omit<SaveV2Document, "schemaVersion"> {
  readonly schemaVersion: typeof SAVE_V3_SCHEMA_VERSION;
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
      (stat) =>
        Number.isInteger(value[stat]) && (value[stat] as number) >= 0,
    )
  );
};

/** Validates the normalized V3 progression rather than accepting legacy gaps. */
export const isClassProgressionV3 = (
  value: unknown,
): value is ClassProgression => {
  if (!isRecord(value)) return false;
  const allocatedStats = value.allocatedStats;
  if (!isAllocationRecord(allocatedStats)) return false;
  if (
    !Number.isInteger(value.experience) ||
    (value.experience as number) < 0 ||
    value.level !== playerLevelForExperience(value.experience as number) ||
    !Array.isArray(value.skillIds) ||
    !value.skillIds.every((id) =>
      classSkillIds.includes(id as (typeof classSkillIds)[number]),
    ) ||
    new Set(value.skillIds).size !== value.skillIds.length ||
    (value.playerClass !== null &&
      !playerClasses.includes(
        value.playerClass as (typeof playerClasses)[number],
      )) ||
    (value.weaponRank !== undefined &&
      (!Number.isInteger(value.weaponRank) || (value.weaponRank as number) < 0))
  )
    return false;

  const allocationTotal = allocatablePlayerStatKinds.reduce(
    (total, stat) => total + allocatedStats[stat],
    0,
  );
  return (
    allocationTotal <= (value.level as number) * 3 &&
    (value.playerClass !== null ||
      (allocationTotal === 0 && value.skillIds.length === 0))
  );
};

/** Validates V3 base fields through frozen V2 rules plus V3-only progression. */
export const isSaveV3Document = (value: unknown): value is SaveV3Document => {
  if (!isRecord(value) || value.schemaVersion !== SAVE_V3_SCHEMA_VERSION)
    return false;
  const historicalShape = { ...value, schemaVersion: 2 as const };
  return (
    isSaveV2Document(historicalShape) &&
    isClassProgressionV3(value.classProgression)
  );
};
