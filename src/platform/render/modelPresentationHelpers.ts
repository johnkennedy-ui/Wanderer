import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { GameRendererSnapshot } from "../../domain/notices";
import type {
  AttackStyle,
  BuildingKind,
  EnemyKind,
  Vector2,
} from "../../domain/types";

export const modelAssets = Object.freeze({
  players: Object.freeze({
    knight: "player_knight.glb",
    wizard: "player_wizard.glb",
    archer: "player_archer.glb",
  }),
  enemies: Object.freeze({
    scout: "enemy_scout.glb",
    brute: "enemy_brute.glb",
    spitter: "enemy_spitter.glb",
    elite: "enemy_elite.glb",
    boss: "enemy_ember_wyrm.glb",
  } satisfies Record<EnemyKind, string>),
  projectiles: Object.freeze({
    knight: "projectile_knight_blade_arc.glb",
    wizard: "projectile_wizard_flame_orb.glb",
    archer: "projectile_archer_arrow.glb",
  }),
  buildings: Object.freeze({
    Campfire: "building_campfire.glb",
    Workshop: "building_workshop.glb",
    Farm: "building_farm.glb",
    Storage: "building_storage.glb",
    Healer: "building_healing_hut.glb",
  } satisfies Record<BuildingKind, string>),
});

export type ModelAssetKey =
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
  const [category, kind] = key.split("-") as [string, string];
  if (category === "player")
    return modelAssets.players[kind as keyof typeof modelAssets.players];
  if (category === "enemy") return modelAssets.enemies[kind as EnemyKind];
  if (category === "projectile")
    return modelAssets.projectiles[
      kind as keyof typeof modelAssets.projectiles
    ];
  return modelAssets.buildings[kind as BuildingKind];
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
  readonly playerHitRecovery?: boolean;
}

interface ModelInstance {
  readonly root: THREE.Group;
  asset: ModelAssetKey;
  model: THREE.Group | undefined;
}

const playerModelFor = (
  playerClass: GameRendererSnapshot["playerClass"],
): ModelAssetKey => `player-${playerClass ?? "knight"}`;

/** Async model layer over the retained geometry fallback projection. */
export class ModelProjection {
  readonly group = new THREE.Group();
  private readonly instances = new Map<string, ModelInstance>();
  private disposed = false;

  constructor(private readonly templates = new ModelTemplateCache()) {}

  render(
    snapshot: GameRendererSnapshot,
    setFallbackModelVisible: (id: string, visible: boolean) => void,
  ): void {
    if (this.disposed) return;
    const descriptors: ModelDescriptor[] = [
      {
        id: "player",
        asset: playerModelFor(snapshot.playerClass),
        position: snapshot.player.position,
        height: 0,
        scale: 0.78,
        rotation: Math.PI,
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
      ...snapshot.visibleBuildings.map((building) => ({
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
        rotation: Math.PI,
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
        return {
          id: projectile.id,
          asset: projectileModelFor(projectile.style),
          position,
          height: 0.72,
          scale: projectile.style === "arrow" ? 0.55 : 0.5,
          rotation: Math.atan2(
            projectile.targetPosition.x - projectile.origin.x,
            -(projectile.targetPosition.y - projectile.origin.y),
          ),
        };
      }),
      ...snapshot.crescentAttacks.map((attack) => ({
        id: attack.id,
        asset: "projectile-knight" as const,
        position: attack.origin,
        height: 0.08,
        scale: Math.max(0.45, attack.radius * 0.28),
        rotation: Math.atan2(attack.direction.x, -attack.direction.y),
      })),
    ];
    const visible = new Set(descriptors.map((descriptor) => descriptor.id));
    for (const descriptor of descriptors)
      this.present(descriptor, setFallbackModelVisible);
    for (const [id, instance] of this.instances)
      if (!visible.has(id)) this.remove(id, instance, setFallbackModelVisible);
  }

  diagnostics() {
    return Object.freeze({
      ...this.templates.diagnostics(),
      instances: this.instances.size,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [id, instance] of this.instances)
      this.remove(id, instance, () => {});
    this.templates.dispose();
    this.group.clear();
    this.group.removeFromParent();
  }

  private present(
    descriptor: ModelDescriptor,
    setFallbackModelVisible: (id: string, visible: boolean) => void,
  ): void {
    let instance = this.instances.get(descriptor.id);
    if (instance !== undefined && instance.asset !== descriptor.asset) {
      this.remove(descriptor.id, instance, setFallbackModelVisible);
      instance = undefined;
    }
    if (instance === undefined) {
      const root = new THREE.Group();
      root.name = `model:${descriptor.id}`;
      instance = {
        root,
        asset: descriptor.asset,
        model: undefined,
      };
      this.instances.set(descriptor.id, instance);
      this.group.add(root);
      const expected = instance;
      void this.templates.acquire(descriptor.asset).then((model) => {
        if (
          model === undefined ||
          this.disposed ||
          this.instances.get(descriptor.id) !== expected
        ) {
          if (model !== undefined) disposeObject(model);
          return;
        }
        expected.model = model;
        expected.root.add(model);
        setFallbackModelVisible(
          descriptor.id,
          descriptor.playerHitRecovery !== true,
        );
      });
    }
    instance.root.position.set(
      descriptor.position.x,
      descriptor.height,
      -descriptor.position.y,
    );
    instance.root.rotation.set(0, descriptor.rotation, 0);
    instance.root.scale.setScalar(descriptor.scale);
    instance.root.visible = descriptor.playerHitRecovery !== true;
    if (instance.model !== undefined)
      setFallbackModelVisible(
        descriptor.id,
        descriptor.playerHitRecovery !== true,
      );
  }

  private remove(
    id: string,
    instance: ModelInstance,
    setFallbackModelVisible: (id: string, visible: boolean) => void,
  ): void {
    this.instances.delete(id);
    instance.root.removeFromParent();
    if (instance.model !== undefined) disposeObject(instance.model);
    instance.root.clear();
    setFallbackModelVisible(id, false);
  }
}
