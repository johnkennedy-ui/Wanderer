import type { DestinationCommand, MoveCommand } from "../../domain/types";

/** A disposable input source owned by the application composition root. */
export interface InputAdapter {
  dispose(): void;
}

/** Receives explicit movement commands without exposing session ownership. */
export type MoveSink = (command: MoveCommand) => void;

/** Receives explicit destination commands without exposing session ownership. */
export type DestinationSink = (command: DestinationCommand) => void;
