import type { ChunkRecipe, EnemyKind, Vector2, WorldIdentity } from "./types";

export const CHUNK_SIZE = 16;
const DOMAIN_NAMES = [
  "terrain",
  "poi",
  "campfire",
  "boss",
  "encounter",
  "cosmetic",
] as const;

const hashText = (text: string): number => {
  let hash = 2_166_136_261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

export const chunkCoordinateFor = (position: Vector2): Vector2 => ({
  x: Math.floor(position.x / CHUNK_SIZE),
  y: Math.floor(position.y / CHUNK_SIZE),
});

export const chunkKey = (coordinate: Vector2): string =>
  `${coordinate.x},${coordinate.y}`;

export const deriveDomainSeed = (
  world: WorldIdentity,
  coordinate: Vector2,
  domain: (typeof DOMAIN_NAMES)[number],
): number =>
  hashText(
    `${world.seed}|${world.generatorVersion}|${chunkKey(coordinate)}|${domain}`,
  );

const unit = (seed: number, offset: number): number =>
  (hashText(`${seed}:${offset}`) % 10_000) / 10_000;

const coordinateOrigin = (coordinate: Vector2): Vector2 => ({
  x: coordinate.x * CHUNK_SIZE,
  y: coordinate.y * CHUNK_SIZE,
});

const proceduralId = (
  world: WorldIdentity,
  coordinate: Vector2,
  kind: string,
  index: number,
): string =>
  `${kind}:${world.generatorVersion}:${world.seed}:${coordinate.x}:${coordinate.y}:${index}`;

const genericEnemyKind = (seed: number): EnemyKind => {
  const choices: readonly EnemyKind[] = ["scout", "brute", "spitter"];
  return choices[seed % choices.length];
};

export const generateChunk = (
  world: WorldIdentity,
  coordinate: Vector2,
): ChunkRecipe => {
  const domainSeeds = Object.fromEntries(
    DOMAIN_NAMES.map((domain) => [
      domain,
      deriveDomainSeed(world, coordinate, domain),
    ]),
  );
  const origin = coordinateOrigin(coordinate);
  const terrainSeed = domainSeeds.terrain;
  const obstacles = Array.from({ length: 4 }, (_, index) => ({
    id: proceduralId(world, coordinate, "rock", index),
    position: {
      x:
        Math.round((origin.x + 1.5 + unit(terrainSeed, index * 2) * 12) * 100) /
        100,
      y:
        Math.round(
          (origin.y + 1.5 + unit(terrainSeed, index * 2 + 1) * 12) * 100,
        ) / 100,
    },
  }));

  const isHomeChunk = coordinate.x === 0 && coordinate.y === 0;
  const campfires = isHomeChunk
    ? [{ id: "campfire:home", position: { x: 0, y: 0 }, kind: "home" as const }]
    : [
        {
          id: proceduralId(world, coordinate, "campfire", 0),
          position: {
            x:
              Math.round(
                (origin.x + 3 + unit(domainSeeds.campfire, 0) * 10) * 100,
              ) / 100,
            y:
              Math.round(
                (origin.y + 3 + unit(domainSeeds.campfire, 1) * 10) * 100,
              ) / 100,
          },
          kind: "wild" as const,
        },
      ];

  const normalSpawns = isHomeChunk
    ? [
        {
          id: "enemy:starter-scout",
          kind: "scout" as const,
          position: { x: 2.4, y: 0 },
        },
        {
          id: "enemy:starter-brute",
          kind: "brute" as const,
          position: { x: -3.2, y: 2 },
        },
        {
          id: "enemy:starter-elite",
          kind: "elite" as const,
          position: { x: 2.5, y: -3 },
        },
      ]
    : Array.from({ length: 3 }, (_, index) => ({
        id: proceduralId(world, coordinate, "enemy", index),
        kind: genericEnemyKind(domainSeeds.encounter + index),
        position: {
          x:
            Math.round(
              (origin.x + 2 + unit(domainSeeds.encounter, index * 2) * 11) *
                100,
            ) / 100,
          y:
            Math.round(
              (origin.y + 2 + unit(domainSeeds.encounter, index * 2 + 1) * 11) *
                100,
            ) / 100,
        },
      }));
  const boss = isHomeChunk
    ? [
        {
          id: "boss:ember-wyrm",
          kind: "boss" as const,
          position: { x: 6, y: 0 },
        },
      ]
    : [];

  return {
    coordinate,
    key: chunkKey(coordinate),
    domainSeeds,
    obstacles,
    campfires,
    spawns: [...normalSpawns, ...boss],
  };
};

export const visibleChunkCoordinates = (
  position: Vector2,
): readonly Vector2[] => {
  const center = chunkCoordinateFor(position);
  return [-1, 0, 1].flatMap((y) =>
    [-1, 0, 1].map((x) => ({ x: center.x + x, y: center.y + y })),
  );
};
