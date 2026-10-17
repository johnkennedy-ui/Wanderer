import { distance } from "../math";
import type { GameNotice } from "../notices";
import { tryAddResourceBags } from "../resourceBalances";
import {
  HARVEST_INTERACTION_DISTANCE,
  hasHarvestedNodeIdCharacterCapacity,
  harvestRewardsForObstacle,
  MAX_HARVESTED_NODE_ID_LENGTH,
  MAX_HARVESTED_NODE_IDS,
} from "../resourceHarvesting";
import type {
  ChunkObstacle,
  HarvestRewards,
  ReadonlyResourceBag,
  ResourceBag,
  Vector2,
} from "../types";

type HarvestRejectionReason = Extract<
  GameNotice,
  { readonly kind: "resource-node.rejected" }
>["reason"];

export type HarvestLookup =
  | { readonly kind: "lookup"; readonly nodeId: string }
  | { readonly kind: "reject"; readonly reason: HarvestRejectionReason };

export type HarvestDecision =
  | { readonly kind: "reject"; readonly reason: HarvestRejectionReason }
  | { readonly kind: "approach"; readonly destination: Vector2 }
  | {
      readonly kind: "commit";
      readonly rewards: HarvestRewards;
      readonly nextResources: ResourceBag;
    };

export interface HarvestDecisionInput {
  readonly nodeId: string;
  readonly harvestedNodeIds: ReadonlySet<string>;
  readonly obstacle: ChunkObstacle | undefined;
  readonly playerPosition: Vector2;
  readonly resources: ReadonlyResourceBag;
  /** Points that passed terrain/wall queries in their released angle/gap order. */
  readonly approachCandidates: readonly Vector2[];
}

/** Fast, pure validation before GameSession performs any raw recipe lookup. */
export const harvestLookupFor = (
  nodeId: unknown,
  harvestedNodeIds: ReadonlySet<string>,
): HarvestLookup => {
  if (
    typeof nodeId !== "string" ||
    nodeId.length === 0 ||
    nodeId.length > MAX_HARVESTED_NODE_ID_LENGTH
  )
    return { kind: "reject", reason: "unknown-node" };
  if (harvestedNodeIds.has(nodeId))
    return { kind: "reject", reason: "already-harvested" };
  return { kind: "lookup", nodeId };
};

/** Generates candidates in released angle/gap order for session collision queries. */
export const harvestApproachCandidatesFor = (
  playerPosition: Vector2,
  obstacle: ChunkObstacle,
): Vector2[] => {
  const rockRadius = obstacle.kind === "rock" ? (obstacle.radius ?? 0.9) : 0;
  if (
    distance(playerPosition, obstacle.position) <=
    HARVEST_INTERACTION_DISTANCE + rockRadius
  )
    return [];
  return Array.from({ length: 16 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 16;
    return [1.5, 1.65, 1.8, 1.95].map((gap) => ({
      x: obstacle.position.x + Math.cos(angle) * (rockRadius + gap),
      y: obstacle.position.y + Math.sin(angle) * (rockRadius + gap),
    }));
  }).flat();
};

/** Pure eligibility, approach, and atomic reward calculation for one harvest. */
export const harvestDecisionFor = (
  input: HarvestDecisionInput,
): HarvestDecision => {
  const lookup = harvestLookupFor(input.nodeId, input.harvestedNodeIds);
  if (lookup.kind === "reject") return lookup;

  const obstacle = input.obstacle;
  const rewards =
    obstacle === undefined ? null : harvestRewardsForObstacle(obstacle);
  if (obstacle === undefined || rewards === null)
    return { kind: "reject", reason: "unknown-node" };

  const rockRadius = obstacle.kind === "rock" ? (obstacle.radius ?? 0.9) : 0;
  if (
    distance(input.playerPosition, obstacle.position) >
    HARVEST_INTERACTION_DISTANCE + rockRadius
  ) {
    const destination = [...input.approachCandidates].sort(
      (left, right) =>
        distance(input.playerPosition, left) -
          distance(input.playerPosition, right) ||
        left.x - right.x ||
        left.y - right.y,
    )[0];
    return destination === undefined
      ? { kind: "reject", reason: "out-of-reach" }
      : { kind: "approach", destination: { ...destination } };
  }

  if (input.harvestedNodeIds.size >= MAX_HARVESTED_NODE_IDS)
    return { kind: "reject", reason: "depletion-limit" };
  if (
    !hasHarvestedNodeIdCharacterCapacity(input.harvestedNodeIds, lookup.nodeId)
  )
    return { kind: "reject", reason: "depletion-size-limit" };

  const nextResources = tryAddResourceBags(input.resources, rewards);
  if (nextResources === null)
    return { kind: "reject", reason: "inventory-limit" };
  return { kind: "commit", rewards, nextResources };
};
