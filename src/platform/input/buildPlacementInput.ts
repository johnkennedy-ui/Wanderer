import type { Vector2 } from "../../domain/types";
import type { InputAdapter, WorldPlacementSink } from "./inputContracts";

const MAX_TAP_TRAVEL_PIXELS = 12;

/**
 * Translates one enabled primary canvas tap into a UI-owned building-placement
 * position. The composition root keeps this mutually exclusive with
 * tap-to-move, so this adapter never reaches into gameplay state directly.
 */
export const createBuildPlacementInput = (
  canvas: HTMLCanvasElement,
  worldPositionFromClientPoint: (
    clientX: number,
    clientY: number,
  ) => Vector2 | null,
  isEnabled: () => boolean,
  sink: WorldPlacementSink,
): InputAdapter => {
  let pendingTap:
    | {
        readonly pointerId: number;
        readonly clientX: number;
        readonly clientY: number;
      }
    | undefined;

  const down = (event: PointerEvent): void => {
    if (!isEnabled() || !event.isPrimary || event.button !== 0) return;
    pendingTap = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    };
  };
  const clear = (event: PointerEvent): void => {
    if (pendingTap?.pointerId === event.pointerId) pendingTap = undefined;
  };
  const up = (event: PointerEvent): void => {
    const tap = pendingTap;
    pendingTap = undefined;
    if (
      tap === undefined ||
      tap.pointerId !== event.pointerId ||
      !isEnabled() ||
      Math.hypot(event.clientX - tap.clientX, event.clientY - tap.clientY) >
        MAX_TAP_TRAVEL_PIXELS
    )
      return;
    const position = worldPositionFromClientPoint(event.clientX, event.clientY);
    if (position === null) return;
    event.preventDefault();
    sink(position);
  };

  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", clear);
  return {
    dispose(): void {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", clear);
      pendingTap = undefined;
    },
  };
};
