import { gameplayTuning } from "../../data/definitions";
import { roundVector } from "../math";
import type { BuildingKind, BuildingState, Vector2 } from "../types";

/** GameSession rounds movement to two decimal places after a sweep. */
const ROUNDING_CLEARANCE = Math.SQRT2 * 0.005 + 0.0001;

const isFinitePosition = (position: Vector2): boolean =>
  Number.isFinite(position.x) && Number.isFinite(position.y);

const tileSize = (): number => gameplayTuning.buildingTileSize;

const normalizeZero = (value: number): number =>
  Object.is(value, -0) ? 0 : value;

/** Snaps a prospective building centre to the deterministic one-metre grid. */
export const snapBuildingPosition = (position: Vector2): Vector2 => {
  if (!isFinitePosition(position)) return { x: position.x, y: position.y };
  const size = tileSize();
  return {
    x: normalizeZero(Math.round(position.x / size) * size),
    y: normalizeZero(Math.round(position.y / size) * size),
  };
};

export const isWallKind = (kind: BuildingKind): boolean =>
  kind === "WoodWall" || kind === "StoneWall";

/** Tile footprints touch at their edges but overlap only when their interiors do. */
export const buildingFootprintsOverlap = (
  leftPosition: Vector2,
  rightPosition: Vector2,
): boolean => {
  if (!isFinitePosition(leftPosition) || !isFinitePosition(rightPosition))
    return false;
  const size = tileSize();
  return (
    Math.abs(leftPosition.x - rightPosition.x) < size &&
    Math.abs(leftPosition.y - rightPosition.y) < size
  );
};

const finiteClearance = (clearance: number): number =>
  Number.isFinite(clearance) ? Math.max(0, clearance) : 0;

const SAFE_SPAWN_RADII = Object.freeze([
  0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6,
] as const);
const SAFE_SPAWN_DIRECTIONS = Object.freeze([
  { x: 1, y: 0 },
  { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  { x: 0, y: 1 },
  { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  { x: -1, y: 0 },
  { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
  { x: 0, y: -1 },
  { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
] as const satisfies readonly Vector2[]);

const walls = (buildings: readonly BuildingState[]): readonly BuildingState[] =>
  buildings.filter((building) => isWallKind(building.kind));

const contains = (
  position: Vector2,
  center: Vector2,
  clearance: number,
): boolean => {
  const halfSize = tileSize() / 2 + clearance;
  return (
    position.x >= center.x - halfSize &&
    position.x <= center.x + halfSize &&
    position.y >= center.y - halfSize &&
    position.y <= center.y + halfSize
  );
};

/** Tests a point against wall squares expanded by an actor/projectile clearance. */
export const wallBlocksPosition = (
  position: Vector2,
  buildings: readonly BuildingState[],
  clearance = 0,
): boolean =>
  isFinitePosition(position) &&
  walls(buildings).some(
    (wall) =>
      isFinitePosition(wall.position) &&
      contains(position, wall.position, finiteClearance(clearance)),
  );

/**
 * Preserves an authored point exactly until a wall conflicts with it, then
 * checks a finite deterministic ring of rounded positions. Callers supply
 * terrain (or another local) blocker for relocated candidates only.
 */
export const nearestWallSafePosition = (
  position: Vector2,
  buildings: readonly BuildingState[],
  clearance = 0,
  isOtherBlocked: (position: Vector2) => boolean = () => false,
): Vector2 | null => {
  if (!isFinitePosition(position)) return null;
  const expandedBy = finiteClearance(clearance);
  if (!wallBlocksPosition(position, buildings, expandedBy)) return position;
  for (const radius of SAFE_SPAWN_RADII)
    for (const direction of SAFE_SPAWN_DIRECTIONS) {
      const candidate = roundVector({
        x: position.x + direction.x * radius,
        y: position.y + direction.y * radius,
      });
      if (
        !wallBlocksPosition(candidate, buildings, expandedBy) &&
        !isOtherBlocked(candidate)
      )
        return candidate;
    }
  return null;
};

interface SegmentHit {
  readonly entry: number;
  readonly exit: number;
}

interface BoundaryNormal {
  readonly x: number;
  readonly y: number;
  readonly distance: number;
}

const segmentHitSquare = (
  from: Vector2,
  to: Vector2,
  center: Vector2,
  clearance: number,
): SegmentHit | null => {
  const halfSize = tileSize() / 2 + clearance;
  const minimumX = center.x - halfSize;
  const maximumX = center.x + halfSize;
  const minimumY = center.y - halfSize;
  const maximumY = center.y + halfSize;
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  let entry = 0;
  let exit = 1;

  for (const [start, delta, minimum, maximum] of [
    [from.x, deltaX, minimumX, maximumX],
    [from.y, deltaY, minimumY, maximumY],
  ] as const) {
    if (delta === 0) {
      if (start < minimum || start > maximum) return null;
      continue;
    }
    const first = (minimum - start) / delta;
    const second = (maximum - start) / delta;
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (entry > exit) return null;
  }
  return { entry, exit };
};

const nearestBoundaryNormals = (
  position: Vector2,
  center: Vector2,
  clearance: number,
): readonly BoundaryNormal[] => {
  const halfSize = tileSize() / 2 + clearance;
  const distances = [
    { x: -1, y: 0, distance: position.x - (center.x - halfSize) },
    { x: 1, y: 0, distance: center.x + halfSize - position.x },
    { x: 0, y: -1, distance: position.y - (center.y - halfSize) },
    { x: 0, y: 1, distance: center.y + halfSize - position.y },
  ] as const;
  const nearest = Math.min(...distances.map((candidate) => candidate.distance));
  return distances.filter((candidate) => candidate.distance <= nearest + 1e-9);
};

const hasOutwardInitialSweep = (
  from: Vector2,
  desired: Vector2,
  center: Vector2,
  clearance: number,
  hit: SegmentHit,
): boolean => {
  const delta = { x: desired.x - from.x, y: desired.y - from.y };
  const nearest = nearestBoundaryNormals(from, center, clearance);
  if (contains(desired, center, clearance))
    return nearest.some(
      (normal) => delta.x * normal.x + delta.y * normal.y > 0,
    );

  const exit = {
    x: from.x + delta.x * hit.exit,
    y: from.y + delta.y * hit.exit,
  };
  const halfSize = tileSize() / 2 + clearance;
  return nearest.some(
    (normal) =>
      (normal.x === -1 && Math.abs(exit.x - (center.x - halfSize)) <= 1e-8) ||
      (normal.x === 1 && Math.abs(exit.x - (center.x + halfSize)) <= 1e-8) ||
      (normal.y === -1 && Math.abs(exit.y - (center.y - halfSize)) <= 1e-8) ||
      (normal.y === 1 && Math.abs(exit.y - (center.y + halfSize)) <= 1e-8),
  );
};

const roundedPositionIsClear = (
  position: Vector2,
  buildings: readonly BuildingState[],
  clearance: number,
): boolean => !wallBlocksPosition(roundVector(position), buildings, clearance);

const endpointWithSafeRounding = (
  start: Vector2,
  endpoint: Vector2,
  buildings: readonly BuildingState[],
  clearance: number,
): Vector2 => {
  if (roundedPositionIsClear(endpoint, buildings, clearance)) return endpoint;
  // Existing saves can start fractionally inside a wall. Their approved
  // outward retreat must not be replaced with a false claim about a safe start.
  if (!roundedPositionIsClear(start, buildings, clearance)) return endpoint;

  let safe = start;
  let unsafe = endpoint;
  for (let index = 0; index < 16; index += 1) {
    const candidate = {
      x: (safe.x + unsafe.x) / 2,
      y: (safe.y + unsafe.y) / 2,
    };
    if (roundedPositionIsClear(candidate, buildings, clearance))
      safe = candidate;
    else unsafe = candidate;
  }
  return safe;
};

/** Includes tangencies and zero-length checks so fast projectiles cannot tunnel. */
export const wallBlocksSegment = (
  from: Vector2,
  to: Vector2,
  buildings: readonly BuildingState[],
  clearance = 0,
): boolean => {
  if (!isFinitePosition(from) || !isFinitePosition(to)) return false;
  const expandedBy = finiteClearance(clearance);
  return walls(buildings).some(
    (wall) =>
      isFinitePosition(wall.position) &&
      segmentHitSquare(from, to, wall.position, expandedBy) !== null,
  );
};

const WALL_ROUTE_MARGIN = ROUNDING_CLEARANCE + 0.0001;
const MAX_WALL_ROUTE_CORNERS = 256;
const ROUTE_DISTANCE_EPSILON = 1e-9;

const wallRouteCorners = (
  buildings: readonly BuildingState[],
  clearance: number,
): readonly Vector2[] => {
  const offset = tileSize() / 2 + clearance + WALL_ROUTE_MARGIN;
  const candidates = new Map<string, Vector2>();
  for (const wall of walls(buildings)) {
    if (!isFinitePosition(wall.position)) continue;
    for (const x of [wall.position.x - offset, wall.position.x + offset])
      for (const y of [wall.position.y - offset, wall.position.y + offset]) {
        const corner = { x, y };
        if (wallBlocksPosition(corner, buildings, clearance)) continue;
        candidates.set(`${x}:${y}`, corner);
      }
  }
  return [...candidates.values()];
};

/**
 * Finds a deterministic shortest visibility path around the current wall
 * tiles. Waypoints deliberately stay outside the rounded actor clearance;
 * callers retain terrain as a separate movement authority.
 */
export const shortestWallRoute = (
  from: Vector2,
  target: Vector2,
  buildings: readonly BuildingState[],
  clearance = 0,
): readonly Vector2[] | null => {
  if (!isFinitePosition(from) || !isFinitePosition(target)) return null;
  const expandedBy = finiteClearance(clearance);
  if (
    wallBlocksPosition(from, buildings, expandedBy) ||
    wallBlocksPosition(target, buildings, expandedBy)
  )
    return null;
  if (!wallBlocksSegment(from, target, buildings, expandedBy)) return [];

  const corners = wallRouteCorners(buildings, expandedBy);
  if (corners.length > MAX_WALL_ROUTE_CORNERS) return null;
  const nodes = [from, ...corners, target];
  const targetIndex = nodes.length - 1;
  const distances = new Array<number>(nodes.length).fill(
    Number.POSITIVE_INFINITY,
  );
  const previous = new Array<number>(nodes.length).fill(-1);
  const remaining = new Set(nodes.map((_, index) => index));
  distances[0] = 0;

  while (remaining.size > 0) {
    let current = -1;
    for (const candidate of remaining)
      if (
        current === -1 ||
        distances[candidate] < distances[current] - ROUTE_DISTANCE_EPSILON ||
        (Math.abs(distances[candidate] - distances[current]) <=
          ROUTE_DISTANCE_EPSILON &&
          candidate < current)
      )
        current = candidate;
    if (current === -1 || !Number.isFinite(distances[current])) break;
    remaining.delete(current);
    if (current === targetIndex) break;

    for (const neighbor of remaining) {
      if (
        wallBlocksSegment(
          nodes[current],
          nodes[neighbor],
          buildings,
          expandedBy,
        )
      )
        continue;
      const edge = Math.hypot(
        nodes[neighbor].x - nodes[current].x,
        nodes[neighbor].y - nodes[current].y,
      );
      const candidate = distances[current] + edge;
      if (candidate < distances[neighbor] - ROUTE_DISTANCE_EPSILON) {
        distances[neighbor] = candidate;
        previous[neighbor] = current;
      }
    }
  }

  if (!Number.isFinite(distances[targetIndex])) return null;
  const route: number[] = [];
  for (let cursor = targetIndex; cursor !== 0; cursor = previous[cursor]) {
    if (cursor === -1) return null;
    route.push(cursor);
  }
  route.reverse();
  return route.slice(0, -1).map((index) => nodes[index]);
};

/**
 * Sweeps a circular actor centre against solid wall tiles. A start inside a
 * wall may move outward, but never through a second wall or deeper into it.
 */
export const sweepWallMovement = (
  from: Vector2,
  desired: Vector2,
  buildings: readonly BuildingState[],
  clearance = 0.28,
): Vector2 => {
  if (!isFinitePosition(from) || !isFinitePosition(desired))
    return { x: from.x, y: from.y };
  const expandedBy = finiteClearance(clearance);
  const deltaX = desired.x - from.x;
  const deltaY = desired.y - from.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance === 0) return { x: from.x, y: from.y };

  let earliestEntry = Number.POSITIVE_INFINITY;
  for (const wall of walls(buildings)) {
    if (!isFinitePosition(wall.position)) continue;
    const startsInside = contains(from, wall.position, expandedBy);
    const hit = segmentHitSquare(from, desired, wall.position, expandedBy);
    if (hit === null) continue;
    if (startsInside) {
      if (
        !hasOutwardInitialSweep(from, desired, wall.position, expandedBy, hit)
      )
        return { x: from.x, y: from.y };
      continue;
    }
    earliestEntry = Math.min(earliestEntry, hit.entry);
  }
  if (!Number.isFinite(earliestEntry))
    return endpointWithSafeRounding(from, desired, buildings, expandedBy);
  const stop = Math.max(
    0,
    earliestEntry - ROUNDING_CLEARANCE / Math.max(distance, 1),
  );
  return endpointWithSafeRounding(
    from,
    { x: from.x + deltaX * stop, y: from.y + deltaY * stop },
    buildings,
    expandedBy,
  );
};
