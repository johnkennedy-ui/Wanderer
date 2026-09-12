import type {
  LoadedSave,
  SaveCommitResult,
  SaveStoragePort,
} from "../../app/ports/saveStorage";
import type { CurrentSave } from "../../domain/types";

/** Test-only port fake; it deliberately has no browser-key or recovery authority. */
export class MemorySaveStorage implements SaveStoragePort {
  readonly commits: CurrentSave[] = [];
  constructor(private readonly loaded: LoadedSave) {}

  async load(): Promise<LoadedSave> {
    return this.loaded;
  }

  async commit(document: CurrentSave): Promise<SaveCommitResult> {
    this.commits.push(document);
    return { ok: true, message: "Saved explicitly.", cleanupWarning: null };
  }
}
