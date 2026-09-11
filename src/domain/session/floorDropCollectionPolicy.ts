import { distance } from "../math";
import type {
  FloorDropState,
  ReadonlyResourceBag,
  ResourceBag,
  Vector2,
} from "../types";
import { collectResourcesWithinCapacity } from "./economy";

export interface FloorDropCollectionInput {
  readonly playerPosition: Vector2;
  readonly floorDrops: readonly FloorDropState[];
  readonly resources: ReadonlyResourceBag;
  readonly collectDistance: number;
}

export interface FloorDropCollectionResult {
  readonly floorDrops: readonly FloorDropState[];
  readonly resources: ResourceBag;
  readonly collectedAny: boolean;
}

const copyDrop = (drop: FloorDropState): FloorDropState => ({
  ...drop,
  position: { ...drop.position },
});

/** Collects nearby drops without mutating the caller's drops or resource bag. */
export const floorDropCollectionPolicy = ({
  playerPosition,
  floorDrops,
  resources,
  collectDistance,
}: FloorDropCollectionInput): FloorDropCollectionResult => {
  let nextResources = { ...resources };
  const remaining: FloorDropState[] = [];
  let collectedAny = false;

  for (const drop of floorDrops) {
    if (distance(playerPosition, drop.position) > collectDistance) {
      remaining.push(copyDrop(drop));
      continue;
    }

    nextResources = collectResourcesWithinCapacity(nextResources, {
      wood: drop.resource === "wood" ? drop.amount : 0,
      stone: drop.resource === "stone" ? drop.amount : 0,
      scrap: drop.resource === "scrap" ? drop.amount : 0,
      essence: drop.resource === "essence" ? drop.amount : 0,
      bossCore: drop.resource === "bossCore" ? drop.amount : 0,
    });
    collectedAny = true;
  }

  return { floorDrops: remaining, resources: nextResources, collectedAny };
};
