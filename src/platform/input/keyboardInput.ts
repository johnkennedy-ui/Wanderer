import type { InputSource, MoveCommand, Vector2 } from "../../domain/types";
import type { InputAdapter, MoveSink } from "./inputContracts";

const DIRECTION_BY_KEY: Readonly<Record<string, Vector2>> = {
  w: { x: 0, y: 1 },
  arrowup: { x: 0, y: 1 },
  s: { x: 0, y: -1 },
  arrowdown: { x: 0, y: -1 },
  a: { x: -1, y: 0 },
  arrowleft: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
  arrowright: { x: 1, y: 0 },
};

const command = (intent: Vector2, source: InputSource): MoveCommand => ({
  intent,
  source,
  at: performance.now(),
});

export const createKeyboardInput = (sink: MoveSink): InputAdapter => {
  const pressed = new Set<string>();
  const emit = (): void => {
    const intent = [...pressed].reduce(
      (total, key) => ({
        x: total.x + DIRECTION_BY_KEY[key].x,
        y: total.y + DIRECTION_BY_KEY[key].y,
      }),
      { x: 0, y: 0 },
    );
    sink(command(intent, "keyboard"));
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (DIRECTION_BY_KEY[key] === undefined) return;
    event.preventDefault();
    pressed.add(key);
    emit();
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (DIRECTION_BY_KEY[key] === undefined) return;
    event.preventDefault();
    pressed.delete(key);
    emit();
  };
  const clear = (): void => {
    if (pressed.size === 0) return;
    pressed.clear();
    emit();
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", clear);
  return {
    dispose(): void {
      clear();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clear);
    },
  };
};
