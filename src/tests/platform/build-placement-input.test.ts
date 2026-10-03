import { describe, expect, it, vi } from "vitest";
import { createBuildPlacementInput } from "../../platform/input/buildPlacementInput";
import { createTapToMoveInput } from "../../platform/input/tapToMoveInput";
import type { WorldPlacementSink } from "../../platform/input/inputContracts";

class CanvasDouble extends EventTarget {
  readonly captured = new Set<number>();
  readonly setPointerCapture = vi.fn((pointerId: number) => {
    this.captured.add(pointerId);
  });
  readonly hasPointerCapture = vi.fn((pointerId: number) =>
    this.captured.has(pointerId),
  );
  readonly releasePointerCapture = vi.fn((pointerId: number) => {
    this.captured.delete(pointerId);
  });
}

const asCanvas = (canvas: CanvasDouble): HTMLCanvasElement =>
  canvas as unknown as HTMLCanvasElement;

const pointer = (
  type: string,
  options: {
    readonly pointerId?: number;
    readonly isPrimary?: boolean;
    readonly button?: number;
    readonly clientX?: number;
    readonly clientY?: number;
  } = {},
): PointerEvent => {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId ?? 1 },
    isPrimary: { value: options.isPrimary ?? true },
    button: { value: options.button ?? 0 },
    clientX: { value: options.clientX ?? 0 },
    clientY: { value: options.clientY ?? 0 },
  });
  return event as unknown as PointerEvent;
};

const sinkFor = (): WorldPlacementSink => ({
  tap: vi.fn(),
  previewWallDrag: vi.fn(),
  stageWallDrag: vi.fn(),
  clearWallDragPreview: vi.fn(),
});

const worldPoint = (x: number, y: number) => ({ x: x / 10, y: y / 10 });

describe("captured building placement pointer input", () => {
  it("owns only a primary left tap and excludes the simultaneous tap-to-move adapter", () => {
    const canvas = new CanvasDouble();
    const sink = sinkFor();
    let enabled = true;
    let wallMode = false;
    const move = vi.fn();
    const tapToMove = createTapToMoveInput(
      asCanvas(canvas),
      worldPoint,
      move,
      () => enabled,
    );
    const placement = createBuildPlacementInput(
      asCanvas(canvas),
      worldPoint,
      () => enabled,
      () => wallMode,
      sink,
    );

    canvas.dispatchEvent(pointer("pointerdown", { isPrimary: false }));
    canvas.dispatchEvent(pointer("pointerup", { isPrimary: false }));
    canvas.dispatchEvent(pointer("pointerdown", { button: 2 }));
    canvas.dispatchEvent(pointer("pointerup", { button: 2 }));
    expect(sink.tap).not.toHaveBeenCalled();

    canvas.dispatchEvent(
      pointer("pointerdown", { pointerId: 7, clientX: 30, clientY: 50 }),
    );
    expect(canvas.setPointerCapture).toHaveBeenCalledExactlyOnceWith(7);
    canvas.dispatchEvent(
      pointer("pointerup", { pointerId: 7, clientX: 30, clientY: 50 }),
    );
    expect(sink.tap).toHaveBeenCalledExactlyOnceWith({ x: 3, y: 5 });
    expect(move).not.toHaveBeenCalled();
    expect(canvas.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7);

    placement.dispose();
    tapToMove.dispose();
    enabled = false;
    expect(enabled).toBe(false);
  });

  it("previews a wall drag, stages once on release, and ignores a second pointer", () => {
    const canvas = new CanvasDouble();
    const sink = sinkFor();
    const placement = createBuildPlacementInput(
      asCanvas(canvas),
      worldPoint,
      () => true,
      () => true,
      sink,
    );

    canvas.dispatchEvent(
      pointer("pointerdown", { pointerId: 1, clientX: 10, clientY: 20 }),
    );
    canvas.dispatchEvent(
      pointer("pointerdown", { pointerId: 2, clientX: 80, clientY: 80 }),
    );
    canvas.dispatchEvent(
      pointer("pointermove", { pointerId: 2, clientX: 100, clientY: 80 }),
    );
    expect(sink.previewWallDrag).not.toHaveBeenCalled();

    canvas.dispatchEvent(
      pointer("pointermove", { pointerId: 1, clientX: 50, clientY: 20 }),
    );
    expect(sink.previewWallDrag).toHaveBeenCalledExactlyOnceWith(
      { x: 1, y: 2 },
      { x: 5, y: 2 },
    );
    canvas.dispatchEvent(
      pointer("pointerup", { pointerId: 2, clientX: 100, clientY: 80 }),
    );
    expect(sink.stageWallDrag).not.toHaveBeenCalled();
    canvas.dispatchEvent(
      pointer("pointerup", { pointerId: 1, clientX: 60, clientY: 20 }),
    );
    expect(sink.stageWallDrag).toHaveBeenCalledExactlyOnceWith(
      { x: 1, y: 2 },
      { x: 6, y: 2 },
    );
    expect(sink.tap).not.toHaveBeenCalled();
    expect(sink.clearWallDragPreview).not.toHaveBeenCalled();
    placement.dispose();
  });

  it.each([10, 14, 22])(
    "stages a wall drag that returns near its origin at x=%s without confirming",
    (endX) => {
      const canvas = new CanvasDouble();
      const sink = sinkFor();
      const clock = vi.spyOn(performance, "now").mockReturnValue(100);
      const placement = createBuildPlacementInput(
        asCanvas(canvas),
        worldPoint,
        () => true,
        () => true,
        sink,
      );
      canvas.dispatchEvent(
        pointer("pointerdown", { clientX: 10, clientY: 20 }),
      );
      canvas.dispatchEvent(
        pointer("pointermove", { clientX: 60, clientY: 20 }),
      );
      clock.mockReturnValue(150);
      canvas.dispatchEvent(
        pointer("pointermove", { clientX: endX, clientY: 20 }),
      );
      canvas.dispatchEvent(
        pointer("pointerup", { clientX: endX, clientY: 20 }),
      );
      clock.mockRestore();
      placement.dispose();

      expect(sink.tap).not.toHaveBeenCalled();
      expect(sink.previewWallDrag).toHaveBeenCalledTimes(2);
      expect(sink.previewWallDrag).toHaveBeenLastCalledWith(
        { x: 1, y: 2 },
        { x: endX / 10, y: 2 },
      );
      expect(sink.stageWallDrag).toHaveBeenCalledExactlyOnceWith(
        { x: 1, y: 2 },
        { x: endX / 10, y: 2 },
      );
    },
  );

  it("ignores a non-wall drag that returns to its starting point", () => {
    const canvas = new CanvasDouble();
    const sink = sinkFor();
    const placement = createBuildPlacementInput(
      asCanvas(canvas),
      worldPoint,
      () => true,
      () => false,
      sink,
    );
    canvas.dispatchEvent(pointer("pointerdown", { clientX: 10, clientY: 20 }));
    canvas.dispatchEvent(pointer("pointermove", { clientX: 60, clientY: 20 }));
    canvas.dispatchEvent(pointer("pointermove", { clientX: 10, clientY: 20 }));
    canvas.dispatchEvent(pointer("pointerup", { clientX: 10, clientY: 20 }));
    placement.dispose();

    expect(sink.tap).not.toHaveBeenCalled();
    expect(sink.previewWallDrag).not.toHaveBeenCalled();
    expect(sink.stageWallDrag).not.toHaveBeenCalled();
  });

  it("never commits on pointercancel, lost capture, mode reset, or dispose", () => {
    const canvas = new CanvasDouble();
    const sink = sinkFor();
    const placement = createBuildPlacementInput(
      asCanvas(canvas),
      worldPoint,
      () => true,
      () => true,
      sink,
    );

    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 4 }));
    canvas.dispatchEvent(pointer("pointermove", { pointerId: 4, clientX: 20 }));
    canvas.dispatchEvent(pointer("pointercancel", { pointerId: 4 }));
    canvas.dispatchEvent(pointer("pointerup", { pointerId: 4, clientX: 30 }));
    expect(sink.stageWallDrag).not.toHaveBeenCalled();
    expect(sink.clearWallDragPreview).toHaveBeenCalledOnce();
    expect(canvas.captured.has(4)).toBe(false);

    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 5 }));
    canvas.dispatchEvent(pointer("pointermove", { pointerId: 5, clientX: 25 }));
    canvas.dispatchEvent(pointer("lostpointercapture", { pointerId: 5 }));
    canvas.dispatchEvent(pointer("pointerup", { pointerId: 5, clientX: 30 }));
    expect(sink.stageWallDrag).not.toHaveBeenCalled();
    expect(sink.clearWallDragPreview).toHaveBeenCalledTimes(2);

    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 6 }));
    placement.reset();
    canvas.dispatchEvent(pointer("pointerup", { pointerId: 6 }));
    expect(sink.tap).not.toHaveBeenCalled();
    expect(sink.stageWallDrag).not.toHaveBeenCalled();

    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 8 }));
    canvas.dispatchEvent(pointer("pointermove", { pointerId: 8, clientX: 30 }));
    placement.dispose();
    canvas.dispatchEvent(pointer("pointerup", { pointerId: 8, clientX: 40 }));
    expect(sink.stageWallDrag).not.toHaveBeenCalled();
    expect(sink.clearWallDragPreview).toHaveBeenCalledTimes(3);
    expect(canvas.captured.has(8)).toBe(false);
  });

  it("cancels a non-wall gesture on a mode change rather than forwarding a stale tap", () => {
    const canvas = new CanvasDouble();
    const sink = sinkFor();
    const placement = createBuildPlacementInput(
      asCanvas(canvas),
      worldPoint,
      () => true,
      () => false,
      sink,
    );
    canvas.dispatchEvent(pointer("pointerdown", { pointerId: 9 }));
    placement.reset();
    canvas.dispatchEvent(pointer("pointerup", { pointerId: 9 }));
    expect(sink.tap).not.toHaveBeenCalled();
    expect(canvas.captured.has(9)).toBe(false);
    placement.dispose();
  });
});
