import { describe, expect, it } from "vitest";

import type { DestinationCommand, Vector2 } from "../../domain/types";
import { createBuildPlacementInput } from "../../platform/input/buildPlacementInput";
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
  it("emits ordinary primary taps without a mode toggle", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    const commands: DestinationCommand[] = [];
    const input = createTapToMoveInput(
      canvas,
      (clientX, clientY) => ({ x: clientX, y: clientY }),
      (command) => commands.push(command),
    );

    canvas.dispatchEvent(primaryPointerEvent("pointerdown", 1, 10, 20));
    canvas.dispatchEvent(primaryPointerEvent("pointerup", 1, 10, 20));
    expect(commands).toMatchObject([
      { destination: { x: 10, y: 20 }, source: "tap-to-move" },
    ]);

    canvas.dispatchEvent(primaryPointerEvent("pointerdown", 2, 12, 24));
    canvas.dispatchEvent(primaryPointerEvent("pointerup", 2, 30, 24));
    expect(commands).toHaveLength(1);

    input.dispose();
  });

  it("routes a picked resource node only to harvesting and leaves placement arbitration intact", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    let placementEnabled = false;
    let worldPositionCalls = 0;
    const destinations: DestinationCommand[] = [];
    const harvested: string[] = [];
    const placements: Vector2[] = [];
    const toWorld = (clientX: number, clientY: number): Vector2 => {
      worldPositionCalls += 1;
      return { x: clientX, y: clientY };
    };
    const tapInput = createTapToMoveInput(
      canvas,
      toWorld,
      (command) => destinations.push(command),
      () => placementEnabled,
      {
        pickNodeId: () => "tree:fixture",
        harvestNode: (nodeId) => harvested.push(nodeId),
      },
    );
    const placementInput = createBuildPlacementInput(
      canvas,
      toWorld,
      () => placementEnabled,
      () => false,
      {
        tap: (position) => placements.push(position),
        previewWallDrag: () => {},
        stageWallDrag: () => {},
        clearWallDragPreview: () => {},
      },
    );

    const harvestUp = primaryPointerEvent("pointerup", 1, 10, 20);
    canvas.dispatchEvent(primaryPointerEvent("pointerdown", 1, 10, 20));
    canvas.dispatchEvent(harvestUp);
    expect(harvestUp.defaultPrevented).toBe(true);
    expect(harvested).toEqual(["tree:fixture"]);
    expect(destinations).toHaveLength(0);
    expect(worldPositionCalls).toBe(0);

    placementEnabled = true;
    canvas.dispatchEvent(primaryPointerEvent("pointerdown", 2, 12, 24));
    canvas.dispatchEvent(primaryPointerEvent("pointerup", 2, 12, 24));
    expect(harvested).toEqual(["tree:fixture"]);
    expect(destinations).toHaveLength(0);
    expect(placements).toEqual([{ x: 12, y: 24 }]);

    placementInput.dispose();
    tapInput.dispose();
  });

  it("keeps an enabled world-placement tap separate from tap-to-move", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    let placementEnabled = false;
    const destinations: DestinationCommand[] = [];
    const placements: Vector2[] = [];
    const toWorld = (clientX: number, clientY: number): Vector2 => ({
      x: clientX,
      y: clientY,
    });
    const tapInput = createTapToMoveInput(
      canvas,
      toWorld,
      (command) => destinations.push(command),
      () => placementEnabled,
    );
    const placementInput = createBuildPlacementInput(
      canvas,
      toWorld,
      () => placementEnabled,
      () => false,
      {
        tap: (position) => placements.push(position),
        previewWallDrag: () => {},
        stageWallDrag: () => {},
        clearWallDragPreview: () => {},
      },
    );

    canvas.dispatchEvent(primaryPointerEvent("pointerdown", 1, 10, 20));
    canvas.dispatchEvent(primaryPointerEvent("pointerup", 1, 10, 20));
    expect(destinations).toHaveLength(1);
    expect(placements).toHaveLength(0);

    placementEnabled = true;
    canvas.dispatchEvent(primaryPointerEvent("pointerdown", 2, 12, 24));
    canvas.dispatchEvent(primaryPointerEvent("pointerup", 2, 12, 24));
    expect(destinations).toHaveLength(1);
    expect(placements).toEqual([{ x: 12, y: 24 }]);

    placementInput.dispose();
    tapInput.dispose();
  });
});
