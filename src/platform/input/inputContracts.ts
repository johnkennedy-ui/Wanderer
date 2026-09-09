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

/** Receives a canvas-derived world position for a UI-owned placement mode. */
export type WorldPlacementSink = (position: Vector2) => void;
