import type { Vector2 } from "./types";

/** Inputs below this magnitude are stationary and therefore do not suppress attacks. */
export const MOVEMENT_THRESHOLD = 0.08;

const isFiniteVector = (value: Vector2): boolean =>
  Number.isFinite(value.x) && Number.isFinite(value.y);

/**
 * Returns a finite, capped movement intent without retaining caller-owned data.
 * This is policy shared by the session and input adapters, not adapter behaviour.
 */
export const normalizeMovementIntent = (intent: Vector2): Vector2 => {
  if (!isFiniteVector(intent)) return { x: 0, y: 0 };
  const length = Math.hypot(intent.x, intent.y);
  return length > 1
    ? { x: intent.x / length, y: intent.y / length }
    : { x: intent.x, y: intent.y };
};

export const isMeaningfulMovement = (intent: Vector2): boolean =>
  Math.hypot(intent.x, intent.y) >= MOVEMENT_THRESHOLD;
