import { describe, expect, it } from "vitest";
import { GameSession } from "../../domain/GameSession";
import type { ChunkRecipeSource } from "../../domain/session/chunkRecipeCache";
import type { BuildingKind, ChunkSpawn, Vector2 } from "../../domain/types";
import { generateChunk, WANDERER_WEB_V3 } from "../../domain/world";
import { advance, savedAtHome } from "./session-test-helpers";

const recipeSource =
  (spawns: readonly ChunkSpawn[]): ChunkRecipeSource =>
  (world, coordinate) => ({
    ...generateChunk(world, coordinate),
    obstacles: [],
    campfires:
      coordinate.x === 0 && coordinate.y === 0
        ? [
            {
              id: "campfire:tower-combat-home",
              kind: "home",
              position: { x: 0, y: 0 },
            },
          ]
        : [],
    spawns: coordinate.x === 0 && coordinate.y === 0 ? spawns : [],
  });

const enemySpawn = (id: string, position: Vector2): ChunkSpawn => ({
  id,
  kind: "brute",
  position,
  danger: {
    tier: 1,
    label: "tower combat",
    distance: Math.hypot(position.x, position.y),
    healthMultiplier: 1,
    damageMultiplier: 1,
    dropMultiplier: 1,
  },
});

const createSession = (spawns: readonly ChunkSpawn[]) => {
  const saved = savedAtHome();
  return new GameSession({
    saved: {
      ...saved,
      world: {
        seed: "tower-combat-session",
        generatorVersion: WANDERER_WEB_V3,
      },
      // Keep player combat out of this fixture so every observed hit is tower-owned.
      player: { position: { x: -4, y: 0 }, hp: 100, maxHp: 100 },
      resources: {
        wood: 1000,
        stone: 1000,
        scrap: 1000,
        essence: 1000,
        bossCore: 0,
      },
    },
    chunkRecipeSource: recipeSource(spawns),
  });
};

const place = (session: GameSession, kind: BuildingKind, position: Vector2) => {
  const result = session.placeBuilding(kind, position);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.building;
};

const enemy = (session: GameSession, id: string) => {
  const result = session
    .diagnostics()
    .enemies.find((candidate) => candidate.id === id);
  if (result === undefined) throw new Error(`Expected enemy ${id}`);
  return result;
};

describe("GameSession tower combat integration", () => {
  it.each([
    {
      kind: "ArcherTower" as const,
      visual: "tower-ballista" as const,
      launchAfterSeconds: 1.2,
    },
    {
      kind: "MageTower" as const,
      visual: "tower-crystal" as const,
      launchAfterSeconds: 1.4,
    },
  ])(
    "launches a visible $visual projectile and applies $kind damage",
    ({ kind, visual, launchAfterSeconds }) => {
      const session = createSession([
        enemySpawn("enemy:tower-target", { x: 2.5, y: 0 }),
      ]);
      const tower = place(session, kind, { x: 1, y: 0 });

      advance(session, launchAfterSeconds);
      expect(session.presentation().renderer.projectiles).toContainEqual(
        expect.objectContaining({
          origin: { x: 1, y: 0 },
          targetId: "enemy:tower-target",
          visual,
        }),
      );
      expect(session.presentation().renderer.attackCues).toContainEqual(
        expect.objectContaining({ actorId: tower.id }),
      );

      const beforeImpact = enemy(session, "enemy:tower-target").hp;
      advance(session, 0.5);
      expect(enemy(session, "enemy:tower-target").hp).toBeLessThan(
        beforeImpact,
      );
    },
  );

  it.each([
    {
      kind: "ArcherTower" as const,
      visual: "tower-ballista" as const,
      launchAfterSeconds: 1.2,
    },
    {
      kind: "MageTower" as const,
      visual: "tower-crystal" as const,
      launchAfterSeconds: 1.4,
    },
  ])(
    "fires a $visual projectile over a wall and applies $kind damage",
    ({ kind, visual, launchAfterSeconds }) => {
      const session = createSession([
        enemySpawn("enemy:over-wall-target", { x: 3.5, y: 0 }),
      ]);
      const tower = place(session, kind, { x: 1, y: 0 });
      place(session, "StoneWall", { x: 2, y: 0 });
      const beforeImpact = enemy(session, "enemy:over-wall-target").hp;

      advance(session, launchAfterSeconds);
      expect(session.presentation().renderer.projectiles).toContainEqual(
        expect.objectContaining({
          origin: { x: 1, y: 0 },
          targetId: "enemy:over-wall-target",
          visual,
        }),
      );
      expect(session.presentation().renderer.attackCues).toContainEqual(
        expect.objectContaining({ actorId: tower.id }),
      );

      advance(session, 0.5);
      expect(enemy(session, "enemy:over-wall-target").hp).toBeLessThan(
        beforeImpact,
      );
    },
  );

  it("damages every in-range enemy and projects a complete slash around Sword Tower", () => {
    const session = createSession([
      enemySpawn("enemy:sword-primary", { x: 2.5, y: 0 }),
      enemySpawn("enemy:sword-secondary", { x: 1, y: 1.3 }),
    ]);
    const tower = place(session, "SwordTower", { x: 1, y: 0 });
    const primaryHp = enemy(session, "enemy:sword-primary").hp;
    const secondaryHp = enemy(session, "enemy:sword-secondary").hp;

    advance(session, 1.2);

    expect(enemy(session, "enemy:sword-primary").hp).toBeLessThan(primaryHp);
    expect(enemy(session, "enemy:sword-secondary").hp).toBeLessThan(
      secondaryHp,
    );
    expect(session.presentation().renderer.attackCues).toContainEqual(
      expect.objectContaining({ actorId: tower.id, style: "slash" }),
    );
    expect(session.presentation().renderer.crescentAttacks).toContainEqual(
      expect.objectContaining({
        origin: { x: 1, y: 0 },
        radius: 1.75,
        arcCosine: -1,
        centered: true,
      }),
    );
  });
});
