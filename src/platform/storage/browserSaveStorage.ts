import { decodeSave } from "../../domain/persistence/decodeSave";
import {
  isCurrentSave,
  toCurrentSaveStorageDocument,
} from "../../domain/persistence/currentSave";
import type { SaveLoadFailure } from "../../domain/persistence/saveErrors";
import type { CurrentSave } from "../../domain/types";

export const SAVE_KEYS = Object.freeze({
  temporary: "wanderer.save.temporary",
  primary: "wanderer.save.primary",
  backup: "wanderer.save.backup",
} as const);

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LoadedSaveSuccess {
  readonly ok: true;
  readonly document: CurrentSave;
  readonly source: "primary" | "backup";
  readonly warning: string | null;
  /** The rejected primary is diagnostic only; backup remains the authority. */
  readonly primaryFailure: Exclude<SaveLoadFailure, "absent"> | null;
}

export interface LoadedSaveFailure {
  readonly ok: false;
  readonly document: null;
  readonly source: null;
  readonly warning: null;
  readonly failure: SaveLoadFailure;
  readonly message: string;
}

export type LoadedSave = LoadedSaveSuccess | LoadedSaveFailure;

export type SaveCommitResult =
  | {
      readonly ok: true;
      readonly message: string;
      readonly cleanupWarning: string | null;
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly cleanupWarning: null;
    };

export interface BrowserSaveStorage {
  load(): LoadedSave;
  commit(document: CurrentSave): SaveCommitResult;
}

/**
 * Browser persistence is deliberately an injected platform adapter. The app
 * calls commit only after GameSession issues a valid explicit campfire request.
 */
export const createBrowserSaveStorage = (
  store: KeyValueStore = window.localStorage,
): BrowserSaveStorage => ({
  load(): LoadedSave {
    const primary = decodeSave(store.getItem(SAVE_KEYS.primary));
    if (primary.ok)
      return {
        ok: true,
        document: primary.document,
        source: "primary",
        warning: null,
        primaryFailure: null,
      };

    const backup = decodeSave(store.getItem(SAVE_KEYS.backup));
    if (backup.ok) {
      return {
        ok: true,
        document: backup.document,
        source: "backup",
        warning:
          "Primary save was absent or invalid; recovered the last valid backup.",
        primaryFailure: primary.failure === "absent" ? null : primary.failure,
      };
    }

    const failure =
      primary.failure === "absent" ? backup.failure : primary.failure;
    const failedResult = primary.failure === "absent" ? backup : primary;
    return {
      ok: false,
      document: null,
      source: null,
      warning: null,
      failure,
      message: failedResult.message,
    };
  },
  commit(document: CurrentSave): SaveCommitResult {
    if (!isCurrentSave(document))
      return {
        ok: false,
        message: "Save rejected: invalid document.",
        cleanupWarning: null,
      };
    try {
      const serialized = JSON.stringify(toCurrentSaveStorageDocument(document));
      store.setItem(SAVE_KEYS.temporary, serialized);
      const verifiedTemporary = decodeSave(store.getItem(SAVE_KEYS.temporary));
      if (!verifiedTemporary.ok)
        return {
          ok: false,
          message: "Save rejected: temporary validation failed.",
          cleanupWarning: null,
        };

      const previousPrimary = decodeSave(store.getItem(SAVE_KEYS.primary));
      const backupCandidate = previousPrimary.ok
        ? previousPrimary.document
        : verifiedTemporary.document;
      store.setItem(
        SAVE_KEYS.backup,
        JSON.stringify(toCurrentSaveStorageDocument(backupCandidate)),
      );
      if (!decodeSave(store.getItem(SAVE_KEYS.backup)).ok)
        return {
          ok: false,
          message:
            "Save rejected: backup validation failed before primary write.",
          cleanupWarning: null,
        };
      store.setItem(SAVE_KEYS.primary, serialized);
      if (!decodeSave(store.getItem(SAVE_KEYS.primary)).ok)
        return {
          ok: false,
          message: "Save rejected: primary validation failed.",
          cleanupWarning: null,
        };
      try {
        store.removeItem(SAVE_KEYS.temporary);
      } catch {
        return {
          ok: true,
          message:
            "Saved explicitly to temporary, primary, and backup recovery slots.",
          cleanupWarning:
            "Primary save committed, but temporary cleanup could not be completed.",
        };
      }
      return {
        ok: true,
        message:
          "Saved explicitly to temporary, primary, and backup recovery slots.",
        cleanupWarning: null,
      };
    } catch {
      return {
        ok: false,
        message: "Save failed safely: browser storage was unavailable.",
        cleanupWarning: null,
      };
    }
  },
});
