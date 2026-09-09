export interface PlayerHitRecoveryTiming {
  readonly elapsed: number;
  readonly recoveryEndsAt: number;
  readonly recoverySeconds: number;
}

/** Starts one runtime-only recovery window at the end of the current tick. */
export const playerHitRecoveryEndsAtFor = ({
  elapsed,
  recoverySeconds,
}: Pick<PlayerHitRecoveryTiming, "elapsed" | "recoverySeconds">): number =>
  elapsed + recoverySeconds;

/**
 * Returns a deterministic render state for the temporary hit-recovery window.
 * The flash starts on, then alternates by the configured interval until expiry.
 */
export const playerHitRecoveryPresentationFor = ({
  elapsed,
  recoveryEndsAt,
  recoverySeconds,
  flashIntervalSeconds,
}: PlayerHitRecoveryTiming & {
  readonly flashIntervalSeconds: number;
}): { readonly active: boolean; readonly flashOn: boolean } => {
  const remainingSeconds = Math.max(0, recoveryEndsAt - elapsed);
  const active = remainingSeconds > 0;
  if (!active) return { active: false, flashOn: false };

  const elapsedSinceHit = recoverySeconds - remainingSeconds;
  const flashIndex = Math.floor(
    (elapsedSinceHit + 0.000_000_001) / flashIntervalSeconds,
  );
  return { active: true, flashOn: flashIndex % 2 === 0 };
};

/**
 * Integrates normal movement with the protected portion of a frame at the
 * configured multiplier. This keeps a 0.5s window exact even when it expires
 * partway through a simulation step.
 */
export const playerMoveDistanceWithHitRecoveryFor = ({
  baseMoveSpeed,
  frameStartElapsed,
  delta,
  recoveryEndsAt,
  recoverySeconds,
  speedMultiplier,
}: {
  readonly baseMoveSpeed: number;
  readonly frameStartElapsed: number;
  readonly delta: number;
  readonly recoveryEndsAt: number;
  readonly recoverySeconds: number;
  readonly speedMultiplier: number;
}): number => {
  const frameEndElapsed = frameStartElapsed + delta;
  const recoveryStartsAt = recoveryEndsAt - recoverySeconds;
  const protectedSeconds = Math.max(
    0,
    Math.min(frameEndElapsed, recoveryEndsAt) -
      Math.max(frameStartElapsed, recoveryStartsAt),
  );
  return baseMoveSpeed * (delta + protectedSeconds * (speedMultiplier - 1));
};
