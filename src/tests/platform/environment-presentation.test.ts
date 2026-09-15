import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { ChunkRecipe } from "../../domain/types";
import { generateChunk, WANDERER_WEB_V3 } from "../../domain/world";
import {
  EnvironmentProjection,
  environmentBaseRadiusFor,
  fitEnvironmentModel,
  environmentDescriptorsFor,
  environmentFilenameFor,
  type EnvironmentAssetCache,
} from "../../platform/render/environmentPresentationHelpers";
import { rendererSnapshot } from "./renderer-test-helpers";

const chunk = (x: number, y: number, cosmetic = 17): ChunkRecipe => ({
  coordinate: { x, y },
  key: `${x}:${y}`,
  domainSeeds: { cosmetic },
  campfires: [],
  spawns: [],
  obstacles: [
    { id: `rock:${x}:${y}`, position: { x: x * 16 + 1, y: y * 16 + 1 } },
    {
      id: `tree:${x}:${y}`,
      kind: "tree",
      radius: 1,
      position: { x: x * 16 + 14, y: y * 16 + 14 },
    },
    {
      id: `water:${x}:${y}`,
      kind: "water",
      radius: 2,
      position: { x: x * 16 + 8, y: y * 16 + 8 },
    },
  ],
});
const snapshot = (chunks: readonly ChunkRecipe[]) => ({
  ...rendererSnapshot(),
  visibleChunks: chunks,
  visibleBuildings: [],
  enemies: [],
  projectiles: [],
  crescentAttacks: [],
});
const scene = (): THREE.Group => {
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()),
  );
  return group;
};

const loadAsset = async (file: string): Promise<THREE.Group> => {
  const bytes = readFileSync(`public/assets/models/expansion-v1/${file}.glb`);
  return (await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, ""))
    .scene;
};

const horizontalRadius = (
  object: THREE.Object3D,
  center: THREE.Vector3,
): number => {
  object.updateWorldMatrix(true, true);
  let result = 0;
  const point = new THREE.Vector3();
  object.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return;
    const positions = part.geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index += 1) {
      point
        .fromBufferAttribute(positions, index)
        .applyMatrix4(part.matrixWorld);
      result = Math.max(
        result,
        Math.hypot(point.x - center.x, point.z - center.z),
      );
    }
  });
  return result;
};

describe("environment presentation", () => {
  it.each([
    "tree_pine_a",
    "tree_broadleaf_b",
    "tree_dead_a",
    "rock_granite_b",
    "rock_moss_a",
  ])(
    "fits actual %s GLB footprint at arbitrary world positions without giant canopies",
    async (file) => {
      const model = await loadAsset(file);
      const nativeRadius = environmentBaseRadiusFor(model);
      const parent = new THREE.Group();
      parent.position.set(-137.4, 0.014, 92.6);
      parent.rotation.y = 1.937;
      parent.scale.set(1.7, 0.8, 2.3);
      parent.add(model);
      expect(environmentBaseRadiusFor(model)).toBeCloseTo(nativeRadius, 8);
      parent.scale.copy(fitEnvironmentModel(model, 0.9));
      parent.updateMatrixWorld(true);
      const bearing =
        model.getObjectByName("trunk") ?? model.getObjectByName("rock")!;
      expect(horizontalRadius(bearing, parent.position)).toBeCloseTo(0.9, 6);
      const bounds = new THREE.Box3().setFromObject(model);
      expect(bounds.min.y).toBeCloseTo(0.014, 6);
      if (file.startsWith("tree")) {
        expect(bounds.max.y - bounds.min.y).toBeLessThanOrEqual(3.400001);
        expect(horizontalRadius(model, parent.position)).toBeLessThanOrEqual(
          0.9 * 1.8 + 0.000001,
        );
      }
    },
  );

  it("marks failed loads terminal and retains fallback for empty GLB scenes", async () => {
    const projection = new EnvironmentProjection({
      acquire: async () => new THREE.Group(),
    });
    const fallback = vi.fn();
    projection.render(snapshot([chunk(0, 0)]), fallback);
    await Promise.resolve();
    expect(projection.diagnostics().pendingInstances).toBe(0);
    expect(projection.diagnostics().fallbackInstances).toBe(2);
    expect(fallback).not.toHaveBeenCalledWith(expect.any(String), true);
    projection.dispose();
  });

  it("maps expansion keys and deterministically describes legacy/V3 obstacles without replacing water", () => {
    expect(environmentFilenameFor("environment-tree-pine-a")).toBe(
      "expansion-v1/tree_pine_a.glb",
    );
    const normal = environmentDescriptorsFor(snapshot([chunk(1, -2)]));
    const reversed = environmentDescriptorsFor(
      snapshot([chunk(-3, 2), chunk(1, -2)]),
    ).filter((item) => item.id.includes("1:-2"));
    expect(normal.filter((item) => item.id.includes("1:-2"))).toEqual(reversed);
    expect(normal.map((item) => item.id)).toContain("rock:1:-2");
    expect(normal.map((item) => item.id)).toContain("tree:1:-2");
    expect(normal.map((item) => item.id)).not.toContain("water:1:-2");
    expect(normal.find((item) => item.id === "rock:1:-2")?.footprint).toBe(0.9);
    expect(
      normal.filter((item) => item.id.startsWith("environment:1:-2")).length,
    ).toBeLessThanOrEqual(2);
  });

  it("caps cosmetic decoration, preserves it during player travel and excludes interaction footprints", () => {
    const base = Array.from({ length: 160 }, (_, cosmetic) => ({
      ...chunk(1, 1, cosmetic),
      obstacles: [],
    })).find((candidate) =>
      environmentDescriptorsFor(snapshot([candidate])).some((item) =>
        item.id.startsWith("environment:"),
      ),
    )!;
    const first = environmentDescriptorsFor(snapshot([base]));
    const decorations = first.filter((item) =>
      item.id.startsWith("environment:"),
    );
    expect(decorations.length).toBeGreaterThan(0);
    expect(decorations.length).toBeLessThanOrEqual(2);
    const blocked = {
      ...base,
      obstacles: [
        ...base.obstacles,
        { id: "cover", radius: 8, position: decorations[0]!.position },
      ],
    };
    expect(
      environmentDescriptorsFor(snapshot([blocked])).filter((item) =>
        item.id.startsWith("environment:"),
      ).length,
    ).toBeLessThan(decorations.length);
    expect(
      environmentDescriptorsFor({
        ...snapshot([base]),
        player: {
          ...snapshot([base]).player,
          position: decorations[0]!.position,
        },
      }),
    ).toEqual(first);
    const home = generateChunk(
      { seed: "environment-contract", generatorVersion: WANDERER_WEB_V3 },
      { x: 0, y: 0 },
    );
    const position = decorations[0]!.position;
    const cases = [
      snapshot([{ ...base, campfires: [{ ...home.campfires[0]!, position }] }]),
      snapshot([{ ...base, spawns: [{ ...home.spawns[0]!, position }] }]),
      {
        ...snapshot([base]),
        visibleBuildings: [
          {
            id: "building:environment:1",
            kind: "Healer" as const,
            level: 1 as const,
            position,
          },
        ],
      },
      snapshot([
        base,
        {
          ...chunk(2, 1),
          obstacles: [
            {
              id: "neighbor-water",
              kind: "water",
              radius: 8,
              position: { x: position.x + 3, y: position.y },
            },
          ],
        },
      ]),
    ];
    for (const frame of cases)
      expect(
        environmentDescriptorsFor(frame).map((item) => item.id),
      ).not.toContain(decorations[0]!.id);
    expect(
      environmentDescriptorsFor(
        snapshot([{ ...base, coordinate: { x: 0, y: 0 } }]),
      ).filter((item) => item.id.startsWith("environment:")),
    ).toEqual([]);
  });

  it("measures native vertex bounds when an injected model has no named bearing part", () => {
    const model = new THREE.Group();
    model.add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(2, 2, 1),
        new THREE.MeshBasicMaterial(),
      ),
    );
    expect(environmentBaseRadiusFor(model)).toBeCloseTo(2, 1);
  });

  it("retains fallback until attached, culls/revisits, disposes clones, and discards stale completion", async () => {
    const deferred: ((value: THREE.Group | undefined) => void)[] = [];
    const cache: EnvironmentAssetCache = {
      acquire: vi.fn<EnvironmentAssetCache["acquire"]>(
        () =>
          new Promise<THREE.Group | undefined>((resolve) =>
            deferred.push(resolve),
          ),
      ),
    };
    const projection = new EnvironmentProjection(cache);
    const fallback = vi.fn();
    const frame = snapshot([chunk(-1, 0)]);
    projection.render(frame, fallback);
    const count = environmentDescriptorsFor(frame).length;
    expect(count).toBeGreaterThanOrEqual(2);
    expect(projection.diagnostics().instances).toBe(count);
    const late = deferred.map(() => scene());
    const geometryDisposes = late.map((model) =>
      vi.spyOn((model.children[0] as THREE.Mesh).geometry, "dispose"),
    );
    projection.render(snapshot([]), fallback);
    deferred.forEach((resolve, index) => resolve(late[index]));
    await Promise.resolve();
    geometryDisposes.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    expect(projection.diagnostics().instances).toBe(0);
    projection.render(frame, fallback);
    expect(cache.acquire).toHaveBeenCalledTimes(count * 2);
    projection.dispose();
    expect(projection.diagnostics().disposed).toBe(true);
  });

  it("keeps failed assets on the established fallback without a retry loop", async () => {
    const cache: EnvironmentAssetCache = {
      acquire: vi.fn<EnvironmentAssetCache["acquire"]>(async () => undefined),
    };
    const projection = new EnvironmentProjection(cache);
    const fallback = vi.fn();
    const frame = snapshot([chunk(0, 1)]);
    projection.render(frame, fallback);
    await Promise.resolve();
    projection.render(frame, fallback);
    expect(cache.acquire).toHaveBeenCalledTimes(2);
    expect(fallback).not.toHaveBeenCalledWith("rock:0:1", true);
    projection.dispose();
  });
});
