import type { Vector2 } from "../types";

export const CHUNK_SIZE = 16;

export const chunkCoordinateFor = (position: Vector2): Vector2 => ({
  x: Math.floor(position.x / CHUNK_SIZE),
  y: Math.floor(position.y / CHUNK_SIZE),
});

export const chunkKey = (coordinate: Vector2): string =>
  `${coordinate.x},${coordinate.y}`;

export const visibleChunkCoordinates = (
  position: Vector2,
): readonly Vector2[] => {
  const center = chunkCoordinateFor(position);
  return [-1, 0, 1].flatMap((y) =>
    [-1, 0, 1].map((x) => ({ x: center.x + x, y: center.y + y })),
  );
};
