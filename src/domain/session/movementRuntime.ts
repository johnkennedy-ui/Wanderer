import { gameplayTuning } from "../../data/definitions";
import { add, magnitude, normalize, roundVector, scale } from "../math";
import { normalizeMovementIntent } from "../inputPolicy";
import type { GameNotice } from "../notices";
import type {
  BuildingState,
  DestinationCommand,
  MoveCommand,
  Vector2,
  WorldIdentity,
} from "../types";
import { sweepTerrainMovement } from "../world/terrainCollision";
import type { ChunkRecipeSource } from "./chunkRecipeCache";
import { playerMoveDistanceWithHitRecoveryFor } from "./hitRecoveryPolicy";
import { sweepWallMovement } from "./buildingGeometry";

const isFinitePosition = (position: Vector2): boolean =>
  Number.isFinite(position.x) && Number.isFinite(position.y);

export const moveStateFor = (
  command: MoveCommand,
): { readonly input: MoveCommand; readonly destination: null } => ({
  destination: null,
  input: {
    intent: normalizeMovementIntent(command.intent),
    source: command.source,
    at: command.at,
  },
});

export type DestinationStateResult =
  | {
      readonly ok: true;
      readonly input: MoveCommand;
      readonly destination: Vector2;
    }
  | { readonly ok: false; readonly notice: GameNotice };

export const destinationStateFor = (
  command: DestinationCommand,
): DestinationStateResult => {
  if (!isFinitePosition(command.destination))
    return {
      ok: false,
      notice: { kind: "tap-to-move.rejected.invalid-destination" },
    };
  return {
    ok: true,
    destination: roundVector(command.destination),
    input: {
      intent: { x: 0, y: 0 },
      source: command.source,
      at: command.at,
    },
  };
};

export const playerMoveDistanceFor = ({
  baseMoveSpeed,
  frameStartElapsed,
  delta,
  recoveryEndsAt,
}: {
  readonly baseMoveSpeed: number;
  readonly frameStartElapsed: number;
  readonly delta: number;
  readonly recoveryEndsAt: number;
}): number =>
  playerMoveDistanceWithHitRecoveryFor({
    baseMoveSpeed,
    frameStartElapsed,
    delta,
    recoveryEndsAt,
    recoverySeconds: gameplayTuning.playerHitRecoverySeconds,
    speedMultiplier: gameplayTuning.playerHitRecoverySpeedMultiplier,
  });

/** Both collision resolvers shorten one segment, so neither can undo contact. */
export const constrainMovement = ({
  world,
  from,
  desired,
  chunkRecipeSource,
  buildings,
  clearance = 0.28,
}: {
  readonly world: WorldIdentity;
  readonly from: Vector2;
  readonly desired: Vector2;
  readonly chunkRecipeSource: ChunkRecipeSource;
  readonly buildings: readonly BuildingState[];
  readonly clearance?: number;
}): Vector2 =>
  sweepWallMovement(
    from,
    sweepTerrainMovement(world, from, desired, chunkRecipeSource, clearance),
    buildings,
    clearance,
  );

export interface DestinationMovementResult {
  readonly playerPosition: Vector2;
  readonly input: MoveCommand;
  readonly destination: Vector2 | null;
  /** True only while a destination remains active for the next frame. */
  readonly moving: boolean;
}

/**
 * Advances only a tap destination. The caller retains all authoritative state
 * and applies this feature-specific result at its existing tick boundary.
 */
export const advanceDestinationMovement = ({
  playerPosition,
  input,
  destination,
  elapsed,
  maximumTravel,
  world,
  chunkRecipeSource,
  buildings,
}: {
  readonly playerPosition: Vector2;
  readonly input: MoveCommand;
  readonly destination: Vector2 | null;
  readonly elapsed: number;
  readonly maximumTravel: number;
  readonly world: WorldIdentity;
  readonly chunkRecipeSource: ChunkRecipeSource;
  readonly buildings: readonly BuildingState[];
}): DestinationMovementResult => {
  if (destination === null)
    return { playerPosition, input, destination, moving: false };

  const offset = {
    x: destination.x - playerPosition.x,
    y: destination.y - playerPosition.y,
  };
  const remainingDistance = magnitude(offset);
  const stoppedInput: MoveCommand = {
    intent: { x: 0, y: 0 },
    source: "system",
    at: elapsed,
  };
  if (
    remainingDistance <= gameplayTuning.tapToMoveArrivalDistance ||
    maximumTravel >= remainingDistance
  )
    return {
      playerPosition: roundVector(
        constrainMovement({
          world,
          from: playerPosition,
          desired: destination,
          chunkRecipeSource,
          buildings,
        }),
      ),
      input: stoppedInput,
      destination: null,
      moving: false,
    };

  const desired = add(playerPosition, scale(normalize(offset), maximumTravel));
  const next = roundVector(
    constrainMovement({
      world,
      from: playerPosition,
      desired,
      chunkRecipeSource,
      buildings,
    }),
  );
  if (next.x === playerPosition.x && next.y === playerPosition.y) {
    // Keep a tap alive when its unconstrained two-decimal movement is too
    // small to advance this frame. Terrain may adjust that sub-quantum sweep,
    // so equality with `desired` is not the signal for cancellation.
    const unconstrainedNext = roundVector(desired);
    if (
      unconstrainedNext.x === playerPosition.x &&
      unconstrainedNext.y === playerPosition.y
    )
      return { playerPosition, input, destination, moving: true };
    return {
      playerPosition,
      input: stoppedInput,
      destination: null,
      moving: false,
    };
  }
  return { playerPosition: next, input, destination, moving: true };
};
