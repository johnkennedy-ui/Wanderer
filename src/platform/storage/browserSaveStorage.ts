import { isSaveDocument, parseSaveDocument } from "../../domain/save";
import type { SaveDocument } from "../../domain/types";

export const SAVE_KEYS = {
  temporary: "wanderer.save.temporary",
  primary: "wanderer.save.primary",
  backup: "wanderer.save.backup",
} as const;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LoadedSave {
  readonly document: SaveDocument | null;
  readonly source: "primary" | "backup" | null;
  readonly warning: string | null;
}

export interface BrowserSaveStorage {
  load(): LoadedSave;
  commit(document: SaveDocument): { ok: boolean; message: string };
}

/**
 * Browser persistence is deliberately an injected platform adapter. The app
 * calls commit only after GameSession issues a valid explicit campfire request.
 */
export const createBrowserSaveStorage = (
  store: KeyValueStore = window.localStorage,
): BrowserSaveStorage => ({
  load(): LoadedSave {
    const primary = parseSaveDocument(store.getItem(SAVE_KEYS.primary));
    if (primary !== null)
      return { document: primary, source: "primary", warning: null };
    const backup = parseSaveDocument(store.getItem(SAVE_KEYS.backup));
    if (backup !== null) {
      return {
        document: backup,
        source: "backup",
        warning:
          "Primary save was absent or invalid; recovered the last valid backup.",
      };
    }
    return { document: null, source: null, warning: null };
  },
  commit(document: SaveDocument): { ok: boolean; message: string } {
    if (!isSaveDocument(document))
      return { ok: false, message: "Save rejected: invalid document." };
    const serialized = JSON.stringify(document);
    try {
      store.setItem(SAVE_KEYS.temporary, serialized);
      const verifiedTemporary = parseSaveDocument(
        store.getItem(SAVE_KEYS.temporary),
      );
      if (verifiedTemporary === null)
        return {
          ok: false,
          message: "Save rejected: temporary validation failed.",
        };

      const previousPrimary = parseSaveDocument(
        store.getItem(SAVE_KEYS.primary),
      );
      store.setItem(
        SAVE_KEYS.backup,
        JSON.stringify(previousPrimary ?? verifiedTemporary),
      );
      store.setItem(SAVE_KEYS.primary, serialized);
      const verifiedPrimary = parseSaveDocument(
        store.getItem(SAVE_KEYS.primary),
      );
      if (verifiedPrimary === null)
        return {
          ok: false,
          message: "Save rejected: primary validation failed.",
        };
      store.removeItem(SAVE_KEYS.temporary);
      return {
        ok: true,
        message:
          "Saved explicitly to temporary, primary, and backup recovery slots.",
      };
    } catch {
      return {
        ok: false,
        message: "Save failed safely: browser storage was unavailable.",
      };
    }
  },
});
