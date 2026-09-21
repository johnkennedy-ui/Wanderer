import type { ChunkObstacle, Vector2, WorldIdentity } from "../types";
import type { ChunkRecipeSource } from "../session/chunkRecipeCache";
import { generateChunk } from "../world";
import { chunkCoordinateFor } from "./shared";

const LEGACY_ROCK_RADIUS = 0.9;
// Covers the current largest solid terrain radius (1.35m mountains), including
// footprints whose centres belong to a neighbouring chunk.
const TERRAIN_QUERY_PADDING = 1.5;
const MAX_QUERY_CHUNKS = 4096;

const coordinatesCovering = (
  from: Vector2,
  to: Vector2,
): readonly Vector2[] | null => {
  const minimum = chunkCoordinateFor({
    x: Math.min(from.x, to.x) - TERRAIN_QUERY_PADDING,
    y: Math.min(from.y, to.y) - TERRAIN_QUERY_PADDING,
  });
  const maximum = chunkCoordinateFor({
    x: Math.max(from.x, to.x) + TERRAIN_QUERY_PADDING,
    y: Math.max(from.y, to.y) + TERRAIN_QUERY_PADDING,
  });
  if (
    ![minimum.x, minimum.y, maximum.x, maximum.y].every(Number.isSafeInteger) ||
    (maximum.x - minimum.x + 1) * (maximum.y - minimum.y + 1) > MAX_QUERY_CHUNKS
  )
    return null;
  const coordinates: Vector2[] = [];
  for (let y = minimum.y; y <= maximum.y; y += 1)
    for (let x = minimum.x; x <= maximum.x; x += 1) coordinates.push({ x, y });
  return coordinates;
};

const radiusFor = (obstacle: ChunkObstacle): number =>
  obstacle.radius ?? LEGACY_ROCK_RADIUS;

const segmentTouchesCircle = (
  from: Vector2,
  to: Vector2,
  center: Vector2,
  radius: number,
): boolean => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const offsetX = from.x - center.x;
  const offsetY = from.y - center.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0)
    return offsetX * offsetX + offsetY * offsetY <= radius * radius;
  const fraction = Math.max(
    0,
    Math.min(1, -(offsetX * dx + offsetY * dy) / lengthSquared),
  );
  const nearestX = offsetX + dx * fraction;
  const nearestY = offsetY + dy * fraction;
  return nearestX * nearestX + nearestY * nearestY <= radius * radius;
};

/** Tests a whole projectile segment against solid terrain without generating writes. */
export const terrainBlocksProjectileSegment = (
  world: WorldIdentity,
  from: Vector2,
  to: Vector2,
  recipeSource: ChunkRecipeSource = generateChunk,
): boolean => {
  // Invalid or impractically large inputs fail closed, without unbounded
  // recipe generation. This is not the movement resolver's 4m sweep cap.
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) return true;
  const coordinates = coordinatesCovering(from, to);
  if (coordinates === null) return true;
  for (const coordinate of coordinates) {
    const obstacles = recipeSource(world, coordinate).obstacles;
    if (
      obstacles.some(
        (obstacle) =>
          obstacle.kind !== "water" &&
          segmentTouchesCircle(
            from,
            to,
            obstacle.position,
            radiusFor(obstacle),
          ),
      )
    )
      return true;
  }
  return false;
};
