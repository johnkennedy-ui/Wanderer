import { describe, expect, it } from "vitest";
import { GameSession } from "../../domain/GameSession";
import type { ChunkRecipeSource } from "../../domain/session/chunkRecipeCache";
import type { BuildingState, ResourceBag, Vector2 } from "../../domain/types";
import { WANDERER_WEB_V3, generateChunk } from "../../domain/world";
import { savedAtHome } from "./session-test-helpers";

const resources = (wood = 100): ResourceBag => ({
  wood,
  stone: 100,
  scrap: 100,
  essence: 100,
  bossCore: 10,
});

const clearRecipeSource: ChunkRecipeSource = (world, coordinate) => {
  const generated = generateChunk(world, coordinate);
  return {
    ...generated,
    obstacles: [],
    campfires: generated.campfires.filter(
      (campfire) => campfire.kind === "home",
    ),
  };
};

const sessionWithResources = (wood = 100): GameSession => {
  const saved = savedAtHome();
  return new GameSession({
    saved: { ...saved, resources: resources(wood) },
    chunkRecipeSource: clearRecipeSource,
  });
};

const positionsOf = (preview: {
  readonly tiles: readonly { readonly position: Vector2 }[];
}) => preview.tiles.map((tile) => tile.position);

const wallLine = (position: Vector2, endPosition?: Vector2) =>
  ({ kind: "place", buildingKind: "WoodWall", position, endPosition }) as const;

const allBuildings = (session: GameSession): readonly BuildingState[] =>
  session.presentation().ui.buildings;

describe("GameSession building placement preview and commit", () => {
  it("previews without changing resources, buildings, notice, serials, or save data", () => {
    const session = sessionWithResources();
    const beforeUi = session.presentation().ui;
    const beforeSave = session.createValidCampfireSaveRequest(23)?.document;
    expect(beforeSave).toBeDefined();

    const preview = session.previewBuildingPlacement({
      kind: "place",
      buildingKind: "Workshop",
      position: { x: 1, y: 1 },
    });

    expect(preview).toMatchObject({
      buildingKind: "Workshop",
      level: 1,
      valid: true,
      rejection: null,
      cost: { wood: 18, stone: 8, scrap: 2, essence: 0, bossCore: 0 },
    });
    expect(session.presentation().ui.resources).toEqual(beforeUi.resources);
    expect(session.presentation().ui.buildings).toEqual(beforeUi.buildings);
    expect(session.presentation().ui.notice).toEqual(beforeUi.notice);
    expect(session.createValidCampfireSaveRequest(23)?.document).toEqual(
      beforeSave,
    );
  });

  it("snaps inclusive wall lines along the dominant axis in either direction, with X winning ties", () => {
    const session = sessionWithResources();
    expect(
      positionsOf(
        session.previewBuildingPlacement(
          wallLine({ x: 0.6, y: 2.4 }, { x: 4.6, y: 3.4 }),
        ),
      ),
    ).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
    ]);
    expect(
      positionsOf(
        session.previewBuildingPlacement(
          wallLine({ x: 5, y: 3 }, { x: 1, y: 2 }),
        ),
      ),
    ).toEqual([
      { x: 5, y: 3 },
      { x: 4, y: 3 },
      { x: 3, y: 3 },
      { x: 2, y: 3 },
      { x: 1, y: 3 },
    ]);
    expect(
      positionsOf(
        session.previewBuildingPlacement(
          wallLine({ x: 3, y: 4 }, { x: 2, y: 1 }),
        ),
      ),
    ).toEqual([
      { x: 3, y: 4 },
      { x: 3, y: 3 },
      { x: 3, y: 2 },
      { x: 3, y: 1 },
    ]);
    expect(
      positionsOf(
        session.previewBuildingPlacement(
          wallLine({ x: 1, y: 3 }, { x: 4, y: 6 }),
        ),
      ),
    ).toEqual([
      { x: 1, y: 3 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
    ]);
  });

  it("caps wall previews at exactly 64 cells and ignores line endpoints for non-walls", () => {
    const session = sessionWithResources();
    const capped = session.previewBuildingPlacement(
      wallLine({ x: 0, y: 1 }, { x: 200, y: 50 }),
    );
    expect(capped.tiles).toHaveLength(64);
    expect(capped.tiles[0]?.position).toEqual({ x: 0, y: 1 });
    expect(capped.tiles[63]?.position).toEqual({ x: 63, y: 1 });
    expect(capped.cost).toEqual({
      wood: 384,
      stone: 0,
      scrap: 0,
      essence: 0,
      bossCore: 0,
    });

    const singleBuilding = session.previewBuildingPlacement({
      kind: "place",
      buildingKind: "Workshop",
      position: { x: 1, y: 1 },
      endPosition: { x: 20, y: 1 },
    });
    expect(positionsOf(singleBuilding)).toEqual([{ x: 1, y: 1 }]);
  });

  it("rejects non-finite and unsafe coordinates without building or consuming resources", () => {
    for (const request of [
      {
        kind: "place",
        buildingKind: "WoodWall",
        position: { x: Number.NaN, y: 0 },
      },
      {
        kind: "place",
        buildingKind: "WoodWall",
        position: { x: 0, y: Number.POSITIVE_INFINITY },
      },
      {
        kind: "place",
        buildingKind: "WoodWall",
        position: { x: 0, y: 0 },
        endPosition: { x: Number.MAX_SAFE_INTEGER + 1, y: 0 },
      },
    ] as const) {
      const session = sessionWithResources();
      const before = session.createValidCampfireSaveRequest(29)?.document;
      const preview = session.previewBuildingPlacement(request);
      expect(preview).toMatchObject({
        valid: false,
        rejection: { kind: "invalid-coordinates" },
      });
      expect(preview.tiles).toHaveLength(1);
      expect(session.presentation().ui.notice.kind).toBe("session.ready");
      expect(session.commitBuildingPlacement(request)).toEqual({
        ok: false,
        rejection: { kind: "invalid-coordinates" },
      });
      expect(session.createValidCampfireSaveRequest(29)?.document).toEqual(
        before,
      );
    }
  });

  it("reports terrain, overlap, range, affordability, and unsupported-building rejections", () => {
    const world = {
      seed: "placement-terrain-rejection",
      generatorVersion: WANDERER_WEB_V3,
    };
    const water = Array.from({ length: 17 }, (_, index) => index - 8)
      .flatMap((x) =>
        Array.from({ length: 17 }, (_, index) => index - 8).flatMap(
          (y) => generateChunk(world, { x, y }).obstacles,
        ),
      )
      .find((obstacle) => obstacle.kind === "water");
    if (water === undefined)
      throw new Error("V3 test world should contain water");
    const terrainSession = new GameSession({ world });
    expect(
      terrainSession.previewBuildingPlacement({
        kind: "place",
        buildingKind: "Campfire",
        position: water.position,
      }).rejection,
    ).toEqual({ kind: "blocked-terrain" });

    const session = sessionWithResources();
    expect(session.placeBuilding("Campfire", { x: 1, y: 2 }).ok).toBe(true);
    expect(
      session.previewBuildingPlacement(wallLine({ x: 1, y: 2 })).rejection,
    ).toEqual({ kind: "overlaps-existing-building" });
    expect(
      session.previewBuildingPlacement({
        kind: "place",
        buildingKind: "Workshop",
        position: { x: 10, y: 0 },
      }).rejection,
    ).toMatchObject({ kind: "outside-settlement-radius" });

    const poorSession = sessionWithResources(0);
    expect(
      poorSession.previewBuildingPlacement({
        kind: "place",
        buildingKind: "Workshop",
        position: { x: 1, y: 1 },
      }).rejection,
    ).toEqual({ kind: "insufficient-resources" });
    expect(
      poorSession.previewBuildingPlacement({
        kind: "place",
        buildingKind: "Storage",
        position: { x: 1, y: 1 },
      }).rejection,
    ).toEqual({ kind: "unknown-building" });
    expect(
      poorSession.previewBuildingPlacement({
        kind: "relocate",
        buildingId: "missing-building",
        position: { x: 1, y: 1 },
      }).rejection,
    ).toEqual({ kind: "unknown-building" });
  });

  it("rejects wall cells occupied by the live player and previews relocation without cost", () => {
    const saved = savedAtHome();
    const occupied = new GameSession({
      saved: {
        ...saved,
        player: { ...saved.player, position: { x: 2, y: 0 } },
      },
      chunkRecipeSource: clearRecipeSource,
    });
    expect(
      occupied.previewBuildingPlacement(wallLine({ x: 2, y: 0 })).rejection,
    ).toEqual({ kind: "occupied-by-actor" });

    const session = sessionWithResources();
    const placed = session.placeBuilding("Workshop", { x: 1, y: 1 });
    if (!placed.ok)
      throw new Error("Workshop fixture placement should succeed");
    const preview = session.previewBuildingPlacement({
      kind: "relocate",
      buildingId: placed.building.id,
      position: { x: 2, y: 1 },
    });
    expect(preview).toMatchObject({
      buildingKind: "Workshop",
      level: 1,
      valid: true,
      cost: { wood: 0, stone: 0, scrap: 0, essence: 0, bossCore: 0 },
    });
    const resourcesBeforeRelocation = session.presentation().ui.resources;
    expect(
      session.commitBuildingPlacement({
        kind: "relocate",
        buildingId: placed.building.id,
        position: { x: 2, y: 1 },
      }),
    ).toMatchObject({ ok: true, outcome: "relocated" });
    expect(session.presentation().ui.resources).toEqual(
      resourcesBeforeRelocation,
    );

    const legacy = new GameSession({
      saved: {
        ...saved,
        buildings: [
          {
            id: "legacy-storage",
            kind: "Storage",
            position: { x: 1, y: 1 },
            level: 1,
          },
        ],
        nextBuildingSerial: 2,
      },
      chunkRecipeSource: clearRecipeSource,
    });
    expect(
      legacy.previewBuildingPlacement({
        kind: "relocate",
        buildingId: "legacy-storage",
        position: { x: 2, y: 1 },
      }).rejection,
    ).toEqual({ kind: "unknown-building" });
  });

  it("commits a valid line atomically with aggregate cost and sequential IDs", () => {
    const session = sessionWithResources(18);
    const request = wallLine({ x: 1, y: 2 }, { x: 3, y: 2 });
    expect(session.previewBuildingPlacement(request).valid).toBe(true);
    const result = session.commitBuildingPlacement(request);
    expect(result).toMatchObject({ ok: true, outcome: "placed" });
    if (!result.ok) throw new Error("Wall line should commit");

    const walls = allBuildings(session).filter(
      (building) => building.kind === "WoodWall",
    );
    expect(walls).toHaveLength(3);
    expect(walls.map((building) => building.id.slice(-4))).toEqual([
      "0001",
      "0002",
      "0003",
    ]);
    expect(result.building.id).toBe(walls[2]?.id);
    expect(session.presentation().ui.resources.wood).toBe(0);
    expect(session.presentation().ui.notice).toEqual({
      kind: "building.placed",
      buildingId: result.building.id,
      buildingKind: "WoodWall",
    });
  });

  it("does not partially place a line when aggregate affordability fails", () => {
    const session = sessionWithResources(17);
    const request = wallLine({ x: 1, y: 2 }, { x: 3, y: 2 });
    const before = session.createValidCampfireSaveRequest(31)?.document;
    const preview = session.previewBuildingPlacement(request);
    expect(preview).toMatchObject({
      valid: false,
      rejection: { kind: "insufficient-resources" },
    });
    expect(
      preview.tiles.every(
        (tile) => tile.rejection?.kind === "insufficient-resources",
      ),
    ).toBe(true);
    expect(session.commitBuildingPlacement(request)).toEqual({
      ok: false,
      rejection: { kind: "insufficient-resources" },
    });
    expect(
      allBuildings(session).filter((building) => building.kind === "WoodWall"),
    ).toHaveLength(0);
    expect(session.createValidCampfireSaveRequest(31)?.document).toEqual(
      before,
    );
  });

  it("keeps the horizontal fixture clear before the first wave and rejects later occupants", () => {
    const session = new GameSession();
    const originalLane = wallLine({ x: 1, y: 1 }, { x: 3, y: 1 });
    const successLane = wallLine({ x: 1, y: 3 }, { x: 3, y: 3 });
    expect(session.previewBuildingPlacement(originalLane).valid).toBe(true);
    let observedLiveOccupancy = false;
    let observedWaveOccupancy = false;

    // Match the fresh browser world and ordinary incidental choice selections.
    // No actor removal, paused combat, saved fixture rewrite or placement retry.
    // 3,000 normal 50 ms simulation steps cover the 150 s browser watchdog.
    for (let step = 0; step <= 3_000; step += 1) {
      let ui = session.presentation().ui;
      if (ui.pendingClassChoices.length > 0) {
        expect(session.chooseClass("wizard")).toBe(true);
        ui = session.presentation().ui;
      }
      const choiceKeys = new Set<string>();
      while (ui.pendingClassSkillChoices.length > 0) {
        const key = ui.pendingClassSkillChoices.join("|");
        expect(choiceKeys.has(key)).toBe(false);
        choiceKeys.add(key);
        expect(session.chooseClassSkill(ui.pendingClassSkillChoices[0])).toBe(
          true,
        );
        ui = session.presentation().ui;
      }
      if (ui.pendingUpgradeChoices.length > 0) {
        expect(session.chooseUpgrade(ui.pendingUpgradeChoices[0])).toBe(true);
      }

      const success = session.previewBuildingPlacement(successLane);
      if (session.presentation().ui.wave.waveIndex === 0) {
        expect(success, "pre-wave corridor at step " + step).toMatchObject({
          valid: true,
          rejection: null,
          cost: { wood: 18, stone: 0, scrap: 0, essence: 0, bossCore: 0 },
        });
      } else if (
        !observedWaveOccupancy &&
        success.rejection?.kind === "occupied-by-actor"
      ) {
        const before = session.presentation().ui;
        const savedBefore =
          session.createValidCampfireSaveRequest(31)?.document;
        expect(savedBefore).toBeDefined();
        expect(session.commitBuildingPlacement(successLane)).toEqual({
          ok: false,
          rejection: { kind: "occupied-by-actor" },
        });
        expect(session.presentation().ui.resources).toEqual(before.resources);
        expect(session.presentation().ui.buildings).toEqual(before.buildings);
        expect(session.createValidCampfireSaveRequest(31)?.document).toEqual(
          savedBefore,
        );
        observedWaveOccupancy = true;
      }
      expect(positionsOf(success)).toEqual([
        { x: 1, y: 3 },
        { x: 2, y: 3 },
        { x: 3, y: 3 },
      ]);

      if (
        !observedLiveOccupancy &&
        session.previewBuildingPlacement(originalLane).rejection?.kind ===
          "occupied-by-actor"
      ) {
        const before = session.presentation().ui;
        const savedBefore =
          session.createValidCampfireSaveRequest(31)?.document;
        expect(savedBefore).toBeDefined();
        expect(session.commitBuildingPlacement(originalLane)).toEqual({
          ok: false,
          rejection: { kind: "occupied-by-actor" },
        });
        expect(session.presentation().ui.resources).toEqual(before.resources);
        expect(session.presentation().ui.buildings).toEqual(before.buildings);
        expect(session.createValidCampfireSaveRequest(31)?.document).toEqual(
          savedBefore,
        );
        observedLiveOccupancy = true;
      }
      if (step < 3_000) session.tick(0.05);
    }
    expect(observedLiveOccupancy).toBe(true);
    expect(observedWaveOccupancy).toBe(true);
  });

  it("revalidates both occupancy and aggregate resources when confirming", () => {
    const session = sessionWithResources(18);
    const request = wallLine({ x: 1, y: 2 }, { x: 3, y: 2 });
    expect(session.previewBuildingPlacement(request).valid).toBe(true);

    expect(session.placeBuilding("Campfire", { x: 2, y: 2 }).ok).toBe(true);
    expect(session.commitBuildingPlacement(request)).toEqual({
      ok: false,
      rejection: { kind: "overlaps-existing-building" },
    });
    expect(
      allBuildings(session).filter((building) => building.kind === "WoodWall"),
    ).toHaveLength(0);

    const resourceSession = sessionWithResources(18);
    expect(resourceSession.previewBuildingPlacement(request).valid).toBe(true);
    expect(resourceSession.placeBuilding("WoodWall", { x: 5, y: 2 }).ok).toBe(
      true,
    );
    expect(resourceSession.commitBuildingPlacement(request)).toEqual({
      ok: false,
      rejection: { kind: "insufficient-resources" },
    });
    expect(
      allBuildings(resourceSession).filter(
        (building) => building.kind === "WoodWall",
      ),
    ).toHaveLength(1);
    expect(resourceSession.presentation().ui.resources.wood).toBe(12);
  });
});
