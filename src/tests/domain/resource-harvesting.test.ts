import { describe, expect, it } from "vitest";
import { GameSession } from "../../domain/GameSession";
import {
  effectiveChunkRecipeFor,
  hasHarvestedNodeIdCharacterCapacity,
  HARVEST_INTERACTION_DISTANCE,
  harvestRewardsForObstacle,
  MAX_HARVESTED_NODE_ID_CHARS,
  MAX_HARVESTED_NODE_ID_LENGTH,
  MAX_HARVESTED_NODE_IDS,
} from "../../domain/resourceHarvesting";
import { decodeSave } from "../../domain/persistence/decodeSave";
import { toCurrentSaveStorageDocument } from "../../domain/persistence/currentSave";
import {
  isSaveV5Document,
  isSaveV5DocumentStructure,
} from "../../domain/persistence/saveV5";
import type {
  ChunkObstacle,
  ChunkRecipe,
  Vector2,
  WorldIdentity,
} from "../../domain/types";
import type { ChunkRecipeSource } from "../../domain/session/chunkRecipeCache";
import { generateChunk, WANDERER_WEB_V3 } from "../../domain/world";
import {
  createBrowserSaveStorage,
  SAVE_KEYS,
  type KeyValueStore,
} from "../../platform/storage/browserSaveStorage";

const world = Object.freeze({
  seed: "resource-harvest-test",
  generatorVersion: WANDERER_WEB_V3,
});

class StringStore implements KeyValueStore {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const generatedNodeFor = (kind: "tree" | "rock"): ChunkObstacle => {
  for (let radius = 2; radius <= 8; radius += 1)
    for (let y = -radius; y <= radius; y += 1)
      for (let x = -radius; x <= radius; x += 1) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== radius) continue;
        const node = generateChunk(world, { x, y }).obstacles.find(
          (obstacle) =>
            obstacle.kind === kind &&
            harvestRewardsForObstacle(obstacle) !== null,
        );
        if (node !== undefined) return node;
      }
  throw new Error(`No generated ${kind} node found for harvesting test.`);
};

const generatedTree = generatedNodeFor("tree");
const generatedRock = generatedNodeFor("rock");
const treeId = generatedTree.id;
const rockId = generatedRock.id;
const tree: ChunkObstacle = { ...generatedTree, position: { x: 1, y: 0 } };
const rock: ChunkObstacle = { ...generatedRock, position: { x: 0, y: 1 } };

const recipeSourceFor =
  (treePosition: Vector2 = tree.position): ChunkRecipeSource =>
  (identity, coordinate): ChunkRecipe => {
    const base = generateChunk(identity, coordinate);
    return coordinate.x === 0 && coordinate.y === 0
      ? {
          ...base,
          obstacles: [
            ...base.obstacles,
            { ...tree, position: { ...treePosition } },
            rock,
          ],
        }
      : base;
  };

const visibleObstacleIds = (session: GameSession): string[] =>
  session
    .presentation()
    .renderer.visibleChunks.flatMap((chunk) =>
      chunk.obstacles.map((item) => item.id),
    );

describe("resource harvesting policy", () => {
  it("assigns the explicit tree and rock reward bundles without changing Scrap", () => {
    expect(harvestRewardsForObstacle(tree)).toEqual({ wood: 24 });
    expect(harvestRewardsForObstacle(rock)).toEqual({ stone: 20, iron: 12 });
    expect(
      harvestRewardsForObstacle({
        id: "mountain:test",
        kind: "mountain",
        position: { x: 0, y: 0 },
      }),
    ).toBeNull();
    expect(HARVEST_INTERACTION_DISTANCE).toBe(2);
    expect(MAX_HARVESTED_NODE_IDS).toBe(4096);
  });

  it("counts the aggregate ID-string budget in UTF-16 code units", () => {
    const existing = new Set(["x".repeat(MAX_HARVESTED_NODE_ID_CHARS - 2)]);
    expect(hasHarvestedNodeIdCharacterCapacity(existing, "😀")).toBe(true);
    expect(hasHarvestedNodeIdCharacterCapacity(existing, "😀a")).toBe(false);
  });

  it("rejects an over-budget harvest atomically and keeps the saved document valid", () => {
    const seedPrefix = "tree:" + WANDERER_WEB_V3 + "::10000:512:0";
    const budgetWorld: WorldIdentity = {
      seed: "s".repeat(MAX_HARVESTED_NODE_ID_LENGTH - seedPrefix.length),
      generatorVersion: WANDERER_WEB_V3,
    };
    let targetNode: ChunkObstacle | null = null;
    const harvestedNodeIds: string[] = [];
    for (
      let coordinateX = 10_000;
      coordinateX < 10_000 + MAX_HARVESTED_NODE_IDS * 4 &&
      harvestedNodeIds.length < 1_024;
      coordinateX += 1
    ) {
      const recipe = generateChunk(budgetWorld, { x: coordinateX, y: 512 });
      for (const obstacle of recipe.obstacles) {
        if (harvestRewardsForObstacle(obstacle) === null) continue;
        if (targetNode === null) {
          targetNode = obstacle;
          expect(targetNode.id).toHaveLength(MAX_HARVESTED_NODE_ID_LENGTH);
          continue;
        }
        harvestedNodeIds.push(obstacle.id);
        if (harvestedNodeIds.length === 1_024) break;
      }
    }
    if (targetNode === null || harvestedNodeIds.length !== 1_024)
      throw new Error("could not build the valid aggregate-budget fixture");
    const harvestTarget = targetNode;
    expect(new Set(harvestedNodeIds).size).toBe(harvestedNodeIds.length);
    expect(harvestedNodeIds.every((id) => id.length === 1_024)).toBe(true);
    expect(harvestedNodeIds.length * MAX_HARVESTED_NODE_ID_LENGTH).toBe(
      MAX_HARVESTED_NODE_ID_CHARS,
    );

    const base = new GameSession().createValidCampfireSaveRequest(1);
    if (base === null)
      throw new Error("home campfire should issue a save request");
    const current = toCurrentSaveStorageDocument(base.document);
    const budgetSave = {
      ...current,
      world: budgetWorld,
      harvestedNodeIds,
    };
    const budgetRecipeSource: ChunkRecipeSource = (identity, coordinate) => {
      const recipe = generateChunk(identity, coordinate);
      return coordinate.x === 0 && coordinate.y === 0
        ? {
            ...recipe,
            obstacles: [
              ...recipe.obstacles,
              { ...harvestTarget, position: { x: 1, y: 0 } },
            ],
          }
        : recipe;
    };
    const session = new GameSession({
      saved: budgetSave,
      chunkRecipeSource: budgetRecipeSource,
    });
    const beforeResources = session.diagnostics().resources;
    session.harvestNode(harvestTarget.id);
    expect(session.presentation().ui.notice).toMatchObject({
      kind: "resource-node.rejected",
      reason: "depletion-size-limit",
    });
    expect(session.diagnostics().resources).toEqual(beforeResources);

    const request = session.createValidCampfireSaveRequest(1);
    if (request === null)
      throw new Error("home campfire should still issue a save request");
    const afterSave = toCurrentSaveStorageDocument(request.document);
    expect([...afterSave.harvestedNodeIds].sort()).toEqual(
      [...harvestedNodeIds].sort(),
    );
    expect(afterSave.resources).toEqual(beforeResources);
    expect(isSaveV5DocumentStructure(afterSave)).toBe(true);
    expect(decodeSave(JSON.stringify(afterSave))).toMatchObject({ ok: true });

    const store = new StringStore();
    const browserStorage = createBrowserSaveStorage(store);
    expect(browserStorage.commit(budgetSave)).toMatchObject({ ok: true });
    const primary = store.getItem(SAVE_KEYS.primary);
    const backup = store.getItem(SAVE_KEYS.backup);
    expect(primary).not.toBeNull();
    expect(primary?.length).toBeLessThanOrEqual(2_097_152);
    expect(backup).toBe(primary);
    expect(browserStorage.load()).toMatchObject({
      ok: true,
      source: "primary",
      document: { harvestedNodeIds },
    });
  }, 30_000);

  it("derives harvestable and depleted recipes without mutating deterministic bases", () => {
    const recipe: ChunkRecipe = {
      coordinate: { x: 0, y: 0 },
      key: "0:0",
      domainSeeds: { terrain: 1 },
      obstacles: [
        tree,
        rock,
        { id: "mountain:test", kind: "mountain", position: { x: 4, y: 4 } },
      ],
      campfires: [],
      spawns: [],
    };
    const intact = effectiveChunkRecipeFor(recipe, new Set());
    const depleted = effectiveChunkRecipeFor(recipe, new Set([treeId]));

    expect(recipe.obstacles).toEqual([tree, rock, recipe.obstacles[2]]);
    expect(
      intact.obstacles.map((item) => [item.id, item.harvestable ?? false]),
    ).toEqual([
      [treeId, true],
      [rockId, true],
      ["mountain:test", false],
    ]);
    expect(depleted.obstacles.map((item) => item.id)).toEqual([
      rockId,
      "mountain:test",
    ]);
  });
});

describe("GameSession resource harvesting", () => {
  it("awards each nearby node once, removes it from the read model, and persists only on explicit save", () => {
    const source = recipeSourceFor();
    const session = new GameSession({ world, chunkRecipeSource: source });
    const before = session.diagnostics().resources;

    session.harvestNode(treeId);
    expect(session.presentation().ui.notice).toMatchObject({
      kind: "resource-node.harvested",
      rewards: { wood: 24 },
    });
    expect(session.diagnostics().resources.wood).toBe(before.wood + 24);
    expect(session.diagnostics().resources.stone).toBe(before.stone);
    expect(session.diagnostics().resources.scrap).toBe(before.scrap);
    expect(visibleObstacleIds(session)).not.toContain(treeId);
    expect(visibleObstacleIds(session)).toContain(rockId);

    session.harvestNode(rockId);
    expect(session.diagnostics().resources.stone).toBe(before.stone + 20);
    expect(session.diagnostics().resources.iron).toBe(before.iron + 12);
    const afterBoth = session.diagnostics().resources;
    session.harvestNode(rockId);
    expect(session.diagnostics().resources).toEqual(afterBoth);
    expect(session.presentation().ui.notice).toMatchObject({
      kind: "resource-node.rejected",
      reason: "already-harvested",
    });

    const request = session.createValidCampfireSaveRequest(42);
    expect(request).not.toBeNull();
    if (request === null) return;
    const wire = toCurrentSaveStorageDocument(request.document);
    expect(wire.resources.iron).toBe(before.iron + 12);
    expect(wire.harvestedNodeIds).toEqual([rockId, treeId].sort());
    const decoded = decodeSave(JSON.stringify(wire));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    const loaded = new GameSession({
      saved: decoded.document,
      chunkRecipeSource: source,
    });
    expect(loaded.diagnostics().resources).toEqual(afterBoth);
    expect(visibleObstacleIds(loaded)).not.toContain(treeId);
    expect(visibleObstacleIds(loaded)).not.toContain(rockId);
  });

  it("routes to distant resources and harvests on arrival while rejecting overflows", () => {
    const farSession = new GameSession({
      world,
      chunkRecipeSource: recipeSourceFor({ x: 4, y: 0 }),
    });
    const beforeFar = farSession.diagnostics();
    farSession.harvestNode(treeId);
    expect(farSession.presentation().renderer.destination).not.toBeNull();
    expect(farSession.diagnostics().player.position).toEqual(
      beforeFar.player.position,
    );
    expect(farSession.diagnostics().destination).not.toBeNull();
    expect(farSession.diagnostics().resources).toEqual(beforeFar.resources);
    expect(visibleObstacleIds(farSession)).toContain(treeId);
    for (let step = 0; step < 40; step += 1) farSession.tick(0.1);
    expect(farSession.diagnostics().resources.wood).toBeGreaterThanOrEqual(
      beforeFar.resources.wood + 24,
    );
    expect(visibleObstacleIds(farSession)).not.toContain(treeId);

    const base = new GameSession().createValidCampfireSaveRequest(1);
    if (base === null)
      throw new Error("home campfire should issue a save request");
    const overflowSession = new GameSession({
      world,
      saved: {
        ...base.document,
        world,
        resources: {
          ...base.document.resources,
          wood: Number.MAX_SAFE_INTEGER - 1,
        },
      },
      chunkRecipeSource: recipeSourceFor(),
    });
    const beforeOverflow = overflowSession.diagnostics().resources;
    overflowSession.harvestNode(treeId);
    expect(overflowSession.presentation().ui.notice).toMatchObject({
      kind: "resource-node.rejected",
      reason: "inventory-limit",
    });
    expect(overflowSession.diagnostics().resources).toEqual(beforeOverflow);
    expect(visibleObstacleIds(overflowSession)).toContain(treeId);

    const safeIronSession = new GameSession({
      world,
      saved: {
        ...base.document,
        world,
        resources: {
          ...base.document.resources,
          iron: Number.MAX_SAFE_INTEGER - 12,
        },
      },
      chunkRecipeSource: recipeSourceFor(),
    });
    safeIronSession.harvestNode(rockId);
    expect(safeIronSession.diagnostics().resources.iron).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(safeIronSession.presentation().ui.notice).toMatchObject({
      kind: "resource-node.harvested",
      rewards: { stone: 20, iron: 12 },
    });

    const ironOverflowSession = new GameSession({
      world,
      saved: {
        ...base.document,
        world,
        resources: {
          ...base.document.resources,
          iron: Number.MAX_SAFE_INTEGER - 11,
        },
      },
      chunkRecipeSource: recipeSourceFor(),
    });
    const beforeIronOverflow = ironOverflowSession.diagnostics().resources;
    ironOverflowSession.harvestNode(rockId);
    expect(ironOverflowSession.presentation().ui.notice).toMatchObject({
      kind: "resource-node.rejected",
      reason: "inventory-limit",
    });
    expect(ironOverflowSession.diagnostics().resources).toEqual(
      beforeIronOverflow,
    );
    expect(visibleObstacleIds(ironOverflowSession)).toContain(rockId);
  });

  it("allows exact maximum balances while adding other resources", () => {
    const base = new GameSession().createValidCampfireSaveRequest(1);
    if (base === null)
      throw new Error("home campfire should issue a save request");
    const treeSession = new GameSession({
      world,
      saved: {
        ...base.document,
        world,
        resources: {
          ...base.document.resources,
          stone: Number.MAX_SAFE_INTEGER,
        },
      },
      chunkRecipeSource: recipeSourceFor(),
    });
    treeSession.harvestNode(treeId);
    expect(treeSession.diagnostics().resources.wood).toBe(
      base.document.resources.wood + 24,
    );
    expect(treeSession.diagnostics().resources.stone).toBe(
      Number.MAX_SAFE_INTEGER,
    );

    const invalidSession = () =>
      new GameSession({
        world,
        saved: {
          ...base.document,
          world,
          resources: {
            ...base.document.resources,
            wood: Number.MAX_SAFE_INTEGER + 1,
          },
        },
        chunkRecipeSource: recipeSourceFor(),
      });
    expect(invalidSession).toThrow("safe integers");
  });
});

it.skipIf(process.env.WANDERER_V5_NODE_BENCHMARK !== "1")(
  "validates 4,096 generated V3 IDs spread across unique chunks",
  () => {
    const request = new GameSession().createValidCampfireSaveRequest(1);
    if (request === null)
      throw new Error("home campfire should issue a benchmark save request");
    const base = toCurrentSaveStorageDocument(request.document);
    const benchmarkWorld = base.world;
    expect(benchmarkWorld.generatorVersion).toBe(WANDERER_WEB_V3);
    const harvestedNodeIds: string[] = [];
    const fixtureStartedAt = performance.now();
    let coordinateX = 128;
    while (harvestedNodeIds.length < MAX_HARVESTED_NODE_IDS) {
      const recipe = generateChunk(benchmarkWorld, { x: coordinateX, y: 512 });
      const node = recipe.obstacles.find(
        (obstacle) => harvestRewardsForObstacle(obstacle) !== null,
      );
      if (node !== undefined) harvestedNodeIds.push(node.id);
      coordinateX += 1;
      if (coordinateX > 128 + MAX_HARVESTED_NODE_IDS * 4)
        throw new Error(
          "could not build the maximum-scatter generated fixture",
        );
    }
    const fixtureMs = performance.now() - fixtureStartedAt;
    expect(new Set(harvestedNodeIds).size).toBe(MAX_HARVESTED_NODE_IDS);
    const candidate = { ...base, world: benchmarkWorld, harvestedNodeIds };
    const validationStartedAt = performance.now();
    expect(isSaveV5Document(candidate)).toBe(true);
    const validationMs = performance.now() - validationStartedAt;
    console.info(
      `[v5-node-benchmark] ids=${harvestedNodeIds.length} chunks=${new Set(harvestedNodeIds).size} fixtureMs=${fixtureMs.toFixed(1)} validationMs=${validationMs.toFixed(1)}`,
    );
  },
  600_000,
);
