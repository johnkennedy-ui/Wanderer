import { describe, expect, it } from "vitest";
import { generateChunk } from "../../domain/world";

const world = { seed: "review-seed", generatorVersion: "wanderer-web-v1" };

describe("deterministic chunk generation", () => {
  it("uses world identity, chunk coordinate, and named domains independently of request order", () => {
    const first = generateChunk(world, { x: 2, y: -1 });
    generateChunk(world, { x: -4, y: 9 });
    const again = generateChunk(world, { x: 2, y: -1 });

    expect(again).toEqual(first);
    expect(Object.keys(first.domainSeeds).sort()).toEqual([
      "boss",
      "campfire",
      "cosmetic",
      "encounter",
      "poi",
      "terrain",
    ]);
    expect(first.domainSeeds.terrain).not.toBe(first.domainSeeds.encounter);
    expect(
      first.obstacles.every((obstacle) =>
        obstacle.id.includes("wanderer-web-v1:review-seed:2:-1"),
      ),
    ).toBe(true);
  });

  it("keeps the repeatable home scenario and persistent boss at stable IDs", () => {
    const home = generateChunk(world, { x: 0, y: 0 });
    expect(home.campfires).toContainEqual({
      id: "campfire:home",
      position: { x: 0, y: 0 },
      kind: "home",
    });
    expect(home.spawns.find((spawn) => spawn.kind === "boss")).toEqual({
      id: "boss:ember-wyrm",
      kind: "boss",
      position: { x: 6, y: 0 },
    });
  });
});
