export interface LifecycleAdapter {
  dispose(): void;
}

/** Browser/Capacitor lifecycle is presentation-only; it never receives a save port. */
export const createBrowserLifecycle = (
  onPresentationPause: (message: string) => void,
): LifecycleAdapter => {
  const onVisibility = (): void => {
    if (document.visibilityState === "hidden")
      onPresentationPause(
        "Presentation paused. Progress remains runtime-only until explicit campfire Save.",
      );
  };
  document.addEventListener("visibilitychange", onVisibility);
  return {
    dispose: (): void =>
      document.removeEventListener("visibilitychange", onVisibility),
  };
};
