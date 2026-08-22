import { describe, expect, it } from "vitest";
import {
  findCampfireCoveringPosition,
  findNearbyCampfire,
  settlementBuildRadius,
} from "../../domain/session/settlementPolicy";
import type { SettlementCampfire } from "../../domain/session/sessionState";

const campfireBuildRadiusByLevel = [6, 9, 12] as const;

const campfire = (
  id: string,
  level: SettlementCampfire["level"],
  position: SettlementCampfire["position"],
): SettlementCampfire => ({
  id,
  label: `${id} campfire`,
  level,
  position,
});

describe("session settlement policy", () => {
  it("uses inclusive L1-L3 coverage boundaries and returns undefined without coverage", () => {
    for (const [level, radius] of [
      [1, 6],
      [2, 9],
      [3, 12],
    ] as const) {
      const source = campfire(`campfire:l${level}`, level, { x: 0, y: 0 });
      expect(
        findCampfireCoveringPosition(
          { x: radius, y: 0 },
          [source],
          campfireBuildRadiusByLevel,
        ),
      ).toBe(source);
    }

    expect(
      findCampfireCoveringPosition(
        { x: 6.01, y: 0 },
        [campfire("campfire:l1", 1, { x: 0, y: 0 })],
        campfireBuildRadiusByLevel,
      ),
    ).toBeUndefined();
  });

  it("preserves supplied coverage order", () => {
    const first = campfire("first", 1, { x: 0, y: 0 });
    const second = campfire("second", 3, { x: 1, y: 0 });

    expect(
      findCampfireCoveringPosition(
        { x: 2, y: 0 },
        [first, second],
        campfireBuildRadiusByLevel,
      ),
    ).toBe(first);
  });

  it("selects nearby campfires inclusively, in order, or null", () => {
    const first = campfire("first", 1, { x: 0, y: 0 });
    const second = campfire("second", 1, { x: 1, y: 0 });

    expect(findNearbyCampfire({ x: 2, y: 0 }, [first, second])).toBe(first);
    expect(findNearbyCampfire({ x: 3, y: 0 }, [first, second])).toBe(second);
    expect(findNearbyCampfire({ x: 4, y: 0 }, [first, second])).toBeNull();
  });

  it("keeps the level-one fallback and reduces supplied radii by maximum", () => {
    expect(settlementBuildRadius([], campfireBuildRadiusByLevel)).toBe(6);
    expect(
      settlementBuildRadius(
        [
          campfire("l1", 1, { x: 0, y: 0 }),
          campfire("l2", 2, { x: 1, y: 0 }),
          campfire("l3", 3, { x: 2, y: 0 }),
        ],
        campfireBuildRadiusByLevel,
      ),
    ).toBe(12);
  });
});
