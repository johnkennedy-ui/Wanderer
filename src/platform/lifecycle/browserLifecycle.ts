import type { LifecyclePort } from "../../app/ports/lifecycle";

export interface LifecycleAdapter extends LifecyclePort {
  dispose(): void;
}

/** Browser/Capacitor lifecycle is presentation-only; it never receives a save port. */
export const createBrowserLifecycle = (
  onPresentationPause?: (message: string) => void,
): LifecycleAdapter => {
  const listeners = new Set<(active: boolean) => void>();
  const onVisibility = (): void => {
    const active = document.visibilityState !== "hidden";
    if (!active)
      onPresentationPause?.(
        "Presentation paused. Progress remains runtime-only until explicit campfire Save.",
      );
    for (const listener of listeners) listener(active);
  };
  document.addEventListener("visibilitychange", onVisibility);
  return {
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: (): void =>
      document.removeEventListener("visibilitychange", onVisibility),
  };
};
