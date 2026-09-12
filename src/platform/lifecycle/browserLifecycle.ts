import type { LifecyclePort } from "../../app/ports/lifecycle";

export interface LifecycleAdapter extends LifecyclePort {
  dispose(): void;
}
export interface VisibilityDocument {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/** Browser/Capacitor lifecycle is presentation-only; it never receives a save port. */
export const createBrowserLifecycle = (
  onPresentationPause?: (message: string) => void,
  visibilityDocument: VisibilityDocument = document,
): LifecycleAdapter => {
  const listeners = new Set<(active: boolean) => void>();
  let disposed = false;
  const onVisibility = (): void => {
    const active = visibilityDocument.visibilityState !== "hidden";
    if (!active)
      onPresentationPause?.(
        "Presentation paused. Progress remains runtime-only until explicit campfire Save.",
      );
    for (const listener of listeners) listener(active);
  };
  visibilityDocument.addEventListener("visibilitychange", onVisibility);
  return {
    subscribe(listener): () => void {
      listeners.add(listener);
      listener(visibilityDocument.visibilityState !== "hidden");
      return () => listeners.delete(listener);
    },
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      visibilityDocument.removeEventListener("visibilitychange", onVisibility);
      listeners.clear();
    },
  };
};
