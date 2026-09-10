import type { FrameSchedulerPort, LifecyclePort } from "./ports/lifecycle";

export interface ApplicationLifecycle {
  dispose(): void;
}

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
