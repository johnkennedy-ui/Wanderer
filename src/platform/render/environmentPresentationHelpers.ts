import * as THREE from "three";
import type { GameRendererSnapshot } from "../../domain/notices";
import type { ChunkObstacle, ChunkRecipe, Vector2 } from "../../domain/types";

/** Keys are deliberately separate from the actor cache union; the root wires both to one cache. */
export type EnvironmentAssetKey =
  | "environment-rock-granite-a"
  | "environment-rock-granite-b"
  | "environment-rock-granite-c"
  | "environment-rock-moss-a"
  | "environment-rock-ore-bronze"
  | "environment-tree-pine-a"
  | "environment-tree-pine-b"
  | "environment-tree-broadleaf-a"
  | "environment-tree-broadleaf-b"
  | "environment-tree-dead-a"
  | "environment-water-pond-small"
  | "environment-bush-a"
  | "environment-reeds-a"
  | "environment-fallen-log-a";

export const environmentFilenames: Readonly<Record<EnvironmentAssetKey, string>> =
  Object.freeze({
    "environment-rock-granite-a": "expansion-v1/rock_granite_a.glb",
    "environment-rock-granite-b": "expansion-v1/rock_granite_b.glb",
    "environment-rock-granite-c": "expansion-v1/rock_granite_c.glb",
    "environment-rock-moss-a": "expansion-v1/rock_moss_a.glb",
    "environment-rock-ore-bronze": "expansion-v1/rock_ore_bronze.glb",
    "environment-tree-pine-a": "expansion-v1/tree_pine_a.glb",
    "environment-tree-pine-b": "expansion-v1/tree_pine_b.glb",
    "environment-tree-broadleaf-a": "expansion-v1/tree_broadleaf_a.glb",
    "environment-tree-broadleaf-b": "expansion-v1/tree_broadleaf_b.glb",
    "environment-tree-dead-a": "expansion-v1/tree_dead_a.glb",
    "environment-water-pond-small": "expansion-v1/water_pond_small.glb",
    "environment-bush-a": "expansion-v1/bush_a.glb",
    "environment-reeds-a": "expansion-v1/reeds_a.glb",
    "environment-fallen-log-a": "expansion-v1/fallen_log_a.glb",
  });

export const environmentFilenameFor = (key: EnvironmentAssetKey): string =>
  environmentFilenames[key];

export interface EnvironmentAssetCache {
  acquire(key: EnvironmentAssetKey): Promise<THREE.Group | undefined>;
}

export interface EnvironmentProjectionDiagnostics {
  readonly instances: number;
  readonly loadedInstances: number;
  readonly pendingInstances: number;
  readonly fallbackInstances: number;
  readonly assetKeys: readonly EnvironmentAssetKey[];
  readonly disposed: boolean;
}

type Descriptor = Readonly<{
  id: string;
  asset: EnvironmentAssetKey;
  position: Vector2;
  footprint: number;
  yaw: number;
  scale: number;
  fallback: boolean;
}>;

interface Instance {
  readonly root: THREE.Group;
  readonly descriptor: Descriptor;
  model: THREE.Group | undefined;
}

const rocks = [
  "environment-rock-granite-a",
  "environment-rock-granite-b",
  "environment-rock-granite-c",
  "environment-rock-moss-a",
  "environment-rock-ore-bronze",
] as const satisfies readonly EnvironmentAssetKey[];
const trees = [
  "environment-tree-pine-a",
  "environment-tree-pine-b",
  "environment-tree-broadleaf-a",
  "environment-tree-broadleaf-b",
  "environment-tree-dead-a",
] as const satisfies readonly EnvironmentAssetKey[];
const props = [
  "environment-water-pond-small",
  "environment-bush-a",
  "environment-reeds-a",
  "environment-fallen-log-a",
] as const satisfies readonly EnvironmentAssetKey[];

const hash = (text: string): number => {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
};
const variant = <T>(seed: string, choices: readonly T[]): T =>
  choices[hash(seed) % choices.length]!;
const unit = (seed: string): number => hash(seed) / 0xffffffff;
const distanceSquared = (one: Vector2, two: Vector2): number =>
  (one.x - two.x) ** 2 + (one.y - two.y) ** 2;
const disposeClone = (root: THREE.Object3D): void => {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    materials.forEach((material) => material.dispose());
  });
};

const obstacleDescriptor = (chunk: ChunkRecipe, obstacle: ChunkObstacle): Descriptor | undefined => {
  // Only the existing markers are replaced. Water and mountains keep their V3 primitives.
  if (obstacle.kind === "water" || obstacle.kind === "mountain") return undefined;
  const kind = obstacle.kind === "tree" ? "tree" : "rock";
  const seed = `visual-v1|${chunk.domainSeeds.cosmetic ?? 0}|${obstacle.id}`;
  const footprint = obstacle.radius ?? 0.9; // Legacy obstacle collision is 0.9, never its 0.38 marker.
  return {
    id: obstacle.id,
    asset: variant(`${seed}|variant`, kind === "tree" ? trees : rocks),
    position: obstacle.position,
    footprint,
    yaw: unit(`${seed}|yaw`) * Math.PI * 2,
    // Calibration uses manifest base/trunk bounds (not canopy bounds); cap scale for readability.
    scale: Math.min(1.35, Math.max(0.55, footprint / (kind === "tree" ? 0.42 : 0.45))),
    fallback: true,
  };
};

const clearForDecoration = (position: Vector2, chunk: ChunkRecipe, snapshot: GameRendererSnapshot): boolean => {
  const clearance = 2.1;
  if (distanceSquared(position, snapshot.player.position) < clearance ** 2) return false;
  const blocked = [
    ...chunk.obstacles,
    ...chunk.campfires,
    ...snapshot.visibleBuildings,
    ...chunk.spawns,
  ];
  return blocked.every((item) => distanceSquared(position, item.position) >= clearance ** 2);
};

/** Pure, bounded descriptors make visitation order irrelevant and keep decoration non-authoritative. */
export const environmentDescriptorsFor = (
  snapshot: GameRendererSnapshot,
): readonly Descriptor[] => {
  const descriptors: Descriptor[] = [];
  for (const chunk of snapshot.visibleChunks) {
    for (const obstacle of chunk.obstacles) {
      const descriptor = obstacleDescriptor(chunk, obstacle);
      if (descriptor !== undefined) descriptors.push(descriptor);
    }
    // At most one opaque puddle and one foliage/log item per visible chunk.
    const cosmetic = chunk.domainSeeds.cosmetic ?? 0;
    for (const slot of [0, 1] as const) {
      const seed = `visual-v1|${cosmetic}|${chunk.key}|decoration|${slot}`;
      const position = {
        x: chunk.coordinate.x * 16 + 3 + unit(`${seed}|x`) * 10,
        y: chunk.coordinate.y * 16 + 3 + unit(`${seed}|y`) * 10,
      };
      if (!clearForDecoration(position, chunk, snapshot)) continue;
      const asset = slot === 0 ? "environment-water-pond-small" : variant(`${seed}|variant`, props.slice(1));
      descriptors.push({
        id: `environment:${chunk.key}:${slot}`,
        asset,
        position,
        footprint: 0,
        yaw: unit(`${seed}|yaw`) * Math.PI * 2,
        scale: 0.55 + unit(`${seed}|scale`) * 0.25,
        fallback: false,
      });
    }
  }
  return descriptors;
};

/** Disposable environment layer; cache owns templates, this owner only disposes acquired clones. */
export class EnvironmentProjection {
  readonly group = new THREE.Group();
  private readonly instances = new Map<string, Instance>();
  private disposed = false;

  constructor(
    private readonly cache: EnvironmentAssetCache,
    private readonly onStateChange: () => void = () => {},
  ) {}

  render(snapshot: GameRendererSnapshot, setFallbackModelVisible: (id: string, visible: boolean) => void): void {
    if (this.disposed) return;
    const descriptors = environmentDescriptorsFor(snapshot);
    const visible = new Set(descriptors.map((descriptor) => descriptor.id));
    descriptors.forEach((descriptor) => this.present(descriptor, setFallbackModelVisible));
    for (const [id, instance] of this.instances)
      if (!visible.has(id)) this.remove(id, instance, setFallbackModelVisible);
  }

  diagnostics(): EnvironmentProjectionDiagnostics {
    const values = [...this.instances.values()];
    return Object.freeze({
      instances: values.length,
      loadedInstances: values.filter((instance) => instance.model !== undefined).length,
      pendingInstances: values.filter((instance) => instance.model === undefined).length,
      fallbackInstances: values.filter((instance) => instance.descriptor.fallback && instance.model === undefined).length,
      assetKeys: [...new Set(values.map((instance) => instance.descriptor.asset))].sort(),
      disposed: this.disposed,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [id, instance] of this.instances) this.remove(id, instance, () => {});
    this.group.clear();
    this.group.removeFromParent();
  }

  private present(descriptor: Descriptor, setFallbackModelVisible: (id: string, visible: boolean) => void): void {
    let instance = this.instances.get(descriptor.id);
    if (instance === undefined) {
      const root = new THREE.Group();
      root.name = `environment:${descriptor.id}`;
      instance = { root, descriptor, model: undefined };
      this.instances.set(descriptor.id, instance);
      this.group.add(root);
      const expected = instance;
      void this.cache.acquire(descriptor.asset).then((model) => {
        if (model === undefined) return;
        if (this.disposed || this.instances.get(descriptor.id) !== expected) {
          disposeClone(model);
          return;
        }
        expected.model = model;
        expected.root.add(model);
        if (expected.descriptor.fallback) setFallbackModelVisible(descriptor.id, true);
        this.onStateChange();
      });
    }
    instance.root.position.set(descriptor.position.x, 0.014, -descriptor.position.y);
    instance.root.rotation.set(0, descriptor.yaw, 0);
    instance.root.scale.setScalar(descriptor.scale);
  }

  private remove(id: string, instance: Instance, setFallbackModelVisible: (id: string, visible: boolean) => void): void {
    this.instances.delete(id);
    instance.root.removeFromParent();
    if (instance.model !== undefined) disposeClone(instance.model);
    instance.root.clear();
    if (instance.descriptor.fallback) setFallbackModelVisible(id, false);
  }
}
