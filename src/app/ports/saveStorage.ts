import type { CurrentSave } from "../../domain/types";
import type { SaveLoadFailure } from "../../domain/persistence/saveErrors";

export type LoadedSave =
  | { readonly ok: true; readonly document: CurrentSave; readonly source: "primary" | "backup"; readonly warning: string | null; readonly primaryFailure: Exclude<SaveLoadFailure, "absent"> | null }
  | { readonly ok: false; readonly document: null; readonly source: null; readonly warning: null; readonly failure: SaveLoadFailure; readonly message: string };

export type SaveCommitResult =
  | { readonly ok: true; readonly message: string; readonly cleanupWarning: string | null }
  | { readonly ok: false; readonly message: string; readonly cleanupWarning: null };

/** Application-owned persistence boundary. Only explicit campfire intents call commit. */
export interface SaveStoragePort {
  load(): Promise<LoadedSave>;
  commit(document: CurrentSave): Promise<SaveCommitResult>;
}
