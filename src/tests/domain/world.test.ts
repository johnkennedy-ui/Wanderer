import { describe, expect, it } from "vitest";
import { dangerForChunkCoordinate, generateChunk } from "../../domain/world";

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

  it("keeps terrain, POI, named-domain IDs, and the repeatable home scenario stable", () => {
    const home = generateChunk(world, { x: 0, y: 0 });
    expect(home.campfires).toContainEqual({
      id: "campfire:home",
      position: { x: 0, y: 0 },
      kind: "home",
    });
    expect(home.spawns.find((spawn) => spawn.kind === "boss")).toMatchObject({
      id: "boss:ember-wyrm",
      kind: "boss",
      position: { x: 6, y: 0 },
    });
    expect(
      home.spawns.map(({ id, kind, position }) => ({ id, kind, position })),
    ).toEqual([
      {
        id: "enemy:starter-scout",
        kind: "scout",
        position: { x: 2.4, y: 0 },
      },
      {
        id: "enemy:starter-brute",
        kind: "brute",
        position: { x: -3.2, y: 2 },
      },
      {
        id: "enemy:starter-elite",
        kind: "elite",
        position: { x: 2.5, y: -3 },
      },
      {
        id: "boss:ember-wyrm",
        kind: "boss",
        position: { x: 6, y: 0 },
      },
    ]);
  });

  it("adds deterministic distance progression that materially scales far enemies without changing recipes", () => {
    const homeDanger = dangerForChunkCoordinate({ x: 0, y: 0 });
    const farDanger = dangerForChunkCoordinate({ x: 5, y: -6 });
    const home = generateChunk(world, { x: 0, y: 0 });
    const far = generateChunk(world, { x: 5, y: -6 });

    expect(homeDanger).toMatchObject({
      tier: 0,
      healthMultiplier: 1,
      damageMultiplier: 1,
      dropMultiplier: 1,
    });
    expect(farDanger.tier).toBeGreaterThan(homeDanger.tier);
    expect(farDanger.healthMultiplier).toBeGreaterThan(1);
    expect(farDanger.damageMultiplier).toBeGreaterThan(1);
    expect(farDanger.dropMultiplier).toBeGreaterThan(1);
    expect(home.spawns.every((spawn) => spawn.danger.tier === 0)).toBe(true);
    expect(
      far.spawns.every((spawn) => spawn.danger.tier === farDanger.tier),
    ).toBe(true);
  });
});
