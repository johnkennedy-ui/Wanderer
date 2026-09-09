import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dangerForChunkCoordinate,
  generateChunk,
  UnsupportedWorldGeneratorVersionError,
  WANDERER_WEB_V1,
  WANDERER_WEB_V2,
} from "../../domain/world";

const world = { seed: "review-seed", generatorVersion: "wanderer-web-v1" };
const v2World = { seed: "review-seed", generatorVersion: WANDERER_WEB_V2 };

const goldenFixtureNames = [
  "home-0-0",
  "frontier-2--1",
  "negative--4-3",
  "distant-8-7",
] as const;

interface WorldGoldenFixture {
  readonly sourceCommit: string;
  readonly generatorVersion: string;
  readonly world: { readonly seed: string; readonly generatorVersion: string };
  readonly coordinate: { readonly x: number; readonly y: number };
  readonly recipeSha256: string;
}

const goldenFixture = (
  name: (typeof goldenFixtureNames)[number],
): WorldGoldenFixture =>
  JSON.parse(
    readFileSync(
      new URL(`../fixtures/world/v1/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as WorldGoldenFixture;

const recipeSha256 = (recipe: unknown): string =>
  createHash("sha256").update(JSON.stringify(recipe)).digest("hex");

describe("deterministic chunk generation", () => {
  it.each(goldenFixtureNames)(
    "matches the frozen released-v1 %s golden hash without replacing the coordinate reference",
    (name) => {
      const fixture = goldenFixture(name);
      const coordinate = { ...fixture.coordinate };
      const recipe = generateChunk(fixture.world, coordinate);

      expect(fixture.sourceCommit).toBe(
        "30fd4845ae716599b214573e5663d8437abc4ed3",
      );
      expect(fixture.generatorVersion).toBe(WANDERER_WEB_V1);
      expect(recipe.coordinate).toBe(coordinate);
      expect(recipeSha256(recipe)).toBe(fixture.recipeSha256);
    },
  );

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

  it("uses V2 for exactly one normal three-enemy group per non-home 5-by-2 macrocell", () => {
    const coordinates = [2, 3].flatMap((y) =>
      [5, 6, 7, 8, 9].map((x) => ({ x, y })),
    );
    const first = coordinates.map((coordinate) =>
      generateChunk(v2World, coordinate),
    );

    generateChunk(v2World, { x: -4, y: 9 });
    const again = coordinates.map((coordinate) =>
      generateChunk(v2World, coordinate),
    );
    const encounterGroups = first.filter((chunk) => chunk.spawns.length > 0);
    const home = generateChunk(v2World, { x: 0, y: 0 });

    expect(first.flatMap((chunk) => chunk.spawns)).toHaveLength(3);
    expect(encounterGroups).toHaveLength(1);
    expect(encounterGroups[0]?.spawns).toHaveLength(3);
    expect(again).toEqual(first);
    expect(home.spawns.map((spawn) => spawn.id)).toEqual([
      "enemy:starter-scout",
      "enemy:starter-brute",
      "enemy:starter-elite",
      "boss:ember-wyrm",
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

  it("rejects unknown and prototype-named versions without falling back to v1", () => {
    for (const generatorVersion of ["wanderer-web-v3", "toString"]) {
      try {
        generateChunk(
          { seed: "unsupported-generator", generatorVersion },
          { x: 0, y: 0 },
        );
        throw new Error("unsupported generator should throw");
      } catch (error) {
        expect(error).toBeInstanceOf(UnsupportedWorldGeneratorVersionError);
        expect(error).toMatchObject({
          code: "unsupported-world-generator-version",
          generatorVersion,
        });
      }
    }
  });
});
