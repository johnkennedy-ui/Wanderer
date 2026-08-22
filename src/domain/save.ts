import { decodeSave } from "./persistence/decodeSave";
import { isSaveV2Document } from "./persistence/saveV2";
import type { SaveDocument } from "./types";

/** Compatibility export. New callers should use the typed decodeSave result. */
export const isSaveDocument = isSaveV2Document;

/**
 * Transitional nullable adapter retained for existing callers. Storage and the
 * application use decodeSave so corrupt/unsupported data is never collapsed.
 */
export const parseSaveDocument = (
  serialized: string | null,
): SaveDocument | null => {
  const result = decodeSave(serialized);
  return result.ok ? result.document : null;
};

export { decodeSave } from "./persistence/decodeSave";
export type {
  SaveDecodeFailure,
  SaveDecodeResult,
  SaveDecodeSuccess,
  SaveLoadFailure,
} from "./persistence/saveErrors";
