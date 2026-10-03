import type { PlacementRejection } from "../notices";
import type { PlacementRequest } from "../placement";
import { isWallBuildingKind, type Vector2 } from "../types";
import { snapBuildingPosition } from "./buildingGeometry";

export const MAX_PLACEMENT_TILES = 64;

export interface NormalizedPlacementPositions {
  readonly positions: readonly Vector2[];
  readonly rejection: PlacementRejection | null;
}

const fallbackPosition: Vector2 = { x: 0, y: 0 };

const safeSnappedPosition = (position: Vector2): Vector2 | null => {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
  const snapped = snapBuildingPosition(position);
  return Number.isSafeInteger(snapped.x) && Number.isSafeInteger(snapped.y)
    ? snapped
    : null;
};

const invalidCoordinates = (
  position: Vector2,
): NormalizedPlacementPositions => ({
  positions: [position],
  rejection: { kind: "invalid-coordinates" },
});

/** Snaps requests to a bounded single tile or an inclusive straight wall line. */
export const placementPositionsFor = (
  request: PlacementRequest,
): NormalizedPlacementPositions => {
  const start = safeSnappedPosition(request.position);
  if (start === null) return invalidCoordinates(fallbackPosition);
  if (
    request.kind === "relocate" ||
    !isWallBuildingKind(request.buildingKind) ||
    request.endPosition === undefined
  )
    return { positions: [start], rejection: null };

  const end = safeSnappedPosition(request.endPosition);
  if (end === null) return invalidCoordinates(start);
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const alongX = Math.abs(deltaX) >= Math.abs(deltaY);
  const delta = alongX ? deltaX : deltaY;
  const direction = Math.sign(delta);
  const count = Math.min(Math.abs(delta) + 1, MAX_PLACEMENT_TILES);
  const positions = Array.from({ length: count }, (_, index) =>
    alongX
      ? { x: start.x + direction * index, y: start.y }
      : { x: start.x, y: start.y + direction * index },
  );
  return { positions, rejection: null };
};
