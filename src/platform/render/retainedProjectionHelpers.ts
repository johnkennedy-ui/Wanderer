import * as THREE from "three";
import { gameplayTuning, resourceDefinitions } from "../../data/definitions";
import type { GameRendererSnapshot } from "../../domain/notices";
import type { Vector2 } from "../../domain/types";
import {
  buildingColors,
  enemyPresentation,
  projectilePresentationFor,
  ProjectionResources,
} from "./projectionResourceHelpers";

type MarkerMap = Map<string, THREE.Mesh>;

/** CPU-testable retained visual owner; never holds or commands gameplay state. */
export class RetainedProjection {
  readonly group = new THREE.Group();
  private readonly resources = new ProjectionResources();
  private readonly obstacles: MarkerMap = new Map();
  private readonly campfires: MarkerMap = new Map();
  private readonly buildings: MarkerMap = new Map();
  private readonly auras: MarkerMap = new Map();
  private readonly enemies: MarkerMap = new Map();
  private readonly projectiles: MarkerMap = new Map();
  private readonly crescents: MarkerMap = new Map();
  private readonly drops: MarkerMap = new Map();
  private readonly player: THREE.Mesh;
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
        this.marker(
          this.obstacles,
          obstacle.id,
          obstacle.position,
          this.resources.cylinder(0.38, 0.9),
          this.resources.material(0x596869),
        );
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
      this.marker(
        this.enemies,
        enemy.id,
        enemy.position,
        this.resources.cylinder(presentation.radius, presentation.height),
        this.resources.material(presentation.color),
      );
    }
    this.removeMissing(this.enemies, enemies);
    const projectiles = new Set<string>();
    for (const projectile of snapshot.projectiles) {
      projectiles.add(projectile.id);
      const presentation = projectilePresentationFor(projectile.style);
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
      visibleMeshes: this.group.children.length,
      maps: Object.freeze({
        obstacles: this.obstacles.size,
        campfires: this.campfires.size,
        buildings: this.buildings.size,
        auras: this.auras.size,
        enemies: this.enemies.size,
        projectiles: this.projectiles.size,
        crescents: this.crescents.size,
        drops: this.drops.size,
      }),
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const map of [
      this.obstacles,
      this.campfires,
      this.buildings,
      this.auras,
      this.enemies,
      this.projectiles,
      this.crescents,
      this.drops,
    ]) {
      this.meshesRemoved += map.size;
      map.clear();
    }
    this.meshesRemoved += 1;
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
  private position(mesh: THREE.Mesh, position: Vector2, height: number): void {
    if (
      mesh.position.x !== position.x ||
      mesh.position.y !== height ||
      mesh.position.z !== -position.y
    )
      mesh.position.set(position.x, height, -position.y);
  }
  private removeMissing(map: MarkerMap, visible: ReadonlySet<string>): void {
    for (const [id, mesh] of map) {
      if (visible.has(id)) continue;
      mesh.removeFromParent();
      map.delete(id);
      this.meshesRemoved += 1;
    }
  }
}
