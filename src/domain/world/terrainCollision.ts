import { distance, roundVector } from "../math";
import type {
  ChunkObstacle,
  EnemyKind,
  Vector2,
  WorldIdentity,
} from "../types";
import { chunkCoordinateFor } from "./shared";
import type { ChunkRecipeSource } from "../session/chunkRecipeCache";
import { generateChunk } from "../world";
import { WANDERER_WEB_V3 } from "./generatorTypes";

const LEGACY_ROCK_RADIUS = 0.9;
const PLAYER_CLEARANCE = 0.28;
const MAX_SWEEP_DISTANCE = 4;
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
/**
 * GameSession projects both axes to two decimals after resolving a sweep. A
 * round can move a point up to sqrt(2) * 0.005 towards an obstacle, so leave
 * a small additional buffer before that projection.
 */
const ROUNDING_CLEARANCE = Math.SQRT2 * 0.005 + 0.0001;
const radiusFor = (radius: number | undefined): number =>
  radius ?? LEGACY_ROCK_RADIUS;

/** Larger enemies reserve more space; the boss is deliberately wider than mobs. */
export const enemyTerrainClearanceFor = (kind: EnemyKind): number => {
  switch (kind) {
    case "boss":
      return 0.62;
    case "brute":
    case "elite":
      return 0.42;
    case "spitter":
      return 0.34;
    default:
      return 0.28;
  }
};

const coordinatesCovering = (
  start: Vector2,
  end: Vector2,
  padding: number,
): readonly Vector2[] => {
  const minimum = chunkCoordinateFor({
    x: Math.min(start.x, end.x) - padding,
    y: Math.min(start.y, end.y) - padding,
  });
  const maximum = chunkCoordinateFor({
    x: Math.max(start.x, end.x) + padding,
    y: Math.max(start.y, end.y) + padding,
  });
  const coordinates: Vector2[] = [];
  for (let y = minimum.y; y <= maximum.y; y += 1)
    for (let x = minimum.x; x <= maximum.x; x += 1) coordinates.push({ x, y });
  return coordinates;
};

const v3ObstaclesFor = (
  world: WorldIdentity,
  start: Vector2,
  end: Vector2,
  clearance: number,
  recipeSource: ChunkRecipeSource,
) => {
  const obstacles: ChunkObstacle[] = [];
  for (const coordinate of coordinatesCovering(start, end, 1.5 + clearance))
    obstacles.push(...recipeSource(world, coordinate).obstacles);
  return obstacles;
};

/**
 * Placement preserves the released V1/V2 rule exactly: only the current
 * chunk's legacy 0.9 footprint matters. V3 additionally checks neighbouring
 * chunk borders and its explicit terrain footprints.
 */
export const terrainBlocksPosition = (
  world: WorldIdentity,
  position: Vector2,
  recipeSource: ChunkRecipeSource = generateChunk,
  clearance = 0,
): boolean => {
  if (world.generatorVersion !== WANDERER_WEB_V3)
    return recipeSource(world, chunkCoordinateFor(position)).obstacles.some(
      (obstacle) => distance(obstacle.position, position) < LEGACY_ROCK_RADIUS,
    );
  return v3ObstaclesFor(
    world,
    position,
    position,
    clearance,
    recipeSource,
  ).some(
    (obstacle) =>
      distance(obstacle.position, position) <
      radiusFor(obstacle.radius) + clearance,
  );
};

/**
 * Finds a deterministic nearby V3 position for runtime-created actors. The
 * finite rings keep a blocked wave spawn from probing unbounded terrain; a
 * local recipe memo prevents repeated checks from churning the session cache.
 * Released V1/V2 runtime spawn positions are returned exactly as authored.
 */
export const nearestTerrainSafePosition = (
  world: WorldIdentity,
  position: Vector2,
  recipeSource: ChunkRecipeSource = generateChunk,
  clearance = 0,
): Vector2 | null => {
  if (world.generatorVersion !== WANDERER_WEB_V3) return position;

  const recipes = new Map<string, ReturnType<ChunkRecipeSource>>();
  const memoizedSource: ChunkRecipeSource = (requestedWorld, coordinate) => {
    const key = `${coordinate.x},${coordinate.y}`;
    const cached = recipes.get(key);
    if (cached !== undefined) return cached;
    const recipe = recipeSource(requestedWorld, coordinate);
    recipes.set(key, recipe);
    return recipe;
  };
  if (!terrainBlocksPosition(world, position, memoizedSource, clearance))
    return position;

  for (const radius of SAFE_SPAWN_RADII)
    for (const direction of SAFE_SPAWN_DIRECTIONS) {
      const candidate = roundVector({
        x: position.x + direction.x * radius,
        y: position.y + direction.y * radius,
      });
      if (!terrainBlocksPosition(world, candidate, memoizedSource, clearance))
        return candidate;
    }
  return null;
};

const cappedDestinationFor = (start: Vector2, desired: Vector2): Vector2 => {
  const dx = desired.x - start.x;
  const dy = desired.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= MAX_SWEEP_DISTANCE) return desired;
  return {
    x: start.x + (dx / length) * MAX_SWEEP_DISTANCE,
    y: start.y + (dy / length) * MAX_SWEEP_DISTANCE,
  };
};

const firstCircleContact = (
  start: Vector2,
  end: Vector2,
  center: Vector2,
  radius: number,
): number | null => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const offsetX = start.x - center.x;
  const offsetY = start.y - center.y;
  const a = dx * dx + dy * dy;
  const c = offsetX * offsetX + offsetY * offsetY - radius * radius;
  if (c < 0) {
    // A rounded position may be fractionally inside an obstacle. It must be
    // allowed to retreat, but must not travel farther inward or tangent through
    // the footprint.
    return dx * offsetX + dy * offsetY > 0 ? null : 0;
  }
  if (a === 0) return null;
  const b = 2 * (offsetX * dx + offsetY * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const contact = (-b - Math.sqrt(discriminant)) / (2 * a);
  return contact >= 0 && contact <= 1 ? contact : null;
};

const roundedPositionIsClearOf = (
  position: Vector2,
  obstacles: readonly ChunkObstacle[],
  clearance: number,
): boolean =>
  obstacles.every(
    (obstacle) =>
      distance(obstacle.position, roundVector(position)) >=
      radiusFor(obstacle.radius) + clearance,
  );

const endpointWithSafeRounding = (
  start: Vector2,
  endpoint: Vector2,
  obstacles: readonly ChunkObstacle[],
  clearance: number,
): Vector2 => {
  if (roundedPositionIsClearOf(endpoint, obstacles, clearance)) return endpoint;
  // A saved/player position can predate V3 terrain and already be rounded into
  // a footprint. Keep the existing resolver's outward-retreat behaviour in
  // that state rather than claiming there is a safe point behind it.
  if (!roundedPositionIsClearOf(start, obstacles, clearance)) return endpoint;

  let safe = start;
  let unsafe = endpoint;
  // The rounded endpoint is the invariant. A fixed, local bisection finds the
  // last two-decimal-safe point without more terrain recipe queries.
  for (let index = 0; index < 16; index += 1) {
    const candidate = {
      x: (safe.x + unsafe.x) / 2,
      y: (safe.y + unsafe.y) / 2,
    };
    if (roundedPositionIsClearOf(candidate, obstacles, clearance))
      safe = candidate;
    else unsafe = candidate;
  }
  return safe;
};

/**
 * Analytic circle sweeping performs one bounded recipe collection per move,
 * rather than nine chunk lookups for every fixed-distance probe. Legacy
 * worlds retain their released unconstrained movement behaviour.
 */
export const sweepTerrainMovement = (
  world: WorldIdentity,
  start: Vector2,
  desired: Vector2,
  recipeSource: ChunkRecipeSource = generateChunk,
  clearance = PLAYER_CLEARANCE,
): Vector2 => {
  if (world.generatorVersion !== WANDERER_WEB_V3) return desired;
  const end = cappedDestinationFor(start, desired);
  const obstacles = v3ObstaclesFor(world, start, end, clearance, recipeSource);
  let firstContact = 1;
  for (const obstacle of obstacles) {
    const contact = firstCircleContact(
      start,
      end,
      obstacle.position,
      radiusFor(obstacle.radius) + clearance,
    );
    if (contact !== null && contact < firstContact) firstContact = contact;
  }
  if (firstContact === 1)
    return endpointWithSafeRounding(start, end, obstacles, clearance);
  const travel = Math.hypot(end.x - start.x, end.y - start.y);
  const safeFraction = Math.max(
    0,
    firstContact - ROUNDING_CLEARANCE / Math.max(travel, 1),
  );
  return endpointWithSafeRounding(
    start,
    {
      x: start.x + (end.x - start.x) * safeFraction,
      y: start.y + (end.y - start.y) * safeFraction,
    },
    obstacles,
    clearance,
  );
};
