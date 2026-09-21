import { describe, expect, it } from "vitest";
import { GameSession } from "../../domain/GameSession";
import { decodeSave } from "../../domain/save";
import { toCurrentSaveStorageDocument } from "../../domain/persistence/currentSave";
import { wallBlocksPosition } from "../../domain/session/buildingGeometry";
import type { ChunkRecipeSource } from "../../domain/session/chunkRecipeCache";
import type {
  BuildingKind,
  ChunkSpawn,
  CurrentSave,
  PlayerClass,
  Vector2,
} from "../../domain/types";
import { generateChunk, WANDERER_WEB_V3 } from "../../domain/world";
import { enemyTerrainClearanceFor } from "../../domain/world/terrainCollision";
import { advance, savedAtHome } from "./session-test-helpers";

const recipeSource =
  (spawns: readonly ChunkSpawn[] = []): ChunkRecipeSource =>
  (world, coordinate) => ({
    ...generateChunk(world, coordinate),
    obstacles: [],
    campfires:
      coordinate.x === 0 && coordinate.y === 0
        ? [
            {
              id: "campfire:wall-test-home",
              kind: "home",
              position: { x: 0, y: 0 },
            },
          ]
        : [],
    spawns: coordinate.x === 0 && coordinate.y === 0 ? spawns : [],
  });

const enemySpawn = (): ChunkSpawn => ({
  id: "enemy:wall-consumer",
  kind: "brute",
  position: { x: 2.5, y: 0 },
  danger: {
    tier: 1,
    label: "test",
    distance: 2.5,
    healthMultiplier: 1,
    damageMultiplier: 1,
    dropMultiplier: 1,
  },
});

const createSession = (
  savedChanges: Partial<CurrentSave> = {},
  spawns: readonly ChunkSpawn[] = [],
): GameSession => {
  const baseline = savedAtHome();
  return new GameSession({
    saved: {
      ...baseline,
      world: { seed: "wall-consumer", generatorVersion: WANDERER_WEB_V3 },
      resources: {
        wood: 1000,
        stone: 1000,
        scrap: 1000,
        essence: 1000,
        bossCore: 0,
      },
      ...savedChanges,
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

const enemy = (session: GameSession) => {
  const result = session
    .presentation()
    .renderer.enemies.find(
      (candidate) => candidate.id === "enemy:wall-consumer",
    );
  if (result === undefined)
    throw new Error("Expected the explicit consumer enemy");
  return result;
};

describe("GameSession wall and tile integration", () => {
  it.each<BuildingKind>([
    "Campfire",
    "Workshop",
    "Farm",
    "Healer",
    "WoodWall",
    "StoneWall",
  ])("snaps %s placement before producing a stable building record", (kind) => {
    const session = createSession();
    const building = place(session, kind, { x: 1.49, y: 1.51 });
    expect(building.position).toEqual({ x: 1, y: 2 });
    expect(building.id).toMatch(/^building:[a-f\d]+:\d{4}$/);
    const moved = session.relocateBuilding(building.id, { x: -1.49, y: -1.51 });
    expect(moved).toMatchObject({
      ok: true,
      building: { id: building.id, position: { x: -1, y: -2 } },
    });
  });

  it("rejects a wall on the player or an occupied tile without spending resources or serials", () => {
    const session = createSession();
    const resources = session.presentation().ui.resources;
    expect(
      session.placeBuilding("WoodWall", { x: 0.2, y: -0.2 }),
    ).toMatchObject({
      ok: false,
      rejection: { kind: "occupied-by-actor" },
    });
    expect(session.presentation().ui.resources).toEqual(resources);
    expect(session.presentation().ui.buildings).toEqual([]);
    const first = place(session, "WoodWall", { x: 1.1, y: 0.1 });
    const after = session.presentation().ui.resources;
    expect(
      session.placeBuilding("StoneWall", { x: 1.4, y: 0.4 }),
    ).toMatchObject({
      ok: false,
      rejection: { kind: "overlaps-existing-building" },
    });
    expect(session.presentation().ui.resources).toEqual(after);
    const second = place(session, "StoneWall", { x: 1.1, y: 1.1 });
    expect(Number(second.id.split(":").at(-1))).toBe(
      Number(first.id.split(":").at(-1)) + 1,
    );
    expect(session.upgradeBuilding(first.id)).toMatchObject({
      ok: false,
      rejection: { kind: "building-not-upgradeable" },
    });
  });

  it.each(["keyboard", "tap-to-move"] as const)(
    "blocks %s movement at an adjoining wall seam and opens after demolition",
    (source) => {
      const session = createSession({
        player: { position: { x: 0, y: 0.5 }, hp: 100, maxHp: 100 },
      });
      const walls = [
        place(session, "WoodWall", { x: 1, y: 0 }),
        place(session, "StoneWall", { x: 1, y: 1 }),
      ];
      const move = () => {
        if (source === "keyboard")
          session.move({ intent: { x: 1, y: 0 }, source, at: 1 });
        else
          session.setDestination({
            destination: { x: 3, y: 0.5 },
            source,
            at: 1,
          });
      };
      move();
      for (let index = 0; index < 15; index += 1) {
        session.tick(0.1);
        const position = session.presentation().ui.player.position;
        expect(position.x).toBeLessThanOrEqual(0.22);
        expect(wallBlocksPosition(position, walls, 0.28)).toBe(false);
      }
      expect(session.presentation().ui.player.position.x).toBeGreaterThan(0);
      for (const wall of walls)
        expect(session.demolishBuilding(wall.id).ok).toBe(true);
      move();
      advance(session, 1);
      expect(session.presentation().ui.player.position.x).toBeGreaterThan(2);
    },
  );

  it.each<{ playerClass: PlayerClass | null; weaponRank: number }>([
    { playerClass: null, weaponRank: 0 },
    { playerClass: "archer", weaponRank: 0 },
    { playerClass: "wizard", weaponRank: 0 },
    { playerClass: "wizard", weaponRank: 1 },
  ])(
    "blocks actual $playerClass projectiles (weapon rank $weaponRank) but retains unobstructed damage",
    ({ playerClass, weaponRank }) => {
      const baseline = savedAtHome();
      const progression = {
        ...baseline.classProgression,
        experience: playerClass === null ? 0 : 6,
        level: playerClass === null ? (0 as const) : (1 as const),
        playerClass,
        weaponRank,
      };
      const protectedSession = createSession(
        { classProgression: progression },
        [enemySpawn()],
      );
      const clearSession = createSession({ classProgression: progression }, [
        enemySpawn(),
      ]);
      for (let y = -4; y <= 4; y += 1)
        place(protectedSession, y % 2 === 0 ? "WoodWall" : "StoneWall", {
          x: 1,
          y,
        });
      const beforeHp = enemy(protectedSession).hp;
      for (let index = 0; index < 12; index += 1) {
        protectedSession.tick(0.1);
        const current = enemy(protectedSession);
        expect(current.hp).toBe(beforeHp);
        expect(
          wallBlocksPosition(
            current.position,
            protectedSession.presentation().ui.buildings,
            enemyTerrainClearanceFor(current.kind),
          ),
        ).toBe(false);
        clearSession.tick(0.1);
      }
      expect(enemy(clearSession).hp).toBeLessThan(beforeHp);
      expect(protectedSession.presentation().renderer.floorDrops).toEqual([]);
      expect(
        protectedSession.presentation().ui.classProgression.experience,
      ).toBe(progression.experience);
    },
  );

  it("keeps both wall kinds and old off-grid buildings through explicit save and reload", () => {
    const legacy = {
      id: "building:legacy:0001",
      kind: "Campfire" as const,
      position: { x: 4.25, y: 4.25 },
      level: 1 as const,
    };
    const session = createSession({
      buildings: [legacy],
      nextBuildingSerial: 2,
    });
    const wood = place(session, "WoodWall", { x: 1.2, y: 0.1 });
    const stone = place(session, "StoneWall", { x: 2.2, y: 0.1 });
    expect(session.presentation().ui.buildings[0]).toEqual(legacy);
    const request = session.createValidCampfireSaveRequest(55);
    expect(request).not.toBeNull();
    if (request === null)
      throw new Error("Expected explicit campfire save request");
    const decoded = decodeSave(
      JSON.stringify(toCurrentSaveStorageDocument(request.document)),
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error("Current wall document did not roundtrip");
    const restored = new GameSession({
      saved: decoded.document,
      chunkRecipeSource: recipeSource(),
    });
    expect(restored.presentation().ui.buildings).toEqual([legacy, wood, stone]);
    expect(restored.presentation().ui.buildings[0].position).toEqual({
      x: 4.25,
      y: 4.25,
    });
  });
});
