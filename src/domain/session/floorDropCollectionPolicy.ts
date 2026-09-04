import { resourceDefinitions } from "../../data/definitions";
import { distance } from "../math";
import type {
  FloorDropState,
  ReadonlyResourceBag,
  ResourceBag,
  Vector2,
} from "../types";
import { clampResourcesToCapacity } from "./economy";

export interface FloorDropCollectionInput {
  readonly playerPosition: Vector2;
  readonly floorDrops: readonly FloorDropState[];
  readonly resources: ReadonlyResourceBag;
  readonly materialCapacity: number;
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
  materialCapacity,
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

    const capacityRemaining = resourceDefinitions[drop.resource].storageLimited
      ? Math.max(0, materialCapacity - nextResources[drop.resource])
      : Number.POSITIVE_INFINITY;
    const collectedAmount = Math.min(drop.amount, capacityRemaining);
    if (collectedAmount <= 0) {
      remaining.push(copyDrop(drop));
      continue;
    }

    nextResources = clampResourcesToCapacity(
      {
        ...nextResources,
        [drop.resource]: nextResources[drop.resource] + collectedAmount,
      },
      materialCapacity,
    );
    collectedAny = true;
    if (collectedAmount < drop.amount)
      remaining.push(
        copyDrop({ ...drop, amount: drop.amount - collectedAmount }),
      );
  }

  return { floorDrops: remaining, resources: nextResources, collectedAny };
};
