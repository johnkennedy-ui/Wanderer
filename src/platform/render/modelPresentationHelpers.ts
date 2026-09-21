import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { GameRendererSnapshot } from "../../domain/notices";
import {
  knightSlashAnimationFor,
  mageFireballAnimationFor,
} from "./combatAnimationHelpers";
import { calibratedYawFor, shortestYawTowards } from "./modelFacingHelpers";
import {
  environmentFilenameFor,
  type EnvironmentAssetKey,
} from "./environmentPresentationHelpers";
import {
  applyModelPose,
  bindModelPose,
  type BoundModelPose,
} from "./modelPoseHelpers";
import type {
  AttackStyle,
  BuildingKind,
  EnemyKind,
  Vector2,
} from "../../domain/types";

type ModelBackedBuildingKind = Exclude<BuildingKind, "WoodWall" | "StoneWall">;
const isModelBackedBuildingKind = (
  kind: BuildingKind,
): kind is ModelBackedBuildingKind =>
  kind !== "WoodWall" && kind !== "StoneWall";

export const modelAssets = Object.freeze({
  players: Object.freeze({
    knight: "winding-fixed-v1/player_knight.glb",
    wizard: "winding-fixed-v1/player_wizard.glb",
    archer: "actor-geometry-v2/player_archer.glb",
  }),
  enemies: Object.freeze({
    scout: "actor-geometry-v2/enemy_scout.glb",
    brute: "actor-geometry-v2/enemy_brute.glb",
    spitter: "winding-fixed-v1/enemy_spitter.glb",
    elite: "winding-fixed-v1/enemy_elite.glb",
    boss: "winding-fixed-v1/enemy_ember_wyrm.glb",
  } satisfies Record<EnemyKind, string>),
  projectiles: Object.freeze({
    knight: "expansion-v1/fx_blade_arc_v2.glb",
    wizard: "expansion-v1/projectile_flame_orb_v2.glb",
    archer: "expansion-v1/projectile_arrow_v2.glb",
  }),
  buildings: Object.freeze({
    Campfire: "winding-fixed-v1/building_campfire.glb",
    Workshop: "winding-fixed-v1/building_workshop.glb",
    Farm: "winding-fixed-v1/building_farm.glb",
    Storage: "winding-fixed-v1/building_storage.glb",
    Healer: "winding-fixed-v1/building_healing_hut.glb",
  } satisfies Record<ModelBackedBuildingKind, string>),
});

export type ModelAssetKey =
  | EnvironmentAssetKey
  | "player-knight"
  | "player-wizard"
  | "player-archer"
  | "enemy-scout"
  | "enemy-brute"
  | "enemy-spitter"
  | "enemy-elite"
  | "enemy-boss"
  | "projectile-knight"
  | "projectile-wizard"
  | "projectile-archer"
  | "building-Campfire"
  | "building-Workshop"
  | "building-Farm"
  | "building-Storage"
  | "building-Healer";

export const modelFilenameFor = (key: ModelAssetKey): string => {
  if (key.startsWith("environment-"))
    return environmentFilenameFor(key as EnvironmentAssetKey);
  const [category, kind] = key.split("-") as [string, string];
  if (category === "player")
    return modelAssets.players[kind as keyof typeof modelAssets.players];
  if (category === "enemy") return modelAssets.enemies[kind as EnemyKind];
  if (category === "projectile")
    return modelAssets.projectiles[
      kind as keyof typeof modelAssets.projectiles
    ];
  return modelAssets.buildings[kind as ModelBackedBuildingKind];
};

/** Vite's base path is part of the public asset contract. */
const browserBasePath = (): string =>
  typeof document === "undefined" ? "/" : document.baseURI;

export const modelAssetUrlFor = (
  key: ModelAssetKey,
  basePath: string = browserBasePath(),
): string => {
  const filename = `assets/models/${modelFilenameFor(key)}`;
  if (/^[a-z][a-z\d+.-]*:/i.test(basePath))
    return new URL(filename, basePath).toString();
  return `${basePath.endsWith("/") ? basePath : `${basePath}/`}${filename}`;
};

export const projectileModelFor = (style: AttackStyle): ModelAssetKey =>
  style === "magic"
    ? "projectile-wizard"
    : style === "arrow"
      ? "projectile-archer"
      : "projectile-knight";

type LoadedScene = { readonly scene: THREE.Group };
export interface ModelLoader {
  load(
    url: string,
    onLoad: (loaded: LoadedScene) => void,
    onProgress?: ((event: ProgressEvent<EventTarget>) => void) | undefined,
    onError?: ((error: unknown) => void) | undefined,
  ): void;
}

const disposeObject = (root: THREE.Object3D, disposeTextures = false): void => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material])
      materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => {
    if (disposeTextures)
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) textures.add(value);
      });
    material.dispose();
  });
  if (disposeTextures) textures.forEach((texture) => texture.dispose());
};

const cloneTemplate = (template: THREE.Group): THREE.Group => {
  const clone = template.clone(true);
  clone.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry = object.geometry.clone();
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => material.clone())
      : object.material.clone();
  });
  return clone;
};

interface PendingLoad {
  readonly promise: Promise<THREE.Group | undefined>;
  readonly resolve: (template: THREE.Group | undefined) => void;
}

/** Renderer-owned GLB template cache. Every visible object owns cloned resources. */
export class ModelTemplateCache {
  private readonly templates = new Map<ModelAssetKey, THREE.Group>();
  private readonly pending = new Map<ModelAssetKey, PendingLoad>();
  private readonly failed = new Set<ModelAssetKey>();
  private disposed = false;

  constructor(
    private readonly loader: ModelLoader = new GLTFLoader(),
    private readonly basePath: string = browserBasePath(),
  ) {}

  acquire(key: ModelAssetKey): Promise<THREE.Group | undefined> {
    if (this.disposed || this.failed.has(key))
      return Promise.resolve(undefined);
    const template = this.templates.get(key);
    if (template !== undefined) return Promise.resolve(cloneTemplate(template));
    let pending = this.pending.get(key);
    if (pending === undefined) {
      let resolvePending!: (template: THREE.Group | undefined) => void;
      const promise = new Promise<THREE.Group | undefined>((resolve) => {
        resolvePending = resolve;
      });
      pending = { promise, resolve: resolvePending };
      this.pending.set(key, pending);
      try {
        this.loader.load(
          modelAssetUrlFor(key, this.basePath),
          (loaded) => {
            this.pending.delete(key);
            if (this.disposed) {
              disposeObject(loaded.scene, true);
              pending?.resolve(undefined);
              return;
            }
            this.templates.set(key, loaded.scene);
            pending?.resolve(loaded.scene);
          },
          undefined,
          () => {
            this.pending.delete(key);
            this.failed.add(key);
            pending?.resolve(undefined);
          },
        );
      } catch {
        this.pending.delete(key);
        this.failed.add(key);
        pending.resolve(undefined);
      }
    }
    return pending.promise.then((loaded) =>
      this.disposed || loaded === undefined ? undefined : cloneTemplate(loaded),
    );
  }

  diagnostics() {
    return Object.freeze({
      templates: this.templates.size,
      pending: this.pending.size,
      failures: this.failed.size,
      disposed: this.disposed,
    });
  }

  isPending(key: ModelAssetKey): boolean {
    return this.pending.has(key);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending.forEach((pending) => pending.resolve(undefined));
    this.pending.clear();
    this.templates.forEach((template) => disposeObject(template, true));
    this.templates.clear();
    this.failed.clear();
  }
}

interface ModelDescriptor {
  readonly id: string;
  readonly asset: ModelAssetKey;
  readonly position: Vector2;
  readonly height: number;
  readonly scale: number;
  readonly rotation: number;
  readonly facing?: boolean;
  readonly tangent?: boolean;
  readonly playerHitRecovery?: boolean;
  readonly attackCue?: GameRendererSnapshot["attackCues"][number];
}

interface ModelInstance {
  readonly root: THREE.Group;
  readonly poseRoot: THREE.Group;
  asset: ModelAssetKey;
  model: THREE.Group | undefined;
  playerHitRecovery: boolean;
  fallbackVisible: boolean;
  yaw: number;
  targetYaw: number;
  lastPosition: Vector2;
  lastElapsed: number;
  resetId: number;
  pose: BoundModelPose | undefined;
  hasMeshes: boolean;
  locomotionDistance: number;
  moving: boolean;
  suppressedCueSequence: number | undefined;
}

const playerModelFor = (
  playerClass: GameRendererSnapshot["playerClass"],
): ModelAssetKey => `player-${playerClass ?? "knight"}`;

/** Async model layer over the retained geometry fallback projection. */
export class ModelProjection {
  readonly group = new THREE.Group();
  private readonly instances = new Map<string, ModelInstance>();
  private disposed = false;

  constructor(
    private readonly templates = new ModelTemplateCache(),
    private readonly onStateChange: () => void = () => {},
    private readonly ownsTemplates = true,
  ) {}

  render(
    snapshot: GameRendererSnapshot,
    setFallbackModelVisible: (id: string, visible: boolean) => void,
  ): void {
    if (this.disposed) return;
    const attackCueByActor = new Map<
      string,
      GameRendererSnapshot["attackCues"][number]
    >();
    for (const cue of snapshot.attackCues)
      attackCueByActor.set(cue.actorId, cue);
    const descriptors: ModelDescriptor[] = [
      {
        id: "player",
        asset: playerModelFor(snapshot.playerClass),
        position: snapshot.player.position,
        height: 0,
        scale: 0.78,
        rotation: 0,
        facing: true,
        attackCue: attackCueByActor.get("player"),
        playerHitRecovery: snapshot.playerHitRecovery.active,
      },
      ...snapshot.visibleChunks.flatMap((chunk) =>
        chunk.campfires.map((campfire) => ({
          id: campfire.id,
          asset: "building-Campfire" as const,
          position: campfire.position,
          height: 0,
          scale: 0.85,
          rotation: 0,
        })),
      ),
      ...snapshot.visibleBuildings
        .filter((building) => isModelBackedBuildingKind(building.kind))
        .map((building) => ({
          id: building.id,
          asset: `building-${building.kind}` as ModelAssetKey,
          position: building.position,
          height: 0,
          scale: 0.76 + building.level * 0.06,
          rotation: 0,
        })),
      ...snapshot.enemies.map((enemy) => ({
        id: enemy.id,
        asset:
          `enemy-${enemy.isWaveBoss ? "boss" : enemy.kind}` as ModelAssetKey,
        position: enemy.position,
        height: 0,
        scale: enemy.isWaveBoss ? 0.9 : 0.72,
        rotation: 0,
        facing: true,
        attackCue: attackCueByActor.get(enemy.id),
      })),
      ...snapshot.projectiles.map((projectile) => {
        const position = {
          x:
            projectile.origin.x +
            (projectile.targetPosition.x - projectile.origin.x) *
              projectile.progress,
          y:
            projectile.origin.y +
            (projectile.targetPosition.y - projectile.origin.y) *
            projectile.progress,
        };
        const direction = {
          x: projectile.targetPosition.x - projectile.origin.x,
          y: projectile.targetPosition.y - projectile.origin.y,
        };
        if (projectile.style !== "magic")
          return {
            id: projectile.id,
            asset: projectileModelFor(projectile.style),
            position,
            height: 0.72,
            scale: projectile.style === "arrow" ? 0.55 : 0.5,
            rotation: calibratedYawFor(direction),
            tangent: true,
          };
        const fireball = mageFireballAnimationFor(
          projectile.progress,
          snapshot.presentationElapsed,
        );
        return {
          id: projectile.id,
          asset: projectileModelFor(projectile.style),
          position,
          height: fireball?.height ?? 0.72,
          scale: 0.5 * fireball.scale,
          rotation: calibratedYawFor(direction) + fireball.spin,
        };
      }),
      ...snapshot.crescentAttacks.map((attack) => {
        const length = Math.hypot(attack.direction.x, attack.direction.y);
        const direction =
          length > 0.0001
            ? { x: attack.direction.x / length, y: attack.direction.y / length }
            : { x: 0, y: 1 };
        const slash = knightSlashAnimationFor(attack.progress);
        return {
          id: attack.id,
          asset: "projectile-knight" as const,
          position: {
            x: attack.origin.x + direction.x * attack.radius * slash.forward,
            y: attack.origin.y + direction.y * attack.radius * slash.forward,
          },
          height: slash.height,
          scale: Math.max(0.45, attack.radius * 0.28) * slash.scale,
          rotation: calibratedYawFor(direction, { x: 0, y: 1 }) + slash.turn,
        };
      }),
    ];
    const visible = new Set(descriptors.map((descriptor) => descriptor.id));
    for (const descriptor of descriptors)
      this.present(descriptor, snapshot, setFallbackModelVisible);
    for (const [id, instance] of this.instances)
      if (!visible.has(id)) this.remove(id, instance, setFallbackModelVisible);
  }

  diagnostics() {
    const attached = [...this.instances.values()].filter((instance) =>
      this.hasAttachedMesh(instance),
    );
    const pending = [...this.instances.values()].filter(
      (instance) =>
        !this.hasAttachedMesh(instance) &&
        this.templates.isPending(instance.asset),
    );
    const active = attached.filter((instance) => instance.root.visible);
    const fallback = [...this.instances.values()].filter(
      (instance) => instance.fallbackVisible,
    );
    return Object.freeze({
      ...this.templates.diagnostics(),
      instances: this.instances.size,
      loadedInstances: attached.length,
      pendingInstances: pending.length,
      activeKeys: this.assetKeys(active),
      fallbackKeys: this.assetKeys(fallback),
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [id, instance] of this.instances)
      this.remove(id, instance, () => {});
    if (this.ownsTemplates) this.templates.dispose();
    this.group.clear();
    this.group.removeFromParent();
  }

  private present(
    descriptor: ModelDescriptor,
    snapshot: Pick<
      GameRendererSnapshot,
      "presentationElapsed" | "presentationResetId" | "attackCues"
    >,
    setFallbackModelVisible: (id: string, visible: boolean) => void,
  ): void {
    let instance = this.instances.get(descriptor.id);
    const replacedAsset =
      instance !== undefined && instance.asset !== descriptor.asset;
    if (replacedAsset && instance !== undefined) {
      this.remove(descriptor.id, instance, setFallbackModelVisible);
      instance = undefined;
    }
    if (instance === undefined) {
      const root = new THREE.Group();
      root.name = `model:${descriptor.id}`;
      const poseRoot = new THREE.Group();
      poseRoot.name = `pose:${descriptor.id}`;
      root.add(poseRoot);
      instance = {
        root,
        poseRoot,
        asset: descriptor.asset,
        model: undefined,
        playerHitRecovery: descriptor.playerHitRecovery === true,
        fallbackVisible: true,
        yaw: descriptor.rotation,
        targetYaw: descriptor.rotation,
        lastPosition: { ...descriptor.position },
        lastElapsed: snapshot.presentationElapsed,
        resetId: snapshot.presentationResetId,
        pose: undefined,
        hasMeshes: false,
        locomotionDistance: 0,
        moving: false,
        suppressedCueSequence: replacedAsset
          ? descriptor.attackCue?.sequence
          : undefined,
      };
      this.instances.set(descriptor.id, instance);
      this.group.add(root);
      const expected = instance;
      void this.templates.acquire(descriptor.asset).then((model) => {
        if (model === undefined) {
          if (!this.disposed && this.instances.get(descriptor.id) === expected)
            this.onStateChange();
          return;
        }
        if (this.disposed || this.instances.get(descriptor.id) !== expected) {
          disposeObject(model);
          return;
        }
        expected.model = model;
        expected.hasMeshes =
          model.getObjectByProperty("isMesh", true) !== undefined;
        expected.poseRoot.add(model);
        expected.pose = bindModelPose(model, expected.poseRoot, expected.asset);
        this.syncVisibility(descriptor.id, expected, setFallbackModelVisible);
        this.onStateChange();
      });
    }
    instance.playerHitRecovery = descriptor.playerHitRecovery === true;
    let poseCue =
      descriptor.attackCue?.sequence === instance.suppressedCueSequence
        ? undefined
        : descriptor.attackCue;
    instance.root.position.set(
      descriptor.position.x,
      descriptor.height,
      -descriptor.position.y,
    );
    if (descriptor.tangent === true) {
      const movement = {
        x: descriptor.position.x - instance.lastPosition.x,
        y: descriptor.position.y - instance.lastPosition.y,
      };
      if (Math.hypot(movement.x, movement.y) > 0.0001)
        instance.yaw = calibratedYawFor(movement);
      else if (instance.lastElapsed === snapshot.presentationElapsed)
        instance.yaw = descriptor.rotation;
      instance.lastPosition = { ...descriptor.position };
    } else if (descriptor.facing === true) {
      const movement = {
        x: descriptor.position.x - instance.lastPosition.x,
        y: descriptor.position.y - instance.lastPosition.y,
      };
      const distance = Math.hypot(movement.x, movement.y);
      const teleport = distance > 4;
      const reset =
        instance.resetId !== snapshot.presentationResetId || teleport;
      if (reset) {
        instance.targetYaw = descriptor.rotation;
        instance.locomotionDistance = 0;
        instance.moving = false;
        instance.suppressedCueSequence = descriptor.attackCue?.sequence;
        poseCue = undefined;
      } else if (snapshot.presentationElapsed > instance.lastElapsed) {
        instance.moving = distance > 0.0001;
        if (instance.moving) instance.locomotionDistance += distance;
      }
      if (!reset && Math.hypot(movement.x, movement.y) > 0.0001)
        instance.targetYaw = calibratedYawFor(movement);
      if (poseCue !== undefined)
        instance.targetYaw = calibratedYawFor(poseCue.direction);
      const delta = reset
        ? 0
        : snapshot.presentationElapsed - instance.lastElapsed;
      instance.yaw = reset
        ? instance.targetYaw
        : shortestYawTowards(instance.yaw, instance.targetYaw, delta);
      instance.lastPosition = { ...descriptor.position };
      instance.lastElapsed = snapshot.presentationElapsed;
      instance.resetId = snapshot.presentationResetId;
    } else instance.yaw = descriptor.rotation;
    instance.root.rotation.set(0, instance.yaw, 0);
    instance.root.scale.setScalar(descriptor.scale);
    applyModelPose(
      instance.pose,
      poseCue,
      instance.yaw,
      snapshot.presentationElapsed,
      { distance: instance.locomotionDistance, moving: instance.moving },
    );
    this.syncVisibility(descriptor.id, instance, setFallbackModelVisible);
  }

  /** A template only counts once a mesh clone is attached to its live root. */
  private hasAttachedMesh(instance: ModelInstance): boolean {
    return (
      instance.model !== undefined &&
      instance.model.parent === instance.poseRoot &&
      instance.root.parent === this.group &&
      instance.hasMeshes
    );
  }

  private assetKeys(
    instances: readonly ModelInstance[],
  ): readonly ModelAssetKey[] {
    return [...new Set(instances.map((instance) => instance.asset))].sort();
  }

  /**
   * Keep the established geometry visible for a pending/failed asset and while
   * the player recovery blink is active. This runs at completion time, so a
   * late GLB never applies the recovery state that existed when it was queued.
   */
  private syncVisibility(
    id: string,
    instance: ModelInstance,
    setFallbackModelVisible: (id: string, visible: boolean) => void,
  ): void {
    const modelVisible =
      this.hasAttachedMesh(instance) && !instance.playerHitRecovery;
    instance.root.visible = !instance.playerHitRecovery;
    instance.fallbackVisible = !modelVisible;
    setFallbackModelVisible(id, modelVisible);
  }

  private remove(
    id: string,
    instance: ModelInstance,
    setFallbackModelVisible: (id: string, visible: boolean) => void,
  ): void {
    this.instances.delete(id);
    instance.root.removeFromParent();
    // Pose binding reparents weapon parts outside model; this owns every clone resource.
    disposeObject(instance.poseRoot);
    instance.root.clear();
    setFallbackModelVisible(id, false);
  }
}
