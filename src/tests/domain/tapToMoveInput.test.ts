import { describe, expect, it } from "vitest";

import type { DestinationCommand } from "../../domain/types";
import { createTapToMoveInput } from "../../platform/input/tapToMoveInput";

const primaryPointerEvent = (
  type: string,
  pointerId: number,
  clientX: number,
  clientY: number,
): PointerEvent => {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
    isPrimary: { value: true },
    button: { value: 0 },
  });
  return event as PointerEvent;
};

describe("tap-to-move input", () => {
  it("emits enabled primary taps and ignores disabled pointer sequences", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    let enabled = false;
    const commands: DestinationCommand[] = [];
    const input = createTapToMoveInput(
      canvas,
      (clientX, clientY) => ({ x: clientX, y: clientY }),
      () => enabled,
      (command) => commands.push(command),
    );

    canvas.dispatchEvent(primaryPointerEvent("pointerdown", 1, 10, 20));
    canvas.dispatchEvent(primaryPointerEvent("pointerup", 1, 10, 20));
    expect(commands).toHaveLength(0);

    enabled = true;
    canvas.dispatchEvent(primaryPointerEvent("pointerdown", 2, 12, 24));
    canvas.dispatchEvent(primaryPointerEvent("pointerup", 2, 12, 24));
    expect(commands).toMatchObject([
      { destination: { x: 12, y: 24 }, source: "tap-to-move" },
    ]);

    canvas.dispatchEvent(primaryPointerEvent("pointerdown", 3, 14, 28));
    enabled = false;
    canvas.dispatchEvent(primaryPointerEvent("pointerup", 3, 14, 28));
    expect(commands).toHaveLength(1);

    input.dispose();
  });
});
