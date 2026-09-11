import type { FrameSchedulerPort, LifecyclePort } from "./ports/lifecycle";
import type { SaveStoragePort } from "./ports/saveStorage";
import type { CurrentSave, ValidCampfireSaveRequest } from "../domain/types";

export interface ApplicationLifecycle {
  dispose(): void;
}

export interface ApplicationBootstrap<TSession> {
  readonly session: TSession;
  readonly platformMessage: string;
}

/** Loads persistence before the composition root creates runtime-facing adapters. */
export const createApplicationBootstrap = async <TSession>(
  storage: Pick<SaveStoragePort, "load">,
  createSession: (saved: CurrentSave | undefined) => TSession,
): Promise<ApplicationBootstrap<TSession>> => {
  const recovered = await storage.load();
  if (recovered.ok)
    return {
      session: createSession(recovered.document),
      platformMessage:
        recovered.warning ?? "Recovered last explicit campfire save.",
    };
  return {
    session: createSession(undefined),
    platformMessage:
      recovered.failure === "absent"
        ? "Fresh runtime: no committed save loaded."
        : `Save was not loaded: ${recovered.message} Existing browser save data was left untouched.`,
  };
};

export interface CampfireSaveSession {
  createValidCampfireSaveRequest(
    committedAt: number,
  ): ValidCampfireSaveRequest | null;
  recordSaveCommitted(document: CurrentSave): void;
}

export interface CampfireSaveIntent {
  save(): Promise<void>;
}

/** Keeps the sole persistence transition behind an explicit valid campfire intent. */
export const createCampfireSaveIntent = (
  session: CampfireSaveSession,
  storage: Pick<SaveStoragePort, "commit">,
  setPlatformMessage: (message: string) => void,
  now: () => number,
): CampfireSaveIntent => {
  let pending = false;
  return {
    async save(): Promise<void> {
      if (pending) return;
      const request = session.createValidCampfireSaveRequest(now());
      if (request === null) {
        setPlatformMessage(
          "Save was not committed: move to a valid campfire first.",
        );
        return;
      }
      pending = true;
      try {
        const result = await storage.commit(request.document);
        if (result.ok) session.recordSaveCommitted(request.document);
        setPlatformMessage(
          result.ok
            ? `${result.message}${result.cleanupWarning === null ? "" : ` ${result.cleanupWarning}`} Save point: ${request.savePointLabel}.`
            : result.message,
        );
      } catch {
        setPlatformMessage("Save failed safely: persistence was unavailable.");
      } finally {
        pending = false;
      }
    },
  };
};

/** Owns frame cancellation and timing reset; lifecycle events never receive storage. */
export const createApplicationLifecycle = (
  lifecycle: LifecyclePort,
  scheduler: FrameSchedulerPort,
  frame: (deltaSeconds: number) => void,
): ApplicationLifecycle => {
  let active = true;
  let disposed = false;
  let handle: number | null = null;
  let previous = scheduler.now();
  const run = (now: number): void => {
    if (!active || disposed) return;
    frame((now - previous) / 1_000);
    previous = now;
    handle = scheduler.request(run);
  };
  const unsubscribe = lifecycle.subscribe((nextActive) => {
    active = nextActive;
    if (!active) {
      if (handle !== null) scheduler.cancel(handle);
      handle = null;
      return;
    }
    previous = scheduler.now();
    if (handle === null) handle = scheduler.request(run);
  });
  if (active && handle === null) handle = scheduler.request(run);
  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (handle !== null) scheduler.cancel(handle);
      handle = null;
      unsubscribe();
      lifecycle.dispose();
    },
  };
};
