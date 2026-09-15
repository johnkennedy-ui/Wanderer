import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { ChunkRecipe } from "../../domain/types";
import {
  EnvironmentProjection,
  environmentDescriptorsFor,
  environmentFilenameFor,
  type EnvironmentAssetCache,
} from "../../platform/render/environmentPresentationHelpers";
import { rendererSnapshot } from "./renderer-test-helpers";

const chunk = (x: number, y: number, cosmetic = 17): ChunkRecipe => ({
  coordinate: { x, y }, key: `${x}:${y}`, domainSeeds: { cosmetic }, campfires: [], spawns: [],
  obstacles: [{ id: `rock:${x}:${y}`, position: { x: x * 16 + 1, y: y * 16 + 1 } }, { id: `tree:${x}:${y}`, kind: "tree", radius: 1, position: { x: x * 16 + 14, y: y * 16 + 14 } }, { id: `water:${x}:${y}`, kind: "water", radius: 2, position: { x: x * 16 + 8, y: y * 16 + 8 } }],
});
const snapshot = (chunks: readonly ChunkRecipe[]) => ({ ...rendererSnapshot(), visibleChunks: chunks, visibleBuildings: [], enemies: [], projectiles: [], crescentAttacks: [] });
const scene = (): THREE.Group => { const group = new THREE.Group(); group.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())); return group; };

describe("environment presentation", () => {
  it("maps expansion keys and deterministically describes legacy/V3 obstacles without replacing water", () => {
    expect(environmentFilenameFor("environment-tree-pine-a")).toBe("expansion-v1/tree_pine_a.glb");
    const normal = environmentDescriptorsFor(snapshot([chunk(1, -2)]));
    const reversed = environmentDescriptorsFor(snapshot([chunk(-3, 2), chunk(1, -2)])).filter((item) => item.id.includes("1:-2"));
    expect(normal.filter((item) => item.id.includes("1:-2"))).toEqual(reversed);
    expect(normal.map((item) => item.id)).toContain("rock:1:-2");
    expect(normal.map((item) => item.id)).toContain("tree:1:-2");
    expect(normal.map((item) => item.id)).not.toContain("water:1:-2");
    expect(normal.find((item) => item.id === "rock:1:-2")?.footprint).toBe(0.9);
    expect(normal.filter((item) => item.id.startsWith("environment:1:-2")).length).toBeLessThanOrEqual(2);
  });

  it("caps decoration and clears it around player, campfire, spawn, buildings and obstacles", () => {
    const base = chunk(0, 0); const first = environmentDescriptorsFor(snapshot([base]));
    expect(first.filter((item) => item.id.startsWith("environment:")).length).toBeLessThanOrEqual(2);
    const blocked = { ...base, obstacles: [...base.obstacles, { id: "cover", position: first.find((item) => item.id.endsWith(":0"))!.position }] };
    expect(environmentDescriptorsFor(snapshot([blocked])).filter((item) => item.id.startsWith("environment:"))).toHaveLength(1);
  });

  it("retains fallback until attached, culls/revisits, disposes clones, and discards stale completion", async () => {
    const deferred: ((value: THREE.Group | undefined) => void)[] = [];
    const cache: EnvironmentAssetCache = { acquire: vi.fn<EnvironmentAssetCache["acquire"]>(() => new Promise<THREE.Group | undefined>((resolve) => deferred.push(resolve))) };
    const projection = new EnvironmentProjection(cache); const fallback = vi.fn(); const frame = snapshot([chunk(-1, 0)]);
    projection.render(frame, fallback); expect(projection.diagnostics().instances).toBe(3);
    const late = scene(); const geometryDispose = vi.spyOn((late.children[0] as THREE.Mesh).geometry, "dispose");
    projection.render(snapshot([]), fallback); deferred.forEach((resolve) => resolve(late)); await Promise.resolve();
    expect(geometryDispose).toHaveBeenCalled(); expect(projection.diagnostics().instances).toBe(0);
    projection.render(frame, fallback); expect(cache.acquire).toHaveBeenCalledTimes(6);
    projection.dispose(); expect(projection.diagnostics().disposed).toBe(true);
  });

  it("keeps failed assets on the established fallback without a retry loop", async () => {
    const cache: EnvironmentAssetCache = { acquire: vi.fn<EnvironmentAssetCache["acquire"]>(async () => undefined) };
    const projection = new EnvironmentProjection(cache); const fallback = vi.fn(); const frame = snapshot([chunk(0, 1)]);
    projection.render(frame, fallback); await Promise.resolve(); projection.render(frame, fallback);
    expect(cache.acquire).toHaveBeenCalledTimes(3);
    expect(fallback).not.toHaveBeenCalledWith("rock:0:1", true);
    projection.dispose();
  });
});
