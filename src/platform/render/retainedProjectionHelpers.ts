import * as THREE from "three";
import { gameplayTuning, resourceDefinitions } from "../../data/definitions";
import type { GameRendererSnapshot } from "../../domain/notices";
import type { ChunkObstacle, Vector2 } from "../../domain/types";
import {
  buildingColors,
  enemyPresentation,
  projectilePresentationFor,
  ProjectionResources,
} from "./projectionResourceHelpers";

type MarkerMap = Map<string, THREE.Mesh>;
type ObstacleMap = Map<string, THREE.Object3D>;

/** CPU-testable retained visual owner; never holds or commands gameplay state. */
export class RetainedProjection {
  readonly group = new THREE.Group();
  private readonly resources = new ProjectionResources();
  private readonly obstacles: ObstacleMap = new Map();
  private readonly campfires: MarkerMap = new Map();
  private readonly buildings: MarkerMap = new Map();
  private readonly auras: MarkerMap = new Map();
  private readonly enemies: MarkerMap = new Map();
  private readonly projectiles: MarkerMap = new Map();
  private readonly crescents: MarkerMap = new Map();
  private readonly drops: MarkerMap = new Map();
  private readonly relicDrops: MarkerMap = new Map();
  private readonly player: THREE.Mesh;
  private destination: THREE.Mesh | undefined;
  private meshesRemoved = 0;
  private disposed = false;

  constructor() {
    this.player = this.resources.mesh(
      this.resources.cylinder(0.45, 1.05),
      this.resources.material(0x58a6ff),
    );
    this.player.name = "player";
    this.group.add(this.player);
  }

  render(snapshot: GameRendererSnapshot): void {
    if (this.disposed) return;
    const obstacles = new Set<string>();
    const campfires = new Set<string>();
    for (const chunk of snapshot.visibleChunks) {
      for (const obstacle of chunk.obstacles) {
        obstacles.add(obstacle.id);
        this.obstacle(obstacle);
      }
      for (const campfire of chunk.campfires) {
        campfires.add(campfire.id);
        this.marker(
          this.campfires,
          campfire.id,
          campfire.position,
          this.resources.cylinder(0.35, 0.5),
          this.resources.material(0xff8a3d),
        );
      }
    }
    this.removeMissing(this.obstacles, obstacles);
    this.removeMissing(this.campfires, campfires);
    if (snapshot.destination === null) {
      if (this.destination !== undefined) {
        this.destination.removeFromParent();
        this.destination = undefined;
        this.meshesRemoved += 1;
      }
    } else {
      if (this.destination === undefined) {
        this.destination = this.resources.mesh(
          this.resources.destinationMarker(),
          this.resources.destinationMarkerMaterial(),
        );
        this.destination.name = "destination-marker";
        this.destination.rotation.x = -Math.PI / 2;
        this.group.add(this.destination);
      }
      this.position(this.destination, snapshot.destination, 0.03);
    }
    const buildings = new Set<string>();
    const auras = new Set<string>();
    for (const building of snapshot.visibleBuildings) {
      buildings.add(building.id);
      if (building.kind === "Healer") {
        auras.add(building.id);
        const aura = this.marker(
          this.auras,
          building.id,
          building.position,
          this.resources.ring(
            gameplayTuning.healingHutRadiusByLevel[building.level - 1],
          ),
          this.resources.healingHutMaterial(),
          0.025,
        );
        aura.name = `aura:${building.id}`;
        aura.rotation.x = -Math.PI / 2;
      }
      this.marker(
        this.buildings,
        building.id,
        building.position,
        this.resources.cylinder(
          0.48 + building.level * 0.07,
          0.7 + building.level * 0.15,
        ),
        this.resources.material(buildingColors[building.kind]),
      );
    }
    this.removeMissing(this.buildings, buildings);
    this.removeMissing(this.auras, auras);
    const enemies = new Set<string>();
    for (const enemy of snapshot.enemies) {
      enemies.add(enemy.id);
      const presentation = enemyPresentation[enemy.kind];
      const scale = enemy.isWaveBoss ? gameplayTuning.waveBossVisualScale : 1;
      this.marker(
        this.enemies,
        enemy.id,
        enemy.position,
        this.resources.cylinder(
          presentation.radius * scale,
          presentation.height * scale,
        ),
        this.resources.material(
          presentation.color,
          0.8,
          enemy.isWaveBoss ? 0xff6d00 : 0,
          enemy.isWaveBoss ? 0.65 : 1,
        ),
      );
    }
    this.removeMissing(this.enemies, enemies);
    const projectiles = new Set<string>();
    for (const projectile of snapshot.projectiles) {
      projectiles.add(projectile.id);
      const presentation = projectilePresentationFor(
        projectile.style,
        projectile.homing === true,
      );
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
      this.marker(
        this.projectiles,
        projectile.id,
        position,
        this.resources.sphere(presentation.radius),
        this.resources.material(
          presentation.color,
          0.35,
          presentation.emissive,
        ),
        0.72,
      );
    }
    this.removeMissing(this.projectiles, projectiles);
    const crescents = new Set<string>();
    for (const attack of snapshot.crescentAttacks) {
      crescents.add(attack.id);
      const mesh = this.marker(
        this.crescents,
        attack.id,
        attack.origin,
        this.resources.crescent(attack.radius, attack.arcCosine),
        this.resources.knightCrescentMaterial(),
        0.08,
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = Math.atan2(attack.direction.y, attack.direction.x);
    }
    this.removeMissing(this.crescents, crescents);
    const drops = new Set<string>();
    for (const drop of snapshot.floorDrops) {
      drops.add(drop.id);
      const color = resourceDefinitions[drop.resource].groundDropColor;
      this.marker(
        this.drops,
        drop.id,
        drop.position,
        this.resources.drop(),
        this.resources.material(color, 0.35, color, 0.22),
        0.24,
      );
    }
    this.removeMissing(this.drops, drops);
    const relicDrops = new Set<string>();
    for (const drop of snapshot.weaponRelicDrops) {
      relicDrops.add(drop.id);
      this.marker(
        this.relicDrops,
        drop.id,
        drop.position,
        this.resources.weaponRelicDrop(),
        this.resources.material(0xffe082, 0.2, 0xff8f00, 1.1, 0.55),
        0.38,
      );
    }
    this.removeMissing(this.relicDrops, relicDrops);
    // Select immutable-equivalent variants: never recolor a shared material.
    // Inactive frames select non-emissive material again, clearing recovery.
    const recovery = snapshot.playerHitRecovery;
    this.player.material = this.resources.material(
      recovery.flashOn ? 0xfff3b0 : 0x58a6ff,
      0.8,
      recovery.active ? (recovery.flashOn ? 0xff7043 : 0x1b4f72) : 0,
      recovery.active ? (recovery.flashOn ? 1.1 : 0.2) : 1,
    );
    // Legacy addMarker overwrote every cylinder Y assignment with zero.
    // Preserve the actual greybox appearance, not the old intended heights.
    this.position(this.player, snapshot.player.position, 0);
  }

  diagnostics() {
    return Object.freeze({
      ...this.resources.diagnostics(),
      meshesRemoved: this.meshesRemoved,
      visibleMeshes: this.meshCount(this.group),
      maps: Object.freeze({
        obstacles: this.obstacles.size,
        campfires: this.campfires.size,
        buildings: this.buildings.size,
        auras: this.auras.size,
        enemies: this.enemies.size,
        projectiles: this.projectiles.size,
        crescents: this.crescents.size,
        drops: this.drops.size,
        relicDrops: this.relicDrops.size,
      }),
    });
  }

  /** Keeps the proven geometric marker as an async GLB fallback. */
  setModelVisible(id: string, visible: boolean): void {
    const mesh =
      id === "player"
        ? this.player
        : [
            this.campfires,
            this.buildings,
            this.enemies,
            this.projectiles,
            this.crescents,
          ]
            .map((map) => map.get(id))
            .find((candidate) => candidate !== undefined);
    const obstacle = this.obstacles.get(id);
    if (obstacle !== undefined) obstacle.visible = !visible;
    if (mesh !== undefined) mesh.visible = !visible;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const map of [
      this.campfires,
      this.buildings,
      this.auras,
      this.enemies,
      this.projectiles,
      this.crescents,
      this.drops,
      this.relicDrops,
    ]) {
      this.meshesRemoved += map.size;
      map.clear();
    }
    for (const obstacle of this.obstacles.values())
      this.meshesRemoved += this.meshCount(obstacle);
    this.obstacles.clear();
    this.meshesRemoved += 1;
    if (this.destination !== undefined) {
      this.destination.removeFromParent();
      this.destination = undefined;
      this.meshesRemoved += 1;
    }
    this.group.clear();
    this.group.removeFromParent();
    this.resources.dispose();
  }

  private marker(
    map: MarkerMap,
    id: string,
    position: Vector2,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    height = 0,
  ): THREE.Mesh {
    let mesh = map.get(id);
    if (mesh === undefined) {
      mesh = this.resources.mesh(geometry, material);
      mesh.name = id;
      map.set(id, mesh);
      this.group.add(mesh);
    } else {
      if (mesh.geometry !== geometry) mesh.geometry = geometry;
      if (mesh.material !== material) mesh.material = material;
    }
    this.position(mesh, position, height);
    return mesh;
  }
  private position(
    mesh: THREE.Object3D,
    position: Vector2,
    height: number,
  ): void {
    if (
      mesh.position.x !== position.x ||
      mesh.position.y !== height ||
      mesh.position.z !== -position.y
    )
      mesh.position.set(position.x, height, -position.y);
  }
  private obstacle(obstacle: ChunkObstacle): void {
    const existing = this.obstacles.get(obstacle.id);
    if (existing !== undefined) {
      this.position(existing, obstacle.position, 0);
      return;
    }
    if (obstacle.kind === undefined) {
      const legacy = this.resources.mesh(
        this.resources.cylinder(0.38, 0.9),
        this.resources.material(0x596869),
      );
      legacy.name = obstacle.id;
      this.position(legacy, obstacle.position, 0);
      this.obstacles.set(obstacle.id, legacy);
      this.group.add(legacy);
      return;
    }
    const radius = obstacle.radius ?? 0.38;
    const root = new THREE.Group();
    root.name = obstacle.id;
    const add = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      height: number,
      rotation = 0,
    ) => {
      const mesh = this.resources.mesh(geometry, material);
      mesh.position.y = height;
      mesh.rotation.x = rotation;
      root.add(mesh);
    };
    switch (obstacle.kind) {
      case "tree":
        add(
          this.resources.cylinder(radius, radius * 3.2),
          this.resources.material(0x6d4c41),
          radius * 1.6,
        );
        add(
          this.resources.cone(radius * 1.65, radius * 3.8),
          this.resources.material(0x2e7d32),
          radius * 4.1,
        );
        break;
      case "mountain":
        add(
          this.resources.mountain(radius),
          this.resources.material(0x6d7378),
          radius * 0.825,
        );
        break;
      case "water":
        add(
          this.resources.water(radius),
          this.resources.material(
            obstacle.waterKind === "river" ? 0x1976a8 : 0x2196c9,
            0.35,
            0x0d47a1,
            0.12,
          ),
          0.012,
          -Math.PI / 2,
        );
        add(
          this.resources.waterBank(radius),
          this.resources.material(0x8a7b58),
          // Water from adjacent cells covers internal bank arcs, leaving a
          // continuous shoreline instead of rings across the river surface.
          0.008,
          -Math.PI / 2,
        );
        break;
      case "rock":
        add(
          this.resources.mountain(radius),
          this.resources.material(0x596869),
          radius * 0.825,
        );
        break;
    }
    this.position(root, obstacle.position, 0);
    this.obstacles.set(obstacle.id, root);
    this.group.add(root);
  }
  private meshCount(root: THREE.Object3D): number {
    let count = 0;
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) count += 1;
    });
    return count;
  }
  private removeMissing(
    map: Map<string, THREE.Object3D>,
    visible: ReadonlySet<string>,
  ): void {
    for (const [id, mesh] of map) {
      if (visible.has(id)) continue;
      mesh.removeFromParent();
      map.delete(id);
      this.meshesRemoved += this.meshCount(mesh);
    }
  }
}
