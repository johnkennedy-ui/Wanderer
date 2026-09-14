import { isSupportedWorldGeneratorVersion } from "../world";
import { isCurrentSave, isLegacyClassProgression } from "./currentSave";
import { migrateSaveV2, migrateSaveV3 } from "./migrateSave";
import { isSaveV2Document, SAVE_V2_SCHEMA_VERSION } from "./saveV2";
import { isSaveV3Document, SAVE_V3_SCHEMA_VERSION } from "./saveV3";
import { isSaveV4Document, SAVE_V4_SCHEMA_VERSION } from "./saveV4";
import type { SaveV4Document } from "./saveV4";
import type { SaveDecodeResult } from "./saveErrors";
import type { CurrentSave } from "../types";

const failure = (
  kind: Extract<SaveDecodeResult, { ok: false }>["failure"],
  message: string,
): SaveDecodeResult => ({ ok: false, failure: kind, message });

const hasSchemaVersion = (
  value: unknown,
): value is { schemaVersion: unknown } =>
  typeof value === "object" && value !== null && "schemaVersion" in value;

/** Copies a V4 document into an owned current runtime representation. */
const cloneSaveV4 = (document: SaveV4Document): CurrentSave => ({
  schemaVersion: 4,
  world: { ...document.world },
  player: {
    position: { ...document.player.position },
    hp: document.player.hp,
    maxHp: document.player.maxHp,
  },
  resources: { ...document.resources },
  buildings: document.buildings.map((building) => ({
    ...building,
    position: { ...building.position },
  })),
  defeatedBossIds: [...document.defeatedBossIds],
  upgrades: [...document.upgrades],
  nextBuildingSerial: document.nextBuildingSerial,
  committedAt: document.committedAt,
  savePointId: document.savePointId,
  savePointPosition: { ...document.savePointPosition },
  classProgression: {
    ...document.classProgression,
    skillIds: [...document.classProgression.skillIds],
    allocatedStats: { ...document.classProgression.allocatedStats },
    weaponRank: document.classProgression.weaponRank ?? 0,
  },
});

/**
 * Parse → identify schema → validate frozen V2/V3 or current V4 → migrate/copy
 * in memory. No storage write occurs in this pipeline.
 */
export const decodeSave = (serialized: string | null): SaveDecodeResult => {
  if (serialized === null)
    return failure("absent", "No save document is present.");

  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    return failure("invalid-json", "Save data is not valid JSON.");
  }

  if (!hasSchemaVersion(raw))
    return failure("invalid-document", "Save data has no schema version.");

  if (raw.schemaVersion === SAVE_V2_SCHEMA_VERSION) {
    if (!isSaveV2Document(raw))
      return failure(
        "invalid-document",
        "Save data does not match schema version 2.",
      );
    const progression =
      "classProgression" in raw ? raw.classProgression : undefined;
    if (progression !== undefined && !isLegacyClassProgression(progression))
      return failure("invalid-document", "Save class progression is invalid.");
    const document = migrateSaveV2(raw, progression);
    if (!isSupportedWorldGeneratorVersion(document.world.generatorVersion))
      return failure(
        "unsupported-generator",
        `World generator ${document.world.generatorVersion} is not supported.`,
      );
    if (!isCurrentSave(document))
      return failure(
        "invalid-document",
        "Migrated save data does not match current schema version 4.",
      );
    return { ok: true, document, wireDocument: raw };
  }

  if (raw.schemaVersion === SAVE_V3_SCHEMA_VERSION) {
    if (!isSaveV3Document(raw))
      return failure(
        "invalid-document",
        "Save data does not match schema version 3.",
      );
    if (!isSupportedWorldGeneratorVersion(raw.world.generatorVersion))
      return failure(
        "unsupported-generator",
        `World generator ${raw.world.generatorVersion} is not supported.`,
      );
    const document = migrateSaveV3(raw);
    if (!isCurrentSave(document))
      return failure(
        "invalid-document",
        "Migrated save data does not match current schema version 4.",
      );
    return { ok: true, document, wireDocument: raw };
  }

  if (raw.schemaVersion === SAVE_V4_SCHEMA_VERSION) {
    if (!isSaveV4Document(raw))
      return failure(
        "invalid-document",
        "Save data does not match schema version 4.",
      );
    if (!isSupportedWorldGeneratorVersion(raw.world.generatorVersion))
      return failure(
        "unsupported-generator",
        `World generator ${raw.world.generatorVersion} is not supported.`,
      );
    return { ok: true, document: cloneSaveV4(raw), wireDocument: raw };
  }

  return failure(
    "unsupported-schema",
    `Save schema ${String(raw.schemaVersion)} is not supported.`,
  );
};
