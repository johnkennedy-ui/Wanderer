import { describe, expect, it } from "vitest";
import { gameplayTuning } from "../../data/definitions";
import { GameSession } from "../../domain/GameSession";
import { toSaveV2Document } from "../../domain/persistence/currentSave";
import {
  createFreshSessionState,
  hydrateSessionState,
} from "../../domain/session/sessionState";
import { projectCurrentSave } from "../../domain/session/saveProjection";
import type { SaveDocument } from "../../domain/types";
import {
  UnsupportedWorldGeneratorVersionError,
  WANDERER_WEB_V1,
} from "../../domain/world";
import { savedAtHome } from "./session-test-helpers";

describe("GameSession lifecycle", () => {
  it("constructs, hydrates, resets, and projects complete instance-owned lifecycle state", () => {
    const fresh = createFreshSessionState();
    expect(fresh).toMatchObject({
      world: { seed: "wanderer-known-seed", generatorVersion: WANDERER_WEB_V1 },
      player: { position: { x: 0, y: 0 }, hp: 100, maxHp: 100 },
      resources: {
        wood: 120,
        stone: 120,
        scrap: 120,
        essence: 20,
        bossCore: 0,
      },
      buildings: [],
      projectiles: [],
      floorDrops: [],
      nextBuildingSerial: 1,
      nextProjectileSerial: 1,
      nextFloorDropSerial: 1,
      destination: null,
      elapsed: 0,
      attackElapsed: 0,
      farmHarvestElapsed: 0,
      notice: { kind: "session.ready" },
      combatStatus: "Stationary: seeking a target",
    });
    expect(fresh.enemies).toEqual(new Map());
    expect(fresh.defeatedBossIds).toEqual(new Set());
    expect(fresh.upgrades).toEqual(new Set());
    expect(fresh.pendingUpgradeChoices).toEqual([]);

    const saved: SaveDocument = {
      ...savedAtHome(),
      player: { position: { x: 4, y: -2 }, hp: 71, maxHp: 130 },
      resources: { wood: 90, stone: 80, scrap: 70, essence: 60, bossCore: 1 },
      buildings: [
        {
          id: "building:fixture:0007",
          kind: "Workshop",
          position: { x: 1, y: 1 },
          level: 2,
        },
      ],
      defeatedBossIds: ["boss:fixture"],
      upgrades: ["quick-hands"],
      nextBuildingSerial: 8,
      savePointId: "campfire:fixture",
      savePointPosition: { x: 1, y: 1 },
    };
    const hydrated = hydrateSessionState(saved);
    saved.resources.wood = 1;
    (saved.buildings[0]?.position as { x: number }).x = 99;
    expect(hydrated.resources.wood).toBe(90);
    expect(hydrated.buildings[0]?.position).toEqual({ x: 1, y: 1 });
    expect(hydrated).toMatchObject({
      nextBuildingSerial: 8,
      nextProjectileSerial: 1,
      nextFloorDropSerial: 1,
      destination: null,
      elapsed: 0,
      attackElapsed: 0,
      farmHarvestElapsed: 0,
      notice: { kind: "session.ready" },
      combatStatus: "Stationary: seeking a target",
    });
    expect(hydrated.enemies).toEqual(new Map());
    expect(hydrated.projectiles).toEqual([]);
    expect(hydrated.floorDrops).toEqual([]);

    const projected = projectCurrentSave(
      hydrated,
      99,
      hydrated.committedSavePoint,
    );
    hydrated.resources.wood = 2;
    (hydrated.buildings[0]?.position as { x: number }).x = 5;
    expect(projected.resources.wood).toBe(90);
    expect(projected.buildings[0]?.position).toEqual({ x: 1, y: 1 });
    expect(projected).toEqual(toSaveV2Document(projected));
    expect(JSON.stringify(projected)).toBe(
      JSON.stringify(toSaveV2Document(projected)),
    );

    const session = new GameSession({ saved });
    session.move({ intent: { x: 1, y: 0 }, source: "keyboard", at: 1 });
    session.tick(0.1);
    session.resetWorld(" reset-fixture ");
    const reset = session.snapshot();
    expect(reset.world.seed).toBe("reset-fixture");
    expect(reset.player).toEqual({
      position: { x: 0, y: 0 },
      hp: 100,
      maxHp: 100,
    });
    expect(reset.resources).toEqual({
      wood: 120,
      stone: 120,
      scrap: 120,
      essence: 20,
      bossCore: 0,
    });
    expect(reset.buildings).toEqual([]);
    expect(reset.projectiles).toEqual([]);
    expect(reset.floorDrops).toEqual([]);
    expect(reset.upgrades).toEqual([]);
    expect(reset.pendingUpgradeChoices).toEqual([]);
    expect(reset.destination).toBeNull();
    const placed = session.placeBuilding("Workshop", { x: 1, y: 1 });
    expect(placed.building?.id).toMatch(/:0001$/);
  });

  it("copies caller-owned world identity for fresh and saved sessions", () => {
    const suppliedWorld = {
      seed: "caller-owned-world",
      generatorVersion: "wanderer-web-v1",
    };
    const fresh = new GameSession({ world: suppliedWorld });
    suppliedWorld.seed = "mutated-after-construction";
    expect(fresh.snapshot().world).toEqual({
      seed: "caller-owned-world",
      generatorVersion: "wanderer-web-v1",
    });

    const savedWorld = {
      seed: "caller-owned-save-world",
      generatorVersion: "wanderer-web-v1",
    };
    const saved: SaveDocument = { ...savedAtHome(), world: savedWorld };
    const hydrated = new GameSession({ saved });
    savedWorld.generatorVersion = "mutated-after-hydration";
    expect(hydrated.snapshot().world).toEqual({
      seed: "caller-owned-save-world",
      generatorVersion: "wanderer-web-v1",
    });
  });

  it("uses typed outcomes and gives UI and renderer narrow projections", () => {
    const session = new GameSession();
    const fresh = session.snapshot();
    expect(fresh.notice).toEqual({ kind: "session.ready" });
    expect(fresh.ui.notice).toEqual({ kind: "session.ready" });
    expect(fresh.ui).not.toHaveProperty("visibleChunks");
    expect(fresh.renderer).not.toHaveProperty("resources");

    expect(session.placeBuilding("Workshop", { x: 48.1, y: 48.1 })).toEqual({
      ok: false,
      rejection: { kind: "outside-settlement-radius", radius: 6 },
    });
    expect(session.snapshot().ui.notice).toEqual({
      kind: "building.rejected",
      rejection: { kind: "outside-settlement-radius", radius: 6 },
    });

    const placed = session.placeBuilding("Workshop", { x: 1, y: 1 });
    if (!placed.ok) throw new Error("Workshop should be placed");
    expect(session.snapshot().notice).toMatchObject({
      kind: "building.placed",
      buildingId: placed.building.id,
      buildingKind: "Workshop",
    });

    const upgraded = session.upgradeBuilding(placed.building.id);
    if (!upgraded.ok) throw new Error("Workshop should be upgraded");
    expect(session.snapshot().notice).toMatchObject({
      kind: "building.upgraded",
      buildingId: placed.building.id,
      buildingKind: "Workshop",
      level: 2,
    });

    expect(session.demolishBuilding(placed.building.id).ok).toBe(true);
    expect(session.snapshot().notice).toMatchObject({
      kind: "building.demolished",
      buildingId: placed.building.id,
      buildingKind: "Workshop",
      refundRate: gameplayTuning.buildingRefundRate,
    });

    session.setDestination({
      destination: { x: Number.NaN, y: 0 },
      source: "tap-to-move",
      at: 1,
    });
    expect(session.snapshot().notice).toEqual({
      kind: "tap-to-move.rejected.invalid-destination",
    });

    const remote = new GameSession({
      saved: {
        ...savedAtHome(),
        player: { position: { x: 80, y: 80 }, hp: 100, maxHp: 100 },
      },
    });
    expect(remote.createValidCampfireSaveRequest(2)).toBeNull();
    expect(remote.snapshot().notice).toEqual({
      kind: "save.rejected.not-near-campfire",
    });
  });

  it("hydrates recorded v1 worlds and rejects an unavailable recorded generator", () => {
    const saved = savedAtHome();
    expect(new GameSession({ saved }).snapshot().world.generatorVersion).toBe(
      WANDERER_WEB_V1,
    );

    const unsupported = {
      ...saved,
      world: { ...saved.world, generatorVersion: "wanderer-web-v2" },
    };
    expect(() => new GameSession({ saved: unsupported })).toThrow(
      UnsupportedWorldGeneratorVersionError,
    );
  });
});
