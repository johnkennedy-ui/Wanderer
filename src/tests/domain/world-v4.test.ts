import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORLD_GENERATOR_VERSION,
  generateChunk,
  WANDERER_WEB_V1,
  WANDERER_WEB_V2,
  WANDERER_WEB_V3,
  WANDERER_WEB_V4,
} from "../../domain/world";
import {
  isLandPosition,
  islandDescriptorFor,
  mountainRangeDescriptorFor,
  mountainRangeForChunk,
  riverPathForIsland,
} from "../../domain/world/generators/wandererWebV4";

describe("wanderer-web-v4 campfire density", () => {
  it("keeps legacy generator campfires unchanged and preserves the home fire", () => {
    expect(DEFAULT_WORLD_GENERATOR_VERSION).toBe(WANDERER_WEB_V4);
    for (const generatorVersion of [
      WANDERER_WEB_V1,
      WANDERER_WEB_V2,
      WANDERER_WEB_V3,
    ]) {
      expect(
        generateChunk(
          { seed: "density-compat", generatorVersion },
          { x: 4, y: -3 },
        ).campfires.filter((campfire) => campfire.kind === "wild"),
      ).toHaveLength(1);
    }
    expect(
      generateChunk(
        { seed: "density-compat", generatorVersion: WANDERER_WEB_V4 },
        { x: 0, y: 0 },
      ).campfires,
    ).toEqual([
      { id: "campfire:home", position: { x: 0, y: 0 }, kind: "home" },
    ]);
  });

  it("generates about one wild campfire per 100 non-home chunks deterministically", () => {
    const world = {
      seed: "wild-campfire-density",
      generatorVersion: WANDERER_WEB_V4,
    };
    const coordinates = Array.from({ length: 32 }, (_, y) => y - 16).flatMap(
      (y) => Array.from({ length: 32 }, (_, x) => ({ x: x - 16, y })),
    );
    const chunks = coordinates.map((coordinate) =>
      generateChunk(world, coordinate),
    );
    const nonHomeChunks = chunks.filter(
      (chunk) => chunk.coordinate.x !== 0 || chunk.coordinate.y !== 0,
    );
    const wildChunks = nonHomeChunks.filter((chunk) =>
      chunk.campfires.some((campfire) => campfire.kind === "wild"),
    );
    expect(wildChunks.length).toBeGreaterThanOrEqual(4);
    expect(wildChunks.length).toBeLessThanOrEqual(18);
    for (const index of [0, 17, 255, 511, 900]) {
      const coordinate = coordinates[index];
      expect(coordinate).toBeDefined();
      expect(generateChunk(world, coordinate!)).toEqual(chunks[index]);
    }
  });

  it("keeps deterministic ridge extents between 10 and 1000 player diameters", () => {
    const macro = { x: 1, y: -2 };
    for (let index = 0; index < 100; index += 1) {
      const world = {
        seed: `ridge-scale-${index}`,
        generatorVersion: WANDERER_WEB_V4,
      };
      const descriptor = mountainRangeDescriptorFor(world, macro);
      const measured = Math.hypot(
        descriptor.end.x - descriptor.start.x,
        descriptor.end.y - descriptor.start.y,
      );
      expect(measured / 0.56).toBeGreaterThanOrEqual(10);
      expect(measured / 0.56).toBeLessThanOrEqual(1000);
      expect(descriptor).toEqual(mountainRangeDescriptorFor(world, macro));
    }
  });

  it("rasterizes ridge obstacles identically regardless of chunk query order", () => {
    const world = { seed: "ridge-order", generatorVersion: WANDERER_WEB_V4 };
    const macro = { x: 1, y: -1 };
    const coordinates = Array.from({ length: 40 }, (_, y) =>
      Array.from({ length: 40 }, (_, x) => ({
        x: macro.x * 40 + x,
        y: macro.y * 40 + y,
      })),
    ).flat();
    const forward = coordinates.map((coordinate) =>
      mountainRangeForChunk(world, coordinate),
    );
    const reverse = [...coordinates]
      .reverse()
      .map((coordinate) => mountainRangeForChunk(world, coordinate));
    expect(reverse.reverse()).toEqual(forward);
    expect(forward.flat().length).toBeGreaterThan(0);
    expect(new Set(forward.flat().map((obstacle) => obstacle.id)).size).toBe(
      forward.flat().length,
    );
    const ridges = forward
      .flat()
      .sort(
        (left, right) =>
          Number(left.id.split(":").at(-1)) -
          Number(right.id.split(":").at(-1)),
      );
    const hasWalkablePass = ridges.some((obstacle, index) => {
      const next = ridges[index + 1];
      if (next === undefined) return false;
      const leftIndex = Number(obstacle.id.split(":").at(-1));
      const rightIndex = Number(next.id.split(":").at(-1));
      if (rightIndex - leftIndex !== 2) return false;
      const centerGap = Math.hypot(
        next.position.x - obstacle.position.x,
        next.position.y - obstacle.position.y,
      );
      // Leave a positive corridor after both obstacle radii and player clearance.
      return centerGap - 2 * (0.68 + 0.28) > 0;
    });
    expect(hasWalkablePass).toBe(true);
  });
});

describe("wanderer-web-v4 island hydrology", () => {
  const world = { seed: "island-hydrology", generatorVersion: WANDERER_WEB_V4 };

  it("keeps the home island on land and creates deterministic sea between islands", () => {
    expect(isLandPosition(world, { x: 0, y: 0 })).toBe(true);
    const island = islandDescriptorFor(world, { x: 1, y: 0 });
    expect(isLandPosition(world, island.center)).toBe(true);
    expect(
      isLandPosition(world, {
        x: island.center.x + island.radius + 24,
        y: island.center.y,
      }),
    ).toBe(false);
    const sea = generateChunk(world, { x: 20, y: 0 });
    expect(sea.obstacles).toEqual([
      expect.objectContaining({ kind: "water", waterKind: "sea" }),
    ]);
    expect(sea.campfires).toHaveLength(0);
    expect(sea.spawns).toHaveLength(0);
  });

  it("routes a deterministic river from the mountain headwater to the sea", () => {
    const islandCoordinate = { x: 1, y: 0 };
    const island = islandDescriptorFor(world, islandCoordinate);
    const path = riverPathForIsland(world, islandCoordinate);
    expect(path.length).toBeGreaterThan(100);
    expect(path).toEqual(riverPathForIsland(world, islandCoordinate));
    expect(path[0]).toEqual(island.center);
    expect(isLandPosition(world, path[0]!)).toBe(true);
    const headwaterChunk = {
      x: Math.floor(path[0]!.x / 16),
      y: Math.floor(path[0]!.y / 16),
    };
    const nearbyMountains = [
      { x: headwaterChunk.x, y: headwaterChunk.y },
      { x: headwaterChunk.x - 1, y: headwaterChunk.y },
      { x: headwaterChunk.x + 1, y: headwaterChunk.y },
      { x: headwaterChunk.x, y: headwaterChunk.y - 1 },
      { x: headwaterChunk.x, y: headwaterChunk.y + 1 },
    ].flatMap((coordinate) =>
      generateChunk(world, coordinate).obstacles.filter(
        (obstacle) => obstacle.kind === "mountain",
      ),
    );
    expect(
      Math.min(
        ...nearbyMountains.map((mountain) =>
          Math.hypot(
            mountain.position.x - path[0]!.x,
            mountain.position.y - path[0]!.y,
          ),
        ),
      ),
    ).toBeLessThan(2.5);
    const end = path.at(-1)!;
    expect(
      Math.hypot(end.x - island.center.x, end.y - island.center.y),
    ).toBeCloseTo(island.radius, 4);
    const beyond = path.at(-2)!;
    expect(isLandPosition(world, beyond)).toBe(true);
    const center = {
      x: Math.floor(end.x / 16),
      y: Math.floor(end.y / 16),
    };
    const surrounding = [
      { x: center.x + 1, y: center.y },
      { x: center.x - 1, y: center.y },
      { x: center.x, y: center.y + 1 },
      { x: center.x, y: center.y - 1 },
      { x: center.x + 1, y: center.y + 1 },
      { x: center.x - 1, y: center.y - 1 },
    ];
    expect(
      surrounding.some((coordinate) =>
        generateChunk(world, coordinate).obstacles.some(
          (obstacle) => obstacle.waterKind === "sea",
        ),
      ),
    ).toBe(true);
    const riverChunks = Array.from({ length: 40 }, (_, y) =>
      Array.from({ length: 40 }, (_, x) => ({
        x: islandCoordinate.x * 40 + x - 20,
        y: islandCoordinate.y * 40 + y - 20,
      })),
    ).flat();
    const rivers = riverChunks.flatMap((coordinate) =>
      generateChunk(world, coordinate).obstacles.filter(
        (obstacle) => obstacle.waterKind === "river",
      ),
    );
    expect(rivers.length).toBeGreaterThan(20);
    expect(new Set(rivers.map((river) => river.id)).size).toBe(rivers.length);
  });
});
