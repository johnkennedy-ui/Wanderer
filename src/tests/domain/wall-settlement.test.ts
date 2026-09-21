import { describe, expect, it } from "vitest";
import {
  SettlementRuntime,
  type SettlementInputs,
} from "../../domain/session/settlementRuntime";
import type { ResourceBag } from "../../domain/types";

const resources = (): ResourceBag => ({
  wood: 100,
  stone: 100,
  scrap: 0,
  essence: 0,
  bossCore: 0,
});

const runtime = (): SettlementRuntime =>
  new SettlementRuntime({
    buildings: [],
    nextBuildingSerial: 1,
    farmHarvestElapsed: 0,
  });

const inputs = (
  occupiedActors: NonNullable<SettlementInputs["occupiedActors"]> = [],
): SettlementInputs => ({
  position: { x: 0, y: 0 },
  campfires: [
    {
      id: "home",
      label: "home campfire",
      level: 1 as const,
      position: { x: 0, y: 0 },
    },
  ],
  terrainBlocked: false,
  occupiedActors,
});

describe("wall settlement commands", () => {
  it("validates the snapped point rather than the raw pointer position", () => {
    const settlement = runtime();
    expect(
      settlement.place(
        "WoodWall",
        { x: 6.49, y: 0 },
        resources(),
        "wall",
        inputs(),
      ).result,
    ).toMatchObject({ ok: true, building: { position: { x: 6, y: 0 } } });
    expect(
      settlement.place(
        "StoneWall",
        { x: 6.51, y: 0 },
        resources(),
        "wall",
        inputs(),
      ).result,
    ).toMatchObject({
      ok: false,
      rejection: { kind: "outside-settlement-radius" },
    });
  });

  it("rejects actor-occupied wall cells atomically and makes walls single-tier", () => {
    const settlement = runtime();
    const rejected = settlement.place(
      "WoodWall",
      { x: 1, y: 0 },
      resources(),
      "wall",
      inputs([{ position: { x: 1.49, y: 0 }, clearance: 0 }]),
    );
    expect(rejected.result).toEqual({
      ok: false,
      rejection: { kind: "occupied-by-actor" },
    });
    expect(rejected.resources).toEqual(resources());

    const placed = settlement.place(
      "StoneWall",
      { x: -1.2, y: 0 },
      resources(),
      "wall",
      inputs(),
    );
    if (!placed.result.ok) throw new Error("wall should place");
    expect(placed.result.building.position).toEqual({ x: -1, y: 0 });
    expect(
      settlement.upgrade(placed.result.building.id, placed.resources).result,
    ).toEqual({
      ok: false,
      rejection: { kind: "building-not-upgradeable" },
    });
  });
});
