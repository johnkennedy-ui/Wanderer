import type {
  DestinationCommand,
  MoveCommand,
  Vector2,
} from "../../domain/types";

/** A disposable input source owned by the application composition root. */
export interface InputAdapter {
  dispose(): void;
}

/** Receives explicit movement commands without exposing session ownership. */
export type MoveSink = (command: MoveCommand) => void;

/** Receives explicit destination commands without exposing session ownership. */
export type DestinationSink = (command: DestinationCommand) => void;

/** Receives explicit, disposable placement pointer gestures for the UI. */
export interface WorldPlacementSink {
  tap(position: Vector2): void;
  previewWallDrag(start: Vector2, end: Vector2): void;
  stageWallDrag(start: Vector2, end: Vector2): void;
  clearWallDragPreview(): void;
}
