import { describe, expect, it } from "vitest";
import {
  harvestApproachCandidatesFor,
  harvestDecisionFor,
  harvestLookupFor,
  type HarvestDecisionInput,
} from "../../domain/session/harvestDecision";
import {
  MAX_HARVESTED_NODE_ID_CHARS,
  MAX_HARVESTED_NODE_ID_LENGTH,
  MAX_HARVESTED_NODE_IDS,
} from "../../domain/resourceHarvesting";
import {
  emptyResources,
  type ChunkObstacle,
  type Vector2,
} from "../../domain/types";

const tree: ChunkObstacle = {
  id: "tree:test",
  kind: "tree",
  position: { x: 1, y: 0 },
};
const farTree: ChunkObstacle = {
  ...tree,
  position: { x: 10, y: 0 },
};

const inputFor = (
  overrides: Partial<HarvestDecisionInput> = {},
): HarvestDecisionInput => ({
  nodeId: tree.id,
  harvestedNodeIds: new Set<string>(),
  obstacle: tree,
  playerPosition: { x: 0, y: 0 },
  resources: emptyResources(),
  approachCandidates: [],
  ...overrides,
});

describe("harvest session decision", () => {
  it("rejects malformed and previously depleted IDs before recipe lookup", () => {
    expect(harvestLookupFor(undefined, new Set())).toEqual({
      kind: "reject",
      reason: "unknown-node",
    });
    expect(harvestLookupFor("", new Set())).toEqual({
      kind: "reject",
      reason: "unknown-node",
    });
    expect(
      harvestLookupFor("x".repeat(MAX_HARVESTED_NODE_ID_LENGTH + 1), new Set()),
    ).toEqual({ kind: "reject", reason: "unknown-node" });
    expect(harvestLookupFor(tree.id, new Set([tree.id]))).toEqual({
      kind: "reject",
      reason: "already-harvested",
    });
    expect(harvestLookupFor(tree.id, new Set())).toEqual({
      kind: "lookup",
      nodeId: tree.id,
    });
  });

  it("returns every remaining rejection without mutating its inputs", () => {
    expect(harvestDecisionFor(inputFor({ obstacle: undefined }))).toEqual({
      kind: "reject",
      reason: "unknown-node",
    });
    expect(
      harvestDecisionFor(
        inputFor({
          obstacle: {
            id: "mountain:test",
            kind: "mountain",
            position: tree.position,
          },
        }),
      ),
    ).toEqual({ kind: "reject", reason: "unknown-node" });
    expect(
      harvestDecisionFor(
        inputFor({ obstacle: farTree, playerPosition: { x: 0, y: 0 } }),
      ),
    ).toEqual({ kind: "reject", reason: "out-of-reach" });

    const fullDepletionSet = new Set(
      Array.from(
        { length: MAX_HARVESTED_NODE_IDS },
        (_, index) => "old:" + index,
      ),
    );
    expect(
      harvestDecisionFor(inputFor({ harvestedNodeIds: fullDepletionSet })),
    ).toEqual({ kind: "reject", reason: "depletion-limit" });

    const idBudgetCount =
      MAX_HARVESTED_NODE_ID_CHARS / MAX_HARVESTED_NODE_ID_LENGTH;
    const fullCharacterBudget = new Set(
      Array.from(
        { length: idBudgetCount },
        (_, index) => String(index).padStart(4, "0") + "x".repeat(1020),
      ),
    );
    expect(
      harvestDecisionFor(inputFor({ harvestedNodeIds: fullCharacterBudget })),
    ).toEqual({ kind: "reject", reason: "depletion-size-limit" });

    expect(
      harvestDecisionFor(
        inputFor({
          resources: {
            ...emptyResources(),
            wood: Number.MAX_SAFE_INTEGER - 23,
          },
        }),
      ),
    ).toEqual({ kind: "reject", reason: "inventory-limit" });
    expect(fullDepletionSet.size).toBe(MAX_HARVESTED_NODE_IDS);
    expect(fullCharacterBudget.size).toBe(idBudgetCount);
  });

  it("preserves the released approach candidate geometry and tie ordering", () => {
    const player: Vector2 = { x: 0, y: 0 };
    const candidates = harvestApproachCandidatesFor(player, farTree);
    const expected = Array.from({ length: 16 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 16;
      return [1.5, 1.65, 1.8, 1.95].map((gap) => ({
        x: farTree.position.x + Math.cos(angle) * gap,
        y: farTree.position.y + Math.sin(angle) * gap,
      }));
    }).flat();
    expect(candidates).toEqual(expected);
    expect(candidates).toHaveLength(64);
    expect(candidates[0]?.x).toBeCloseTo(11.5, 12);
    expect(candidates[1]?.x).toBeCloseTo(11.65, 12);

    const rock = {
      ...farTree,
      id: "rock:test",
      kind: "rock" as const,
      radius: 1.2,
    };
    const rockCandidates = harvestApproachCandidatesFor(player, rock);
    const westCandidate = rockCandidates.find(
      (point) => point.x < 8 && Math.abs(point.y) < 1e-8,
    );
    expect(westCandidate?.x).toBeCloseTo(7.3, 8);
    expect(harvestApproachCandidatesFor({ x: 8.9, y: 0 }, rock)).toEqual([]);
    expect(harvestApproachCandidatesFor({ x: -1, y: 0 }, tree)).toEqual([]);
  });

  it("chooses approach before commit limits and leaves state untouched", () => {
    const harvestedNodeIds = new Set(
      Array.from(
        { length: MAX_HARVESTED_NODE_IDS },
        (_, index) => "old:" + index,
      ),
    );
    const resources = { ...emptyResources(), wood: Number.MAX_SAFE_INTEGER };
    const destination = { x: 3, y: 4 };
    const input = inputFor({
      obstacle: farTree,
      playerPosition: { x: 0, y: 0 },
      harvestedNodeIds,
      resources,
      approachCandidates: [destination],
    });
    const decision = harvestDecisionFor(input);
    expect(decision).toEqual({ kind: "approach", destination });
    if (decision.kind !== "approach")
      throw new Error("expected the far node to produce an approach decision");
    expect(decision.destination).not.toBe(destination);
    expect(harvestedNodeIds.size).toBe(MAX_HARVESTED_NODE_IDS);
    expect(resources.wood).toBe(Number.MAX_SAFE_INTEGER);

    expect(harvestDecisionFor({ ...input, approachCandidates: [] })).toEqual({
      kind: "reject",
      reason: "out-of-reach",
    });
    expect(
      harvestDecisionFor({
        ...input,
        approachCandidates: [
          { x: 2, y: 1 },
          { x: 2, y: -1 },
        ],
      }),
    ).toEqual({ kind: "approach", destination: { x: 2, y: -1 } });
  });

  it("returns a complete reward projection without mutating session inputs", () => {
    const harvestedNodeIds = new Set(["tree:other"]);
    const resources = emptyResources();
    const resourcesBefore = { ...resources };
    const idsBefore = [...harvestedNodeIds];
    const obstacleBefore = { ...tree, position: { ...tree.position } };
    const decision = harvestDecisionFor(
      inputFor({ harvestedNodeIds, resources, obstacle: tree }),
    );
    expect(decision).toEqual({
      kind: "commit",
      rewards: { wood: 24 },
      nextResources: { ...resources, wood: 24 },
    });
    expect(harvestedNodeIds).toEqual(new Set(idsBefore));
    expect(resources).toEqual(resourcesBefore);
    expect(tree).toEqual(obstacleBefore);
  });
});
