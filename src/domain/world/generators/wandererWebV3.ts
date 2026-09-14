import type {
  ChunkObstacle,
  ChunkRecipe,
  Vector2,
  WorldIdentity,
} from "../../types";
import type { ChunkGenerator } from "../generatorTypes";
import { CHUNK_SIZE, chunkKey } from "../shared";
import { deriveDomainSeed } from "./wandererWebV1";
import { generateWandererWebV2Chunk } from "./wandererWebV2";

const TERRAIN_ACTOR_CLEARANCE = 0.8;
const TERRAIN_GAP = 0.16;
const RIVER_RADIUS = 1.1;
const RIVER_SPACING = 1.35;
const RIVER_FORD_HALF_HEIGHT = 2.2;

const unit = (seed: number, offset: number): number => {
  let hash = seed ^ Math.imul(offset + 1, 0x9e3779b1);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0xffffffff;
};

const hashText = (text: string): number => {
  let hash = 2_166_136_261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

const idFor = (
  world: WorldIdentity,
  coordinate: Vector2,
  kind: string,
  index: number,
) =>
  `${kind}:${world.generatorVersion}:${world.seed}:${coordinate.x}:${coordinate.y}:${index}`;

const positiveModulo = (value: number, divisor: number): number =>
  ((value % divisor) + divisor) % divisor;

const wrappedDistance = (value: number, period: number): number =>
  Math.min(
    positiveModulo(value, period),
    period - positiveModulo(value, period),
  );

const distanceBetween = (left: Vector2, right: Vector2): number =>
  Math.hypot(left.x - right.x, left.y - right.y);

const riverXFor = (world: WorldIdentity, y: number): number => {
  const seed = hashText(`${world.seed}|wanderer-web-v3|river`);
  const base = (seed % 193) - 96;
  return base + Math.sin(y * 0.11 + (seed % 628) / 100) * 2.2;
};

const periodicRiverFordAt = (world: WorldIdentity, y: number): boolean => {
  const offset = hashText(`${world.seed}|wanderer-web-v3|ford`) % 48;
  return wrappedDistance(y - offset, 48) < RIVER_FORD_HALF_HEIGHT;
};

/** Keep the authored home, starter spawns, and initial build corridor clear. */
const isHomeApproach = (position: Vector2): boolean =>
  position.x >= -6 && position.x <= 10 && position.y >= -6 && position.y <= 15;

/** A fixed broad home ford prevents the starting settlement from being split. */
const isHomeFordAt = (position: Vector2): boolean =>
  position.y >= -8 && position.y <= 17;

const nearbyActorsFor = (world: WorldIdentity, coordinate: Vector2) => {
  const actors: { readonly position: Vector2 }[] = [];
  for (let y = coordinate.y - 1; y <= coordinate.y + 1; y += 1)
    for (let x = coordinate.x - 1; x <= coordinate.x + 1; x += 1) {
      const recipe = generateWandererWebV2Chunk(world, { x, y });
      actors.push(...recipe.campfires, ...recipe.spawns);
    }
  return actors;
};

const isSafeFromActors = (
  obstacle: ChunkObstacle,
  actors: readonly { readonly position: Vector2 }[],
): boolean =>
  actors.every(
    (actor) =>
      distanceBetween(actor.position, obstacle.position) >=
      (obstacle.radius ?? 0) + TERRAIN_ACTOR_CLEARANCE,
  );

/**
 * Every gap is a deterministic crossing: fixed-period fords are supplemented
 * by a full ford band around an authored actor that would otherwise be
 * intersected. The band is wider than the overlapping river discs.
 */
const isRiverCrossingAt = (
  world: WorldIdentity,
  position: Vector2,
  actors: readonly { readonly position: Vector2 }[],
): boolean =>
  periodicRiverFordAt(world, position.y) ||
  isHomeFordAt(position) ||
  actors.some(
    (actor) =>
      Math.abs(actor.position.y - position.y) <= RIVER_FORD_HALF_HEIGHT &&
      Math.abs(actor.position.x - riverXFor(world, actor.position.y)) <=
        RIVER_RADIUS + TERRAIN_ACTOR_CLEARANCE + 0.6,
  );

const isSeparatedFromSolids = (
  candidate: ChunkObstacle,
  solids: readonly ChunkObstacle[],
): boolean =>
  solids.every(
    (obstacle) =>
      distanceBetween(obstacle.position, candidate.position) >=
      (obstacle.radius ?? 0) + (candidate.radius ?? 0) + TERRAIN_GAP,
  );

const riverFor = (
  world: WorldIdentity,
  coordinate: Vector2,
  actors: readonly { readonly position: Vector2 }[],
): ChunkObstacle[] => {
  const originY = coordinate.y * CHUNK_SIZE;
  const river: ChunkObstacle[] = [];
  for (let index = 0; index < 12; index += 1) {
    const y = originY + 0.65 + index * RIVER_SPACING;
    const x = riverXFor(world, y);
    const position = { x, y };
    if (
      Math.floor(x / CHUNK_SIZE) !== coordinate.x ||
      isRiverCrossingAt(world, position, actors)
    )
      continue;
    river.push({
      id: idFor(world, coordinate, "water-river", index),
      kind: "water",
      waterKind: "river",
      radius: RIVER_RADIUS,
      position,
    });
  }
  return river;
};

const coordinatesAround = (coordinate: Vector2): readonly Vector2[] => {
  const coordinates: Vector2[] = [];
  for (let y = coordinate.y - 1; y <= coordinate.y + 1; y += 1)
    for (let x = coordinate.x - 1; x <= coordinate.x + 1; x += 1)
      coordinates.push({ x, y });
  return coordinates;
};

const riversAroundFor = (
  world: WorldIdentity,
  coordinate: Vector2,
): ChunkObstacle[] => {
  const rivers: ChunkObstacle[] = [];
  for (const nearby of coordinatesAround(coordinate))
    rivers.push(...riverFor(world, nearby, nearbyActorsFor(world, nearby)));
  return rivers;
};

const lakeFor = (
  world: WorldIdentity,
  coordinate: Vector2,
  actors: readonly { readonly position: Vector2 }[],
  river: readonly ChunkObstacle[],
): readonly ChunkObstacle[] => {
  const macro = {
    x: Math.floor(coordinate.x / 4),
    y: Math.floor(coordinate.y / 4),
  };
  const selected =
    hashText(`${world.seed}|wanderer-web-v3|lake|${chunkKey(macro)}`) % 16;
  const local =
    positiveModulo(coordinate.y, 4) * 4 + positiveModulo(coordinate.x, 4);
  if (local !== selected) return [];
  const seed = deriveDomainSeed(world, coordinate, "terrain");
  const origin = { x: coordinate.x * CHUNK_SIZE, y: coordinate.y * CHUNK_SIZE };
  const center = {
    x: origin.x + 4.5 + unit(seed, 30) * 7,
    y: origin.y + 4.5 + unit(seed, 31) * 7,
  };
  const lake: ChunkObstacle[] = [
    { x: -0.85, y: 0 },
    { x: 0.85, y: 0 },
    { x: 0, y: 0.85 },
  ].map((offset, index) => ({
    id: idFor(world, coordinate, "water-lake", index),
    kind: "water",
    waterKind: "lake",
    radius: 1.05,
    position: { x: center.x + offset.x, y: center.y + offset.y },
  }));
  return lake.every(
    (cell) =>
      !isHomeApproach(cell.position) &&
      isSafeFromActors(cell, actors) &&
      isSeparatedFromSolids(cell, river),
  )
    ? lake
    : [];
};

const waterAroundFor = (
  world: WorldIdentity,
  coordinate: Vector2,
): ChunkObstacle[] => {
  const rivers = riversAroundFor(world, coordinate);
  const water = [...rivers];
  for (const nearby of coordinatesAround(coordinate))
    water.push(
      ...lakeFor(world, nearby, nearbyActorsFor(world, nearby), rivers),
    );
  return water;
};

/**
 * New-world terrain. V1/V2 are invoked unchanged. Water is generated before
 * every solid so its connected river/lake geometry is never chipped away by
 * scenery; only declared ford bands may interrupt a river.
 */
export const generateWandererWebV3Chunk: ChunkGenerator = (
  world,
  coordinate,
): ChunkRecipe => {
  const base = generateWandererWebV2Chunk(world, coordinate);
  const seed = deriveDomainSeed(world, coordinate, "terrain");
  const origin = { x: coordinate.x * CHUNK_SIZE, y: coordinate.y * CHUNK_SIZE };
  const actors = nearbyActorsFor(world, coordinate);
  const nearbyWater = waterAroundFor(world, coordinate);
  const river = riverFor(world, coordinate, actors);
  const water = [
    ...river,
    ...lakeFor(
      world,
      coordinate,
      actors,
      nearbyWater.filter((obstacle) => obstacle.waterKind === "river"),
    ),
  ];
  const retainedRocks: ChunkObstacle[] = base.obstacles.map((obstacle) => ({
    ...obstacle,
    kind: "rock",
    radius: 0.38,
  }));
  const scenery: ChunkObstacle[] = [
    ...[0, 1, 2].map<ChunkObstacle>((index) => ({
      id: idFor(world, coordinate, "tree", index),
      kind: "tree",
      radius: 0.65,
      position: {
        x: origin.x + 1.5 + unit(seed, index * 2) * 13,
        y: origin.y + 1.5 + unit(seed, index * 2 + 1) * 13,
      },
    })),
    {
      id: idFor(world, coordinate, "mountain", 0),
      kind: "mountain",
      radius: 1.35,
      position: {
        x: origin.x + 2.5 + unit(seed, 10) * 11,
        y: origin.y + 2.5 + unit(seed, 11) * 11,
      },
    },
  ];
  const solids: ChunkObstacle[] = [];
  for (const candidate of [...retainedRocks, ...scenery]) {
    if (
      !isHomeApproach(candidate.position) &&
      isSafeFromActors(candidate, actors) &&
      isSeparatedFromSolids(candidate, [...nearbyWater, ...solids])
    )
      solids.push(candidate);
  }
  return { ...base, obstacles: [...water, ...solids] };
};
