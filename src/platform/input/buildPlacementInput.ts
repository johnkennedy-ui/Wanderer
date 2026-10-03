import type { Vector2 } from "../../domain/types";
import type { InputAdapter, WorldPlacementSink } from "./inputContracts";

const MAX_TAP_TRAVEL_PIXELS = 12;
const MIN_WALL_PREVIEW_INTERVAL_MS = 35;

export interface ResettablePlacementInput extends InputAdapter {
  /** Cancels any owned pointer without turning it into a placement command. */
  reset(): void;
}

interface ActivePlacementPointer {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly startWorld: Vector2 | null;
  readonly wallDrag: boolean;
  dragged: boolean;
  hasDraft: boolean;
  lastPreviewAt: number;
  lastPreviewClientX: number;
  lastPreviewClientY: number;
}

/**
 * Owns one primary pointer while a placement mode is active. Walls may stage a
 * line on release; ordinary drags are ignored, and cancellation never places.
 */
export const createBuildPlacementInput = (
  canvas: HTMLCanvasElement,
  worldPositionFromClientPoint: (
    clientX: number,
    clientY: number,
  ) => Vector2 | null,
  isEnabled: () => boolean,
  isWallPlacementEnabled: () => boolean,
  sink: WorldPlacementSink,
): ResettablePlacementInput => {
  let active: ActivePlacementPointer | undefined;
  let disposed = false;

  const now = (): number =>
    typeof performance === "undefined" ? Date.now() : performance.now();

  const releaseCapture = (pointerId: number): void => {
    try {
      if (
        typeof canvas.hasPointerCapture === "function" &&
        canvas.hasPointerCapture(pointerId)
      )
        canvas.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture may already have been released by the browser.
    }
  };

  const clearActive = (release: boolean): void => {
    const pointer = active;
    active = undefined;
    if (pointer === undefined) return;
    if (pointer.hasDraft) sink.clearWallDragPreview();
    if (release) releaseCapture(pointer.pointerId);
  };

  const down = (event: PointerEvent): void => {
    if (
      disposed ||
      active !== undefined ||
      !isEnabled() ||
      !event.isPrimary ||
      event.button !== 0
    )
      return;

    const wallDrag = isWallPlacementEnabled();
    const startWorld = wallDrag
      ? worldPositionFromClientPoint(event.clientX, event.clientY)
      : null;
    if (wallDrag && startWorld === null) return;

    active = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      startWorld,
      wallDrag,
      dragged: false,
      hasDraft: false,
      lastPreviewAt: Number.NEGATIVE_INFINITY,
      lastPreviewClientX: Number.NaN,
      lastPreviewClientY: Number.NaN,
    };
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
      // Continue with the canvas listeners if synthetic/legacy input cannot capture.
    }
    if (event.cancelable) event.preventDefault();
  };

  const move = (event: PointerEvent): void => {
    const pointer = active;
    if (pointer === undefined || pointer.pointerId !== event.pointerId) return;
    if (!isEnabled() || pointer.wallDrag !== isWallPlacementEnabled()) {
      clearActive(true);
      return;
    }
    if (
      Math.hypot(
        event.clientX - pointer.clientX,
        event.clientY - pointer.clientY,
      ) > MAX_TAP_TRAVEL_PIXELS
    )
      pointer.dragged = true;
    if (!pointer.wallDrag || !pointer.dragged) return;

    const position = worldPositionFromClientPoint(event.clientX, event.clientY);
    if (position === null) {
      if (pointer.hasDraft) {
        pointer.hasDraft = false;
        sink.clearWallDragPreview();
      }
      return;
    }

    const timestamp = now();
    if (
      event.clientX === pointer.lastPreviewClientX &&
      event.clientY === pointer.lastPreviewClientY
    )
      return;
    if (timestamp - pointer.lastPreviewAt < MIN_WALL_PREVIEW_INTERVAL_MS)
      return;

    pointer.lastPreviewAt = timestamp;
    pointer.lastPreviewClientX = event.clientX;
    pointer.lastPreviewClientY = event.clientY;
    pointer.hasDraft = true;
    sink.previewWallDrag(pointer.startWorld!, position);
  };

  const up = (event: PointerEvent): void => {
    const pointer = active;
    if (pointer === undefined || pointer.pointerId !== event.pointerId) return;
    active = undefined;
    releaseCapture(pointer.pointerId);

    if (
      disposed ||
      !isEnabled() ||
      pointer.wallDrag !== isWallPlacementEnabled()
    ) {
      if (pointer.hasDraft) sink.clearWallDragPreview();
      return;
    }

    const travel = Math.hypot(
      event.clientX - pointer.clientX,
      event.clientY - pointer.clientY,
    );
    if (
      pointer.wallDrag &&
      (pointer.dragged || travel > MAX_TAP_TRAVEL_PIXELS)
    ) {
      const end = worldPositionFromClientPoint(event.clientX, event.clientY);
      if (end === null) {
        if (pointer.hasDraft) sink.clearWallDragPreview();
        return;
      }
      if (event.cancelable) event.preventDefault();
      sink.stageWallDrag(pointer.startWorld!, end);
      return;
    }

    if (pointer.dragged || travel > MAX_TAP_TRAVEL_PIXELS) {
      if (pointer.hasDraft) sink.clearWallDragPreview();
      return;
    }
    const position = worldPositionFromClientPoint(event.clientX, event.clientY);
    if (position === null) {
      if (pointer.hasDraft) sink.clearWallDragPreview();
      return;
    }
    if (event.cancelable) event.preventDefault();
    sink.tap(position);
  };

  const cancel = (event: PointerEvent): void => {
    if (active?.pointerId === event.pointerId) clearActive(true);
  };

  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", cancel);
  canvas.addEventListener("lostpointercapture", cancel);
  return {
    reset(): void {
      clearActive(true);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearActive(true);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancel);
      canvas.removeEventListener("lostpointercapture", cancel);
    },
  };
};
