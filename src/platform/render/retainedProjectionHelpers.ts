import * as THREE from "three";
import { gameplayTuning, resourceDefinitions } from "../../data/definitions";
import type { GameRendererSnapshot } from "../../domain/notices";
import type { ChunkObstacle, Vector2 } from "../../domain/types";
import {
  knightSlashAnimationFor,
  mageExplosionAnimationFor,
  mageFireballAnimationFor,
} from "./combatAnimationHelpers";
import {
  buildingColors,
  enemyPresentation,
  projectilePresentationFor,
  ProjectionResources,
} from "./projectionResourceHelpers";

type MarkerMap = Map<string, THREE.Mesh>;
type ObstacleMap = Map<string, THREE.Object3D>;

interface MageExplosion {
  readonly core: THREE.Mesh;
  readonly embers: readonly THREE.Mesh[];
  readonly ring: THREE.Mesh;
  readonly root: THREE.Group;
  readonly startedAt: number;
}

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
  private readonly fireballTrails: MarkerMap = new Map();
  private readonly mageExplosions = new Map<string, MageExplosion>();
  private readonly lastMagicProjectiles = new Map<string, Vector2>();
  private readonly drops: MarkerMap = new Map();
  private readonly relicDrops: MarkerMap = new Map();
  private readonly player: THREE.Mesh;
  private destination: THREE.Mesh | undefined;
  private lastPresentationElapsed: number | undefined;
  private lastPresentationResetId: number | undefined;
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
      const wall =
        building.kind === "WoodWall" || building.kind === "StoneWall";
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
        wall
          ? this.resources.wall()
          : this.resources.cylinder(
              0.48 + building.level * 0.07,
              0.7 + building.level * 0.15,
            ),
        wall
          ? this.resources.wallMaterial(building.kind)
          : this.resources.material(buildingColors[building.kind]),
        wall ? 0.5 : 0,
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
    const retainedFireballTrails = new Set<string>();
    const magicProjectiles = new Map<string, Vector2>();
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
      const fireball =
        projectile.style === "magic"
          ? mageFireballAnimationFor(
              projectile.progress,
              snapshot.presentationElapsed,
            )
          : undefined;
      const mesh = this.marker(
        this.projectiles,
        projectile.id,
        position,
        this.resources.sphere(presentation.radius),
        this.resources.material(
          presentation.color,
          0.35,
          presentation.emissive,
        ),
        fireball?.height ?? 0.72,
      );
      mesh.scale.setScalar(fireball?.scale ?? 1);
      if (fireball === undefined) {
        mesh.rotation.set(0, 0, 0);
        const retainedTrail = this.fireballTrails.get(projectile.id);
        if (retainedTrail !== undefined) {
          retainedFireballTrails.add(projectile.id);
          retainedTrail.visible = false;
        }
        continue;
      }

      retainedFireballTrails.add(projectile.id);
      magicProjectiles.set(projectile.id, { ...projectile.targetPosition });
      const direction = {
        x: projectile.targetPosition.x - projectile.origin.x,
        y: projectile.targetPosition.y - projectile.origin.y,
      };
      const distance = Math.hypot(direction.x, direction.y);
      const normalized =
        distance > 0.0001
          ? { x: direction.x / distance, y: direction.y / distance }
          : { x: 0, y: 1 };
      const trail = this.marker(
        this.fireballTrails,
        projectile.id,
        {
          x: position.x - normalized.x * 0.28,
          y: position.y - normalized.y * 0.28,
        },
        this.resources.sphere(0.18),
        this.resources.material(0xffc56b, 0.2, 0xff5b00, 1.3),
        fireball.height - 0.02,
      );
      trail.name = `fireball-trail:${projectile.id}`;
      trail.visible = true;
      trail.rotation.set(0, Math.atan2(normalized.x, -normalized.y), 0);
      trail.scale.set(0.62, 0.52, fireball.trailLength);
    }
    this.removeMissing(this.projectiles, projectiles);
    if (this.fireballTrails.size > 0 || retainedFireballTrails.size > 0)
      this.removeMissing(this.fireballTrails, retainedFireballTrails);
    if (
      this.lastMagicProjectiles.size > 0 ||
      magicProjectiles.size > 0 ||
      this.mageExplosions.size > 0
    )
      this.reconcileMageExplosions(snapshot, magicProjectiles);
    const crescents = new Set<string>();
    for (const attack of snapshot.crescentAttacks) {
      crescents.add(attack.id);
      const length = Math.hypot(attack.direction.x, attack.direction.y);
      const direction =
        length > 0.0001
          ? { x: attack.direction.x / length, y: attack.direction.y / length }
          : { x: 0, y: 1 };
      const slash = knightSlashAnimationFor(attack.progress);
      const mesh = this.marker(
        this.crescents,
        attack.id,
        {
          x: attack.origin.x + direction.x * attack.radius * slash.forward,
          y: attack.origin.y + direction.y * attack.radius * slash.forward,
        },
        this.resources.crescent(attack.radius, attack.arcCosine),
        this.resources.knightCrescentMaterial(),
        slash.height,
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = Math.atan2(direction.y, direction.x) + slash.turn;
      mesh.scale.setScalar(slash.scale);
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
        fireballTrails: this.fireballTrails.size,
        mageExplosions: this.mageExplosions.size,
        drops: this.drops.size,
        relicDrops: this.relicDrops.size,
      }),
    });
  }

  /** Hot-path canvas telemetry must not traverse the whole retained scene. */
  mageExplosionCount(): number {
    return this.mageExplosions.size;
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
      this.fireballTrails,
      this.drops,
      this.relicDrops,
    ]) {
      this.meshesRemoved += map.size;
      map.clear();
    }
    for (const explosion of this.mageExplosions.values())
      this.meshesRemoved += this.meshCount(explosion.root);
    this.mageExplosions.clear();
    this.lastMagicProjectiles.clear();
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
  private reconcileMageExplosions(
    snapshot: GameRendererSnapshot,
    currentMagicProjectiles: ReadonlyMap<string, Vector2>,
  ): void {
    const reset =
      this.lastPresentationResetId !== undefined &&
      snapshot.presentationResetId !== this.lastPresentationResetId;
    const rewound =
      this.lastPresentationElapsed !== undefined &&
      snapshot.presentationElapsed < this.lastPresentationElapsed;
    if (reset || rewound) {
      for (const [id, explosion] of this.mageExplosions)
        this.removeMageExplosion(id, explosion);
      this.lastMagicProjectiles.clear();
    }
    const advanced =
      !reset &&
      !rewound &&
      this.lastPresentationElapsed !== undefined &&
      snapshot.presentationElapsed > this.lastPresentationElapsed;
    if (advanced)
      for (const [id, targetPosition] of this.lastMagicProjectiles)
        if (!currentMagicProjectiles.has(id))
          this.createMageExplosion(
            id,
            targetPosition,
            snapshot.presentationElapsed,
          );

    this.lastMagicProjectiles.clear();
    for (const [id, targetPosition] of currentMagicProjectiles)
      this.lastMagicProjectiles.set(id, { ...targetPosition });
    this.lastPresentationElapsed = snapshot.presentationElapsed;
    this.lastPresentationResetId = snapshot.presentationResetId;
    for (const [id, explosion] of this.mageExplosions) {
      const animation = mageExplosionAnimationFor(
        snapshot.presentationElapsed - explosion.startedAt,
      );
      if (animation.complete) {
        this.removeMageExplosion(id, explosion);
        continue;
      }
      explosion.ring.scale.setScalar(animation.ringScale);
      explosion.ring.position.y = 0.01;
      explosion.core.scale.setScalar(animation.coreScale);
      explosion.core.position.y = 0.16 + animation.emberHeight * 0.25;
      for (const [index, ember] of explosion.embers.entries()) {
        const angle = (index / explosion.embers.length) * Math.PI * 2 + 0.35;
        ember.position.set(
          Math.cos(angle) * animation.emberDistance,
          animation.emberHeight + (index % 2) * 0.045,
          Math.sin(angle) * animation.emberDistance,
        );
        ember.scale.setScalar(Math.max(0.18, animation.coreScale));
      }
    }
  }
  private createMageExplosion(
    id: string,
    targetPosition: Vector2,
    startedAt: number,
  ): void {
    const root = new THREE.Group();
    root.name = `mage-explosion:${id}`;
    this.position(root, targetPosition, 0.14);
    const ring = this.resources.mesh(
      this.resources.ring(0.32),
      this.resources.material(0xffd180, 0.2, 0xff6d00, 1.5),
    );
    ring.name = `${root.name}:ring`;
    ring.rotation.x = -Math.PI / 2;
    const core = this.resources.mesh(
      this.resources.sphere(0.24),
      this.resources.material(0xff8a3d, 0.2, 0xff3d00, 1.7),
    );
    core.name = `${root.name}:core`;
    const embers = Array.from({ length: 6 }, (_, index) => {
      const ember = this.resources.mesh(
        this.resources.sphere(0.07),
        this.resources.material(0xffe0a3, 0.25, 0xff6d00, 1.4),
      );
      ember.name = `${root.name}:ember:${index}`;
      return ember;
    });
    root.add(ring, core, ...embers);
    this.group.add(root);
    this.mageExplosions.set(id, { root, ring, core, embers, startedAt });
  }
  private removeMageExplosion(id: string, explosion: MageExplosion): void {
    explosion.root.removeFromParent();
    this.mageExplosions.delete(id);
    this.meshesRemoved += this.meshCount(explosion.root);
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
