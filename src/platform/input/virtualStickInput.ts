import type { MoveCommand, Vector2 } from "../../domain/types";
import type { InputAdapter, MoveSink } from "./keyboardInput";

const STICK_RADIUS = 42;
const DRIFT_THRESHOLD = 0.15;

const command = (intent: Vector2): MoveCommand => ({
  intent,
  source: "virtual-stick",
  at: performance.now(),
});

export const createVirtualStickInput = (
  element: HTMLElement,
  sink: MoveSink,
): InputAdapter => {
  const knob = element.querySelector<HTMLElement>("[data-stick-knob]");
  let activePointer: number | null = null;

  const setVisual = (intent: Vector2): void => {
    if (knob !== null)
      knob.style.transform = `translate(${intent.x * STICK_RADIUS}px, ${intent.y * STICK_RADIUS}px)`;
  };
  const emitFromPointer = (event: PointerEvent): void => {
    const bounds = element.getBoundingClientRect();
    const raw = {
      x:
        (event.clientX - (bounds.left + bounds.width / 2)) / (bounds.width / 2),
      y: -(
        (event.clientY - (bounds.top + bounds.height / 2)) /
        (bounds.height / 2)
      ),
    };
    const length = Math.hypot(raw.x, raw.y);
    const capped = length > 1 ? { x: raw.x / length, y: raw.y / length } : raw;
    const intent =
      Math.hypot(capped.x, capped.y) < DRIFT_THRESHOLD
        ? { x: 0, y: 0 }
        : capped;
    setVisual(intent);
    sink(command(intent));
  };
  const release = (event: PointerEvent): void => {
    if (activePointer !== event.pointerId) return;
    activePointer = null;
    setVisual({ x: 0, y: 0 });
    sink(command({ x: 0, y: 0 }));
  };
  const down = (event: PointerEvent): void => {
    event.preventDefault();
    activePointer = event.pointerId;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic/browser-compatibility pointer events can still use the adapter without capture.
    }
    emitFromPointer(event);
  };
  const move = (event: PointerEvent): void => {
    if (activePointer === event.pointerId) emitFromPointer(event);
  };
  element.addEventListener("pointerdown", down);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", release);
  element.addEventListener("pointercancel", release);
  return {
    dispose(): void {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", release);
      element.removeEventListener("pointercancel", release);
    },
  };
};
