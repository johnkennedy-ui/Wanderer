import type {
  ChunkObstacle,
  ChunkRecipe,
  Vector2,
  WorldIdentity,
} from "../../types";
import type { ChunkGenerator } from "../generatorTypes";
import { CHUNK_SIZE } from "../shared";
import { deriveDomainSeed } from "./wandererWebV1";
import { generateWandererWebV3Chunk } from "./wandererWebV3";

const WILD_CAMPFIRE_CHANCE_DENOMINATOR = 100;
const PLAYER_COLLISION_DIAMETER = 0.56;
const RANGE_MACRO_CHUNKS = 40;
const RANGE_SPACING = 1.5;
const RANGE_PEAK_RADIUS = 0.68;
const RANGE_CROSSING_INTERVAL = 8;
const ISLAND_CELL_CHUNKS = 40;
const ISLAND_RADIUS_MIN_CHUNKS = 18;
const ISLAND_RADIUS_VARIANCE_CHUNKS = 0.5;
const SEA_FOOTPRINT_RADIUS = 15;
const RIVER_SPACING = 1.35;
const RIVER_RADIUS = 1.1;
const RIVER_FORD_INTERVAL = 36;
const RIVER_FORD_HALF_WIDTH = 2.4;

const islandCoordinateForChunk = (coordinate: Vector2): Vector2 => ({
  x: Math.floor((coordinate.x + ISLAND_CELL_CHUNKS / 2) / ISLAND_CELL_CHUNKS),
  y: Math.floor((coordinate.y + ISLAND_CELL_CHUNKS / 2) / ISLAND_CELL_CHUNKS),
});

export interface IslandDescriptor {
  readonly coordinate: Vector2;
  readonly center: Vector2;
  readonly radius: number;
}

/** A deterministic finite island at each cell of an unbounded chunk lattice. */
export const islandDescriptorFor = (
  world: WorldIdentity,
  coordinate: Vector2,
): IslandDescriptor => {
  const seed = deriveDomainSeed(world, coordinate, "terrain");
  return {
    coordinate,
    center: {
      x: coordinate.x * ISLAND_CELL_CHUNKS * CHUNK_SIZE,
      y: coordinate.y * ISLAND_CELL_CHUNKS * CHUNK_SIZE,
    },
    radius:
      CHUNK_SIZE *
      (ISLAND_RADIUS_MIN_CHUNKS +
        unit(seed, 90) * ISLAND_RADIUS_VARIANCE_CHUNKS),
  };
};

const islandForPosition = (
  world: WorldIdentity,
  position: Vector2,
): IslandDescriptor => {
  const macro = {
    x: Math.floor(position.x / (ISLAND_CELL_CHUNKS * CHUNK_SIZE) + 0.5),
    y: Math.floor(position.y / (ISLAND_CELL_CHUNKS * CHUNK_SIZE) + 0.5),
  };
  return islandDescriptorFor(world, macro);
};

export const isLandPosition = (
  world: WorldIdentity,
  position: Vector2,
): boolean => {
  const island = islandForPosition(world, position);
  return (
    Math.hypot(position.x - island.center.x, position.y - island.center.y) <=
    island.radius
  );
};

const isLandChunk = (world: WorldIdentity, coordinate: Vector2): boolean =>
  isLandPosition(world, {
    x: (coordinate.x + 0.5) * CHUNK_SIZE,
    y: (coordinate.y + 0.5) * CHUNK_SIZE,
  });

const riverDescriptorFor = (world: WorldIdentity, island: IslandDescriptor) => {
  const seed = deriveDomainSeed(world, island.coordinate, "terrain");
  const isHomeIsland = island.coordinate.x === 0 && island.coordinate.y === 0;
  const start = isHomeIsland
    ? {
        x: island.center.x + CHUNK_SIZE * 8,
        y: island.center.y + CHUNK_SIZE * 8,
      }
    : island.center;
  const angle = isHomeIsland
    ? (unit(seed, 91) - 0.5) * (Math.PI / 2)
    : unit(seed, 91) * Math.PI * 2;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const ox = start.x - island.center.x;
  const oy = start.y - island.center.y;
  const projection = ox * dx + oy * dy;
  const length = Math.max(
    0,
    -projection +
      Math.sqrt(
        projection * projection + island.radius ** 2 - ox ** 2 - oy ** 2,
      ),
  );
  return { island, start, angle, length };
};

/** Global headwater-to-shore samples; independent of chunk query order. */
export const riverPathForIsland = (
  world: WorldIdentity,
  coordinate: Vector2,
): readonly Vector2[] => {
  const river = riverDescriptorFor(
    world,
    islandDescriptorFor(world, coordinate),
  );
  const samples = Math.ceil(river.length / RIVER_SPACING);
  const normal = { x: -Math.sin(river.angle), y: Math.cos(river.angle) };
  const seed = deriveDomainSeed(world, coordinate, "terrain");
  const amplitude = 3 + unit(seed, 92) * 5;
  return Array.from({ length: samples + 1 }, (_, index) => {
    const t = samples === 0 ? 1 : index / samples;
    const meander =
      Math.sin(t * Math.PI) *
      amplitude *
      Math.sin(t * 5.5 + unit(seed, 93) * 6);
    return {
      x:
        river.start.x +
        Math.cos(river.angle) * river.length * t +
        normal.x * meander,
      y:
        river.start.y +
        Math.sin(river.angle) * river.length * t +
        normal.y * meander,
    };
  });
};

const riverForChunk = (
  world: WorldIdentity,
  coordinate: Vector2,
): ChunkObstacle[] => {
  const islandCoordinate = islandCoordinateForChunk(coordinate);
  return riverPathForIsland(world, islandCoordinate).flatMap(
    (position, index) => {
      if (
        Math.floor(position.x / CHUNK_SIZE) !== coordinate.x ||
        Math.floor(position.y / CHUNK_SIZE) !== coordinate.y ||
        !isLandPosition(world, position)
      )
        return [];
      const along = (index * RIVER_SPACING) % RIVER_FORD_INTERVAL;
      if (
        along < RIVER_FORD_HALF_WIDTH ||
        along > RIVER_FORD_INTERVAL - RIVER_FORD_HALF_WIDTH
      )
        return [];
      return [
        {
          id:
            "water-river:" +
            world.generatorVersion +
            ":" +
            world.seed +
            ":" +
            islandCoordinate.x +
            ":" +
            islandCoordinate.y +
            ":" +
            index,
          kind: "water" as const,
          waterKind: "river" as const,
          radius: RIVER_RADIUS,
          position,
        },
      ];
    },
  );
};

export interface MountainRangeDescriptor {
  readonly start: Vector2;
  readonly end: Vector2;
  readonly length: number;
}

const unit = (seed: number, offset: number): number => {
  let hash = seed ^ Math.imul(offset + 1, 0x9e3779b1);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0xffffffff;
};

/** Seed-addressed ridge descriptor; its footprint is 10–1000 player diameters. */
export const mountainRangeDescriptorFor = (
  world: WorldIdentity,
  macroCoordinate: Vector2,
): MountainRangeDescriptor => {
  const seed = deriveDomainSeed(world, macroCoordinate, "terrain");
  const length = PLAYER_COLLISION_DIAMETER * (10 + unit(seed, 0) * 990);
  const angle = unit(seed, 1) * Math.PI;
  const center = {
    x:
      macroCoordinate.x * RANGE_MACRO_CHUNKS * CHUNK_SIZE +
      (macroCoordinate.x === 0 && macroCoordinate.y === 0 ? 8 * CHUNK_SIZE : 0),
    y:
      macroCoordinate.y * RANGE_MACRO_CHUNKS * CHUNK_SIZE +
      (macroCoordinate.x === 0 && macroCoordinate.y === 0 ? 8 * CHUNK_SIZE : 0),
  };
  const halfX = (Math.cos(angle) * length) / 2;
  const halfY = (Math.sin(angle) * length) / 2;
  return {
    start: { x: center.x - halfX, y: center.y - halfY },
    end: { x: center.x + halfX, y: center.y + halfY },
    length,
  };
};

export const mountainRangeForChunk = (
  world: WorldIdentity,
  coordinate: Vector2,
): ChunkObstacle[] => {
  const macro = islandCoordinateForChunk(coordinate);
  const range = mountainRangeDescriptorFor(world, macro);
  const dx = range.end.x - range.start.x;
  const dy = range.end.y - range.start.y;
  const segments = Math.max(1, Math.ceil(range.length / RANGE_SPACING));
  const obstacles: ChunkObstacle[] = [];
  for (let index = 0; index <= segments; index += 1) {
    // Regular broad gaps form deterministic traversable mountain passes.
    if (index % RANGE_CROSSING_INTERVAL === RANGE_CROSSING_INTERVAL - 1)
      continue;
    const position = {
      x: range.start.x + (dx * index) / segments,
      y: range.start.y + (dy * index) / segments,
    };
    if (
      Math.floor(position.x / CHUNK_SIZE) !== coordinate.x ||
      Math.floor(position.y / CHUNK_SIZE) !== coordinate.y ||
      !isLandPosition(world, position) ||
      (macro.x === 0 &&
        macro.y === 0 &&
        Math.hypot(position.x, position.y) < 24)
    )
      continue;
    obstacles.push({
      id: `mountain-range:${world.generatorVersion}:${world.seed}:${macro.x}:${macro.y}:${index}`,
      kind: "mountain",
      radius: RANGE_PEAK_RADIUS,
      position,
    });
  }
  return obstacles;
};

/** V4 keeps V3 terrain and makes wild campfires a deterministic 1-in-100 chunk event. */
export const generateWandererWebV4Chunk: ChunkGenerator = (
  world: WorldIdentity,
  coordinate: Vector2,
): ChunkRecipe => {
  const land = isLandChunk(world, coordinate);
  const base = generateWandererWebV3Chunk(world, coordinate);
  const campfireRoll =
    deriveDomainSeed(world, coordinate, "campfire") %
    WILD_CAMPFIRE_CHANCE_DENOMINATOR;
  const landObstacles = base.obstacles.filter(
    (obstacle) =>
      obstacle.kind !== "water" && isLandPosition(world, obstacle.position),
  );
  const seaObstacle: ChunkObstacle = {
    id:
      "water-sea:" +
      world.generatorVersion +
      ":" +
      world.seed +
      ":" +
      coordinate.x +
      ":" +
      coordinate.y,
    kind: "water",
    waterKind: "sea",
    radius: SEA_FOOTPRINT_RADIUS,
    position: {
      x: (coordinate.x + 0.5) * CHUNK_SIZE,
      y: (coordinate.y + 0.5) * CHUNK_SIZE,
    },
  };
  return {
    ...base,
    obstacles: land
      ? [
          ...landObstacles,
          ...mountainRangeForChunk(world, coordinate),
          ...riverForChunk(world, coordinate),
        ]
      : [seaObstacle],
    campfires: base.campfires.filter(
      (campfire) =>
        land &&
        isLandPosition(world, campfire.position) &&
        (campfire.kind === "home" || campfireRoll === 0),
    ),
    spawns: base.spawns.filter(
      (spawn) => land && isLandPosition(world, spawn.position),
    ),
  };
};
