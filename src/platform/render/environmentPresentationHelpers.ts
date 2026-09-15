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

export const environmentFilenames: Readonly<
  Record<EnvironmentAssetKey, string>
> = Object.freeze({
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
  descriptor: Descriptor;
  model: THREE.Group | undefined;
  state: "pending" | "attached" | "failed";
}

const rocks = Object.freeze([
  "environment-rock-granite-a",
  "environment-rock-granite-b",
  "environment-rock-granite-c",
  "environment-rock-moss-a",
  "environment-rock-ore-bronze",
] as const satisfies readonly EnvironmentAssetKey[]);
const trees = Object.freeze([
  "environment-tree-pine-a",
  "environment-tree-pine-b",
  "environment-tree-broadleaf-a",
  "environment-tree-broadleaf-b",
  "environment-tree-dead-a",
] as const satisfies readonly EnvironmentAssetKey[]);
const foliage = Object.freeze([
  "environment-bush-a",
  "environment-reeds-a",
  "environment-fallen-log-a",
] as const satisfies readonly EnvironmentAssetKey[]);

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

const hasMesh = (root: THREE.Object3D): boolean =>
  root.getObjectByProperty("isMesh", true) !== undefined;

/** Binding-only measurement in model space, independent of the parent world transform. */
const visitModelVertices = (
  model: THREE.Group,
  accept: (mesh: THREE.Mesh) => boolean,
  visit: (point: THREE.Vector3) => void,
): void => {
  model.updateWorldMatrix(true, true);
  const inverse = model.matrixWorld.clone().invert();
  const point = new THREE.Vector3();
  const local = new THREE.Matrix4();
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !accept(object)) return;
    const attribute = object.geometry.getAttribute("position");
    if (attribute === undefined) return;
    local.multiplyMatrices(inverse, object.matrixWorld);
    for (let index = 0; index < attribute.count; index += 1) {
      point.fromBufferAttribute(attribute, index).applyMatrix4(local);
      visit(point);
    }
  });
};

/** The supplied trees name their collision-bearing part trunk; rocks name it rock. */
export const environmentBaseRadiusFor = (model: THREE.Group): number => {
  const part = model.getObjectByName("trunk") ?? model.getObjectByName("rock");
  let radius = 0;
  visitModelVertices(
    model,
    (mesh) => part === undefined || mesh === part,
    (point) => {
      radius = Math.max(radius, Math.hypot(point.x, point.z));
    },
  );
  return radius;
};

/** Calibrate acquired clones once. Actor pivots and cached templates are never touched. */
export const fitEnvironmentModel = (
  model: THREE.Group,
  footprint: number,
): THREE.Vector3 => {
  const radius = environmentBaseRadiusFor(model);
  if (radius <= 0 || footprint <= 0) return new THREE.Vector3(1, 1, 1);
  const scale = footprint / radius;
  const trunk = model.getObjectByName("trunk");
  if (trunk !== undefined) {
    let canopyRadius = 0;
    visitModelVertices(
      model,
      (mesh) => mesh !== trunk,
      (point) => {
        canopyRadius = Math.max(canopyRadius, Math.hypot(point.x, point.z));
      },
    );
    const compression =
      canopyRadius === 0 ? 1 : Math.min(1, (radius * 1.8) / canopyRadius);
    // These versioned GLBs have flat, untransformed mesh nodes. Compress all
    // branches/canopies together so their joints retain the same local space.
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object === trunk) return;
      object.scale.x *= compression;
      object.scale.z *= compression;
      object.position.x *= compression;
      object.position.z *= compression;
    });
  }
  let minimumY = Infinity;
  let maximumY = -Infinity;
  visitModelVertices(
    model,
    () => true,
    (point) => {
      minimumY = Math.min(minimumY, point.y);
      maximumY = Math.max(maximumY, point.y);
    },
  );
  model.position.y -= minimumY;
  const verticalScale =
    trunk === undefined ? scale : Math.min(scale, 3.4 / (maximumY - minimumY));
  return new THREE.Vector3(scale, verticalScale, scale);
};

const obstacleDescriptor = (
  chunk: ChunkRecipe,
  obstacle: ChunkObstacle,
): Descriptor | undefined => {
  // Only the existing markers are replaced. Water and mountains keep their V3 primitives.
  if (obstacle.kind === "water" || obstacle.kind === "mountain")
    return undefined;
  const kind = obstacle.kind === "tree" ? "tree" : "rock";
  const seed = `visual-v1|${chunk.domainSeeds.cosmetic ?? 0}|${obstacle.id}`;
  const footprint = obstacle.radius ?? 0.9; // Legacy obstacle collision is 0.9, never its 0.38 marker.
  return {
    id: obstacle.id,
    asset: variant(`${seed}|variant`, kind === "tree" ? trees : rocks),
    position: obstacle.position,
    footprint,
    yaw: unit(`${seed}|yaw`) * Math.PI * 2,
    scale: 1,
    fallback: true,
  };
};

const clearForDecoration = (
  position: Vector2,
  snapshot: GameRendererSnapshot,
): boolean => {
  // Two metres conservatively covers every selected decoration's scaled bounds.
  const clearance = 2;
  const blocked = [
    ...snapshot.visibleChunks.flatMap((chunk) => [
      ...chunk.obstacles,
      ...chunk.campfires,
      ...chunk.spawns,
    ]),
    ...snapshot.visibleBuildings,
  ];
  return blocked.every((item) => {
    const radius =
      "radius" in item && item.radius !== undefined ? item.radius : 2;
    return (
      distanceSquared(position, item.position) >= (radius + clearance) ** 2
    );
  });
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
    if (chunk.coordinate.x === 0 && chunk.coordinate.y === 0) continue;
    // At most one sparse opaque puddle and one sparse foliage/log item per visible chunk.
    const cosmetic = chunk.domainSeeds.cosmetic ?? 0;
    for (const slot of [0, 1] as const) {
      const seed = `visual-v1|${cosmetic}|${chunk.key}|decoration|${slot}`;
      if (
        (slot === 0 && hash(`${seed}|eligible`) % 5 !== 0) ||
        (slot === 1 && hash(`${seed}|eligible`) % 3 !== 0)
      )
        continue;
      const position = {
        x: chunk.coordinate.x * 16 + 5 + unit(`${seed}|x`) * 6,
        y: chunk.coordinate.y * 16 + 5 + unit(`${seed}|y`) * 6,
      };
      if (!clearForDecoration(position, snapshot)) continue;
      const asset =
        slot === 0
          ? "environment-water-pond-small"
          : variant(`${seed}|variant`, foliage);
      descriptors.push({
        id: `environment:${chunk.key}:${cosmetic}:${slot}`,
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

  render(
    snapshot: GameRendererSnapshot,
    setFallbackModelVisible: (id: string, visible: boolean) => void,
  ): void {
    if (this.disposed) return;
    const descriptors = environmentDescriptorsFor(snapshot);
    const visible = new Set(descriptors.map((descriptor) => descriptor.id));
    descriptors.forEach((descriptor) =>
      this.present(descriptor, setFallbackModelVisible),
    );
    for (const [id, instance] of this.instances)
      if (!visible.has(id)) this.remove(id, instance, setFallbackModelVisible);
  }

  diagnostics(): EnvironmentProjectionDiagnostics {
    const values = [...this.instances.values()];
    return Object.freeze({
      instances: values.length,
      loadedInstances: values.filter(
        (instance) => instance.state === "attached",
      ).length,
      pendingInstances: values.filter(
        (instance) => instance.state === "pending",
      ).length,
      fallbackInstances: values.filter(
        (instance) =>
          instance.descriptor.fallback && instance.state !== "attached",
      ).length,
      assetKeys: [
        ...new Set(values.map((instance) => instance.descriptor.asset)),
      ].sort(),
      disposed: this.disposed,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [id, instance] of this.instances)
      this.remove(id, instance, () => {});
    this.group.clear();
    this.group.removeFromParent();
  }

  private present(
    descriptor: Descriptor,
    setFallbackModelVisible: (id: string, visible: boolean) => void,
  ): void {
    let instance = this.instances.get(descriptor.id);
    if (
      instance !== undefined &&
      instance.descriptor.asset !== descriptor.asset
    ) {
      this.remove(descriptor.id, instance, setFallbackModelVisible);
      instance = undefined;
    }
    if (instance === undefined) {
      const root = new THREE.Group();
      root.name = `environment:${descriptor.id}`;
      instance = { root, descriptor, model: undefined, state: "pending" };
      this.instances.set(descriptor.id, instance);
      this.group.add(root);
      const expected = instance;
      void this.cache.acquire(descriptor.asset).then((model) => {
        if (model === undefined) {
          if (
            !this.disposed &&
            this.instances.get(descriptor.id) === expected
          ) {
            expected.state = "failed";
            this.onStateChange();
          }
          return;
        }
        if (this.disposed || this.instances.get(descriptor.id) !== expected) {
          disposeClone(model);
          return;
        }
        if (!hasMesh(model)) {
          disposeClone(model);
          expected.state = "failed";
          this.onStateChange();
          return;
        }
        expected.model = model;
        expected.root.add(model);
        if (expected.descriptor.footprint > 0)
          expected.root.scale.copy(
            fitEnvironmentModel(model, expected.descriptor.footprint),
          );
        expected.state = "attached";
        if (expected.descriptor.fallback)
          setFallbackModelVisible(descriptor.id, true);
        this.onStateChange();
      });
    }
    instance.descriptor = descriptor;
    instance.root.position.set(
      descriptor.position.x,
      0.014,
      -descriptor.position.y,
    );
    instance.root.rotation.set(0, descriptor.yaw, 0);
    if (instance.state !== "attached")
      instance.root.scale.setScalar(descriptor.scale);
  }

  private remove(
    id: string,
    instance: Instance,
    setFallbackModelVisible: (id: string, visible: boolean) => void,
  ): void {
    this.instances.delete(id);
    instance.root.removeFromParent();
    if (instance.model !== undefined) disposeClone(instance.model);
    instance.root.clear();
    if (instance.descriptor.fallback) setFallbackModelVisible(id, false);
  }
}
