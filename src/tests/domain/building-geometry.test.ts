import { describe, expect, it } from "vitest";
import {
  buildingFootprintsOverlap,
  snapBuildingPosition,
  sweepWallMovement,
  wallBlocksPosition,
  wallBlocksSegment,
} from "../../domain/session/buildingGeometry";
import { roundVector } from "../../domain/math";
import type { BuildingState } from "../../domain/types";

const wall = (position: { x: number; y: number }): BuildingState => ({
  id: `wall:${position.x}:${position.y}`,
  kind: "WoodWall",
  position,
  level: 1,
});

describe("building geometry", () => {
  it("snaps deterministically and lets adjoining one-metre tiles touch", () => {
    expect(snapBuildingPosition({ x: -1.49, y: 1.5 })).toEqual({ x: -1, y: 2 });
    expect(Object.is(snapBuildingPosition({ x: -0.001, y: -0.5 }).x, -0)).toBe(
      false,
    );
    expect(buildingFootprintsOverlap({ x: -1, y: 0 }, { x: 0, y: 0 })).toBe(
      false,
    );
    expect(buildingFootprintsOverlap({ x: -1, y: 0 }, { x: -0.99, y: 0 })).toBe(
      true,
    );
  });

  it("blocks point and high-delta segment contacts, including a tangent", () => {
    const buildings = [wall({ x: 0, y: 0 }), wall({ x: 1, y: 0 })];
    expect(wallBlocksPosition({ x: 0.5, y: 0 }, buildings)).toBe(true);
    expect(wallBlocksSegment({ x: -2, y: 0 }, { x: 3, y: 0 }, buildings)).toBe(
      true,
    );
    expect(
      wallBlocksSegment({ x: -2, y: 0.5 }, { x: 3, y: 0.5 }, buildings),
    ).toBe(true);
    expect(
      wallBlocksSegment({ x: -2, y: 0.501 }, { x: 3, y: 0.501 }, buildings),
    ).toBe(false);
  });

  it("stops outside the wall after GameSession rounding across frames and seams", () => {
    const buildings = [wall({ x: 1, y: 0 }), wall({ x: 2, y: 0 })];
    const horizontal = sweepWallMovement(
      { x: -1, y: 0 },
      { x: 3, y: 0 },
      buildings,
    );
    expect(wallBlocksPosition(roundVector(horizontal), buildings, 0.28)).toBe(
      false,
    );

    let repeated = { x: -1, y: 0 };
    for (let index = 0; index < 6; index += 1) {
      repeated = roundVector(
        sweepWallMovement(
          repeated,
          { x: repeated.x + 0.5, y: repeated.y },
          buildings,
        ),
      );
      expect(wallBlocksPosition(repeated, buildings, 0.28)).toBe(false);
    }

    const diagonal = sweepWallMovement({ x: -2, y: -2 }, { x: 3, y: 3 }, [
      wall({ x: 0, y: 0 }),
    ]);
    expect(
      wallBlocksPosition(roundVector(diagonal), [wall({ x: 0, y: 0 })], 0.28),
    ).toBe(false);
  });

  it("allows only safe initial-overlap retreats, including centred and corner escapes", () => {
    const buildings = [wall({ x: 0, y: 0 })];
    expect(
      sweepWallMovement({ x: -0.77, y: 0 }, { x: 2, y: 0 }, buildings),
    ).toEqual({ x: -0.77, y: 0 });
    expect(
      sweepWallMovement({ x: -0.77, y: 0 }, { x: -0.775, y: 0 }, buildings),
    ).toEqual({ x: -0.775, y: 0 });
    expect(
      sweepWallMovement({ x: 0, y: 0 }, { x: -2, y: 0 }, buildings),
    ).toEqual({ x: -2, y: 0 });
    expect(
      sweepWallMovement({ x: -0.77, y: -0.77 }, { x: -1, y: -1 }, buildings),
    ).toEqual({ x: -1, y: -1 });
    expect(
      sweepWallMovement({ x: -0.77, y: -0.77 }, { x: 1, y: 1 }, buildings),
    ).toEqual({ x: -0.77, y: -0.77 });
    expect(
      sweepWallMovement({ x: -0.77, y: 0 }, { x: -0.77, y: 0 }, buildings),
    ).toEqual({ x: -0.77, y: 0 });
  });

  it("keeps an outward retreat from crossing a second wall at negative coordinates", () => {
    const buildings = [wall({ x: 0, y: 0 }), wall({ x: -2, y: 0 })];
    const result = sweepWallMovement(
      { x: 0, y: 0 },
      { x: -3, y: 0 },
      buildings,
    );
    expect(result.x).toBeGreaterThan(-1.22);
    expect(wallBlocksPosition(roundVector(result), buildings, 0.28)).toBe(
      false,
    );
  });
});
