import { isSupportedWorldGeneratorVersion } from "../world";
import { isClassProgression } from "./currentSave";
import { migrateSaveV2 } from "./migrateSave";
import { isSaveV2Document, SAVE_V2_SCHEMA_VERSION } from "./saveV2";
import type { SaveDecodeResult } from "./saveErrors";

const failure = (
  kind: Extract<SaveDecodeResult, { ok: false }>["failure"],
  message: string,
): SaveDecodeResult => ({ ok: false, failure: kind, message });

const hasSchemaVersion = (
  value: unknown,
): value is { schemaVersion: unknown } =>
  typeof value === "object" && value !== null && "schemaVersion" in value;

/**
 * Parse → identify historical schema → validate frozen DTO → migrate in memory
 * → validate current canonical state. No storage write occurs in this pipeline.
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
  if (raw.schemaVersion !== SAVE_V2_SCHEMA_VERSION)
    return failure(
      "unsupported-schema",
      `Save schema ${String(raw.schemaVersion)} is not supported.`,
    );
  if (!isSaveV2Document(raw))
    return failure(
      "invalid-document",
      "Save data does not match schema version 2.",
    );

  const progression =
    "classProgression" in raw ? raw.classProgression : undefined;
  if (progression !== undefined && !isClassProgression(progression))
    return failure("invalid-document", "Save class progression is invalid.");
  const document = migrateSaveV2(raw, progression);
  if (!isSupportedWorldGeneratorVersion(document.world.generatorVersion)) {
    return failure(
      "unsupported-generator",
      `World generator ${document.world.generatorVersion} is not supported.`,
    );
  }
  return { ok: true, document, wireDocument: raw };
};
