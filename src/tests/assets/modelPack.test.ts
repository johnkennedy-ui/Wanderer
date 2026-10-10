import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const modelsDirectory = join(process.cwd(), "public/assets/models");
const componentBytes: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};
const typeComponents: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

type Accessor = {
  readonly bufferView: number;
  readonly byteOffset?: number;
  readonly componentType: number;
  readonly count: number;
  readonly type: string;
  readonly min?: readonly number[];
  readonly max?: readonly number[];
};
type BufferView = {
  readonly buffer: number;
  readonly byteOffset?: number;
  readonly byteLength: number;
};
type Glb = {
  readonly accessors: readonly Accessor[];
  readonly bufferViews: readonly BufferView[];
  readonly buffers: readonly {
    readonly byteLength: number;
    readonly uri?: string;
  }[];
  readonly images?: readonly {
    readonly uri?: string;
    readonly bufferView?: number;
  }[];
  readonly meshes: readonly {
    readonly primitives: readonly {
      readonly attributes: Readonly<Record<string, number>>;
      readonly indices?: number;
    }[];
  }[];
};

const parseGlb = (
  filename: string,
): { readonly gltf: Glb; readonly bin: Buffer } => {
  const file = readFileSync(join(modelsDirectory, filename));
  expect(file.subarray(0, 4).toString("ascii")).toBe("glTF");
  expect(file.readUInt32LE(4)).toBe(2);
  expect(file.readUInt32LE(8)).toBe(file.length);
  const jsonLength = file.readUInt32LE(12);
  expect(file.subarray(16, 20).toString("ascii")).toBe("JSON");
  const jsonEnd = 20 + jsonLength;
  const binLength = file.readUInt32LE(jsonEnd);
  expect(file.subarray(jsonEnd + 4, jsonEnd + 8).toString("ascii")).toBe(
    "BIN\0",
  );
  expect(jsonEnd + 8 + binLength).toBe(file.length);
  return {
    gltf: JSON.parse(file.subarray(20, jsonEnd).toString("utf8")) as Glb,
    bin: file.subarray(jsonEnd + 8),
  };
};

const manifest = JSON.parse(
  readFileSync(join(modelsDirectory, "model-manifest.json"), "utf8"),
) as {
  readonly assets: Readonly<Record<string, unknown>> & {
    readonly buildings: { readonly Healer: string };
  };
};
const collectAssetPaths = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectAssetPaths);
  if (value !== null && typeof value === "object")
    return Object.values(value).flatMap(collectAssetPaths);
  return [];
};
const mappedAssets = collectAssetPaths(manifest.assets).sort();

describe("Wanderer model pack", () => {
  it("maps every supplied GLB exactly once, including Healer to the healing hut", () => {
    const rootFiles = readdirSync(modelsDirectory)
      .filter((file) => file.endsWith(".glb"))
      .sort();
    const rootMappedAssets = mappedAssets.filter(
      (asset) => !asset.includes("/"),
    );
    expect(new Set(mappedAssets).size).toBe(mappedAssets.length);
    expect(rootFiles).toEqual(rootMappedAssets);
    expect(mappedAssets).toHaveLength(26);
    expect(manifest.assets.buildings.Healer).toBe("building_healing_hut.glb");
  });

  it.each(mappedAssets)(
    "validates embedded GLB structure for %s",
    (filename) => {
      const { gltf, bin } = parseGlb(filename);
      expect(gltf.buffers).toHaveLength(1);
      expect(gltf.buffers[0].byteLength).toBe(bin.length);
      expect(gltf.buffers[0].uri).toBeUndefined();
      expect(gltf.images ?? []).toEqual([]);

      for (const view of gltf.bufferViews) {
        expect(view.buffer).toBe(0);
        const start = view.byteOffset ?? 0;
        expect(start).toBeGreaterThanOrEqual(0);
        expect(start + view.byteLength).toBeLessThanOrEqual(bin.length);
      }
      for (const accessor of gltf.accessors) {
        const view = gltf.bufferViews[accessor.bufferView];
        expect(view).toBeDefined();
        const bytes =
          componentBytes[accessor.componentType] *
          typeComponents[accessor.type];
        expect(bytes).toBeGreaterThan(0);
        expect(
          (accessor.byteOffset ?? 0) + accessor.count * bytes,
        ).toBeLessThanOrEqual(view.byteLength);
        if (accessor.min !== undefined || accessor.max !== undefined) {
          const componentCount = typeComponents[accessor.type];
          expect(componentCount).toBeGreaterThan(0);
          if (accessor.min !== undefined)
            expect(accessor.min).toHaveLength(componentCount);
          if (accessor.max !== undefined)
            expect(accessor.max).toHaveLength(componentCount);
          if (accessor.min !== undefined && accessor.max !== undefined)
            for (let index = 0; index < componentCount; index += 1)
              expect(accessor.min[index]).toBeLessThanOrEqual(
                accessor.max[index],
              );
        }
      }
      for (const primitive of gltf.meshes.flatMap((mesh) => mesh.primitives)) {
        const positions = gltf.accessors[primitive.attributes.POSITION];
        expect(positions).toBeDefined();
        expect(positions.type).toBe("VEC3");
        expect(positions.min).toHaveLength(3);
        expect(positions.max).toHaveLength(3);
        expect(primitive.indices).toBeDefined();
        const indices = gltf.accessors[primitive.indices ?? -1];
        expect(indices).toBeDefined();
        expect(indices.type).toBe("SCALAR");
        const view = gltf.bufferViews[indices.bufferView];
        const indexSize = componentBytes[indices.componentType];
        for (
          let offset = indices.byteOffset ?? 0;
          offset < indices.count * indexSize;
          offset += indexSize
        ) {
          const value =
            indexSize === 2
              ? bin.readUInt16LE((view.byteOffset ?? 0) + offset)
              : bin.readUInt32LE((view.byteOffset ?? 0) + offset);
          expect(value).toBeLessThan(positions.count);
        }
      }
    },
  );
});
