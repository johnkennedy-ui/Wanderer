import { distance } from "../math";
import type { Vector2 } from "../types";
import type { SettlementCampfire } from "./sessionState";

type CampfireBuildRadiusByLevel = readonly [number, number, number];

const campfireBuildRadius = (
  level: SettlementCampfire["level"],
  campfireBuildRadiusByLevel: CampfireBuildRadiusByLevel,
): number => campfireBuildRadiusByLevel[level - 1];

/** Returns the first ordered campfire that inclusively covers a position. */
export const findCampfireCoveringPosition = (
  position: Vector2,
  campfires: readonly SettlementCampfire[],
  campfireBuildRadiusByLevel: CampfireBuildRadiusByLevel,
): SettlementCampfire | undefined =>
  campfires.find(
    (campfire) =>
      distance(campfire.position, position) <=
      campfireBuildRadius(campfire.level, campfireBuildRadiusByLevel),
  );

/** Returns the first ordered campfire within the inclusive save/healing radius. */
export const findNearbyCampfire = (
  position: Vector2,
  campfires: readonly SettlementCampfire[],
): SettlementCampfire | null =>
  campfires.find((campfire) => distance(position, campfire.position) <= 2) ??
  null;

/** Returns the level-one fallback or the largest supplied campfire radius. */
export const settlementBuildRadius = (
  campfires: readonly SettlementCampfire[],
  campfireBuildRadiusByLevel: CampfireBuildRadiusByLevel,
): number =>
  Math.max(
    campfireBuildRadiusByLevel[0],
    ...campfires.map((campfire) =>
      campfireBuildRadius(campfire.level, campfireBuildRadiusByLevel),
    ),
  );
