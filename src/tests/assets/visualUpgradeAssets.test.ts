import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const models = join(process.cwd(), "public/assets/models");
const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const glbs = (directory: string) =>
  readdirSync(directory)
    .filter((file) => file.endsWith(".glb"))
    .sort();

type Vec3 = readonly [number, number, number];
type Part = { positions: Vec3[]; normals: Vec3[]; indices: number[] };
const actorParts = (file: string): Record<string, Part> => {
  const bytes = readFileSync(file);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(
    bytes.subarray(20, 20 + jsonLength).toString("utf8"),
  ) as {
    accessors: {
      bufferView: number;
      byteOffset?: number;
      count: number;
      componentType: number;
    }[];
    bufferViews: { byteOffset?: number }[];
    meshes: {
      name: string;
      primitives: { attributes: Record<string, number>; indices: number }[];
    }[];
  };
  const binOffset = 20 + jsonLength + 8;
  const values = (accessorIndex: number, width: number) => {
    const accessor = gltf.accessors[accessorIndex];
    const offset =
      binOffset +
      (gltf.bufferViews[accessor.bufferView].byteOffset ?? 0) +
      (accessor.byteOffset ?? 0);
    return Array.from({ length: accessor.count }, (_, index) =>
      Array.from({ length: width }, (_, component) =>
        accessor.componentType === 5126
          ? bytes.readFloatLE(offset + (index * width + component) * 4)
          : bytes.readUInt16LE(offset + (index * width + component) * 2),
      ),
    );
  };
  return Object.fromEntries(
    gltf.meshes.map((mesh) => {
      const primitive = mesh.primitives[0];
      return [
        mesh.name,
        {
        positions: values(primitive.attributes.POSITION, 3) as unknown as Vec3[],
        normals: values(primitive.attributes.NORMAL, 3) as unknown as Vec3[],
          indices: values(primitive.indices, 1).flat() as number[],
        },
      ];
    }),
  );
};
const bounds = (part: Part) =>
  [0, 1, 2].map((axis) => [
    Math.min(...part.positions.map((point) => point[axis])),
    Math.max(...part.positions.map((point) => point[axis])),
  ]);

const originalHashes: Record<string, string> = {
  "building_campfire.glb":
    "fef66d72abc3bdc0dfc81f070da908e70db60f6e9dad51ac3e7224cb29f5a422",
  "building_farm.glb":
    "e0790346592ca183f16259e15232f6c5115e3d820001bf2232b36b1bc4b670ca",
  "building_healing_hut.glb":
    "120743fb51dd7a2c142a14144d45da0f4089d13fb3e7e99e1c1ba26e3e0b7557",
  "building_storage.glb":
    "27e3dfd99e96e4c0d1dc479aaea755140a6fbc57ab0bed20f1cc566c1c2710f4",
  "building_workshop.glb":
    "35daa0aca5608e259dc4dfa018170dccde7fe8665b18ad7d7429dfd7a13dea2e",
  "enemy_brute.glb":
    "09be79c4b9a8b0035a0d5283101aafe385603481326e73a71d091af825c2a97b",
  "enemy_elite.glb":
    "78ddcfe722c0fef31c8a1094d983ccbf39f0ec55e8e78a6717beda66c93b27f1",
  "enemy_ember_wyrm.glb":
    "56df986fd7b71511110ba1de3491073a39746ca53c99205da61e77c6718d29e1",
  "enemy_scout.glb":
    "33b8b7af138b02f47254691b7008f90b2690daa85956fcd57cca97c1e7bfcd2f",
  "enemy_spitter.glb":
    "50268aeea44047860b59e385be836b2b56bf569e7ef570d595c91cefe9da7d50",
  "player_archer.glb":
    "fde9473119b2982d9e52126062aa49984f8dd15189ed68a64233c36e8d2e943f",
  "player_knight.glb":
    "f21ff9433ae2cba4013ae2c886206fd61c1bc1d819561f5b199c26c683e4f5ba",
  "player_wizard.glb":
    "0cc054031a1394c43c5130ea0b624c5afc030a2fbe60063fa7f241104406eb0a",
  "projectile_archer_arrow.glb":
    "c033a9800b3fccdfc659ba1ec27456f238c8b205146fabdb496028bcf511bf75",
  "projectile_knight_blade_arc.glb":
    "725b2aec2a628c1b1b97821842bb1e2eda19c50395d9ec217d4a0c3cffe78112",
  "projectile_wizard_flame_orb.glb":
    "08acc3c3a2bce861321a5cc514b12dc96b26006329c79784c79b4a8b1d7a4ccd",
};

describe("visual upgrade asset packs", () => {
  it("preserves all original GLB bytes", () => {
    expect(
      Object.fromEntries(
        Object.keys(originalHashes).map((file) => [
          file,
          sha256(join(models, file)),
        ]),
      ),
    ).toEqual(originalHashes);
  });

  it("keeps versioned GLBs structurally valid with manifest hashes", () => {
    for (const directory of [
      "expansion-v1",
      "winding-fixed-v1",
      "actor-geometry-v2",
    ]) {
      const root = join(models, directory);
      const manifest = JSON.parse(
        readFileSync(join(root, "manifest.json"), "utf8"),
      ) as { assets: readonly { file: string; sha256: string }[] };
      expect(glbs(root)).toHaveLength(
        directory === "expansion-v1"
          ? 25
          : directory === "winding-fixed-v1"
            ? 16
            : 3,
      );
      for (const asset of manifest.assets) {
        const bytes = readFileSync(join(root, asset.file));
        expect(bytes.subarray(0, 4).toString("ascii")).toBe("glTF");
        expect(bytes.readUInt32LE(4)).toBe(2);
        expect(bytes.readUInt32LE(8)).toBe(bytes.length);
        expect(sha256(join(root, asset.file))).toBe(asset.sha256);
        const jsonLength = bytes.readUInt32LE(12);
        const gltf = JSON.parse(
          bytes.subarray(20, 20 + jsonLength).toString("utf8"),
        ) as {
          meshes: readonly {
            primitives: readonly {
              attributes: Readonly<Record<string, number>>;
            }[];
          }[];
        };
        expect(
          gltf.meshes.every((mesh) =>
            mesh.primitives.every(
              (primitive) => primitive.attributes.NORMAL !== undefined,
            ),
          ),
        ).toBe(true);
      }
    }
  });

  it("records explicit actor grips and the local negative-Z forward axis", () => {
    const manifest = JSON.parse(
      readFileSync(join(models, "actor-geometry-v2/manifest.json"), "utf8"),
    ) as {
      forward: readonly number[];
      grips: Readonly<Record<string, readonly number[]>>;
    };
    expect(manifest.forward).toEqual([0, 0, -1]);
    expect(Object.keys(manifest.grips).sort()).toEqual([
      "enemy_brute",
      "enemy_scout",
      "player_archer",
    ]);
    expect(
      Object.values(manifest.grips).every(
        (grip) => grip.length === 3 && grip.every(Number.isFinite),
      ),
    ).toBe(true);
  });

  it("has outward non-zero actor surfaces with normals matching their actual GLB triangles", () => {
    for (const file of glbs(join(models, "actor-geometry-v2"))) {
      const parts = actorParts(join(models, "actor-geometry-v2", file));
      for (const [name, part] of Object.entries(parts)) {
        const centre = [0, 1, 2].map((axis) => {
          const values = part.positions.map((point) => point[axis]);
          return (Math.min(...values) + Math.max(...values)) / 2;
        });
        for (let index = 0; index < part.indices.length; index += 3) {
          const triangle = part.indices
            .slice(index, index + 3)
            .map((vertex) => part.positions[vertex]);
          const ab = triangle[1].map(
            (value, axis) => value - triangle[0][axis],
          );
          const ac = triangle[2].map(
            (value, axis) => value - triangle[0][axis],
          );
          const cross: Vec3 = [
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
          ];
          const area = Math.hypot(...cross);
          const centroid = [0, 1, 2].map(
            (axis) =>
              (triangle[0][axis] + triangle[1][axis] + triangle[2][axis]) / 3,
          );
          expect(area).toBeGreaterThan(0.000001);
          expect(
            cross.reduce(
              (sum, value, axis) =>
                sum + value * (centroid[axis] - centre[axis]),
              0,
            ),
            `${file}:${name}`,
          ).toBeGreaterThan(0);
          for (const vertex of part.indices.slice(index, index + 3))
            expect(
              cross.reduce(
                (sum, value, axis) => sum + value * part.normals[vertex][axis],
                0,
              ) / area,
            ).toBeGreaterThan(0.999);
        }
      }
    }
  });

  it("joins the scout weapon toward local -Z and connects bow limbs and string endpoints", () => {
    const scout = actorParts(join(models, "actor-geometry-v2/enemy_scout.glb"));
    const spear = bounds(scout.spear),
      tip = bounds(scout.spear_tip);
    expect(tip[2][1]).toBeLessThan(0);
    expect(
      spear.every(
        (range, axis) => range[0] <= tip[axis][1] && tip[axis][0] <= range[1],
      ),
    ).toBe(true);
    const archer = actorParts(
      join(models, "actor-geometry-v2/player_archer.glb"),
    );
    for (const name of [
      "bow_upper_inner",
      "bow_upper_outer",
      "bow_lower_inner",
      "bow_lower_outer",
      "bow_string_upper",
      "bow_string_lower",
    ])
      expect(archer[name]).toBeDefined();
    const stringBounds = bounds(archer.bow_string_upper);
    expect(stringBounds[0][0]).toBeLessThanOrEqual(bounds(archer.bow)[0][1]);
    expect(stringBounds[0][1]).toBeGreaterThanOrEqual(
      bounds(archer.bow_upper_outer)[0][0],
    );
  });
});
