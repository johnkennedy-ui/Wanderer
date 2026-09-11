import * as THREE from "three";
import type { AttackStyle, BuildingKind, EnemyKind } from "../../domain/types";

export const buildingColors = Object.freeze({
  Campfire: 0xff9f43,
  Workshop: 0x8d6e63,
  Farm: 0x4caf50,
  Storage: 0x607d8b,
  Healer: 0x9c6ade,
} satisfies Record<BuildingKind, number>);

export const enemyPresentation = Object.freeze({
  scout: Object.freeze({ color: 0xc75c5c, height: 0.85, radius: 0.43 }),
  brute: Object.freeze({ color: 0x8e2424, height: 0.85, radius: 0.43 }),
  spitter: Object.freeze({ color: 0x6a9f58, height: 0.85, radius: 0.43 }),
  elite: Object.freeze({ color: 0xfbc02d, height: 0.85, radius: 0.6 }),
  boss: Object.freeze({ color: 0xd84315, height: 1.45, radius: 0.85 }),
} satisfies Record<
  EnemyKind,
  { readonly color: number; readonly height: number; readonly radius: number }
>);

const projectilePresentation = Object.freeze({
  slash: Object.freeze({ color: 0xd8dde8, emissive: 0x6d7585, radius: 0.25 }),
  magic: Object.freeze({ color: 0xb388ff, emissive: 0x5e35b1, radius: 0.23 }),
  arrow: Object.freeze({ color: 0x8d6e63, emissive: 0x4e342e, radius: 0.14 }),
  basic: Object.freeze({ color: 0xffe082, emissive: 0x8a5a00, radius: 0.17 }),
} satisfies Record<
  AttackStyle,
  { readonly color: number; readonly emissive: number; readonly radius: number }
>);

const homingProjectilePresentation = Object.freeze({
  color: 0xe6d6ff,
  emissive: 0xab78ff,
  radius: 0.28,
});

export const projectilePresentationFor = (
  style: AttackStyle,
  homing = false,
) => {
  if (homing) return homingProjectilePresentation;
  switch (style) {
    case "slash":
    case "magic":
    case "arrow":
      return projectilePresentation[style];
    default:
      return projectilePresentation.basic;
  }
};

/** Finite presentation variants, shared for the lifetime of one projection. */
export class ProjectionResources {
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private auraMaterial: THREE.MeshBasicMaterial | undefined;
  private crescentMaterial: THREE.MeshBasicMaterial | undefined;
  private geometriesCreated = 0;
  private materialsCreated = 0;
  private meshesCreated = 0;
  private geometriesDisposed = 0;
  private materialsDisposed = 0;
  private disposed = false;

  cylinder(radius: number, height: number): THREE.BufferGeometry {
    return this.geometry(
      `cylinder:${radius}:${height}`,
      () => new THREE.CylinderGeometry(radius, radius, height, 10),
    );
  }
  sphere(radius: number): THREE.BufferGeometry {
    return this.geometry(
      `projectile:${radius}`,
      () => new THREE.SphereGeometry(radius, 10, 10),
    );
  }
  ring(radius: number): THREE.BufferGeometry {
    return this.geometry(
      `aura:${radius}`,
      () => new THREE.RingGeometry(Math.max(0, radius - 0.08), radius, 48),
    );
  }
  crescent(radius: number, arcCosine: number): THREE.BufferGeometry {
    // Direction, progress and attack ID are transient state; only shape
    // selects a retained geometry variant.
    return this.geometry(`crescent:${radius}:${arcCosine}`, () => {
      const halfArc = Math.acos(arcCosine);
      return new THREE.RingGeometry(
        Math.max(0.45, radius - 0.32),
        radius,
        32,
        1,
        -halfArc,
        halfArc * 2,
      );
    });
  }
  knightCrescentMaterial(): THREE.MeshBasicMaterial {
    this.assertLive();
    if (this.crescentMaterial === undefined) {
      this.crescentMaterial = new THREE.MeshBasicMaterial({
        color: 0xd8dde8,
        transparent: true,
        opacity: 0.86,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      this.materialsCreated += 1;
    }
    return this.crescentMaterial;
  }
  healingHutMaterial(): THREE.MeshBasicMaterial {
    this.assertLive();
    if (this.auraMaterial === undefined) {
      this.auraMaterial = new THREE.MeshBasicMaterial({
        color: buildingColors.Healer,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      this.materialsCreated += 1;
    }
    return this.auraMaterial;
  }
  drop(): THREE.BufferGeometry {
    return this.geometry("drop", () => new THREE.DodecahedronGeometry(0.22, 0));
  }
  weaponRelicDrop(): THREE.BufferGeometry {
    return this.geometry(
      "weapon-relic-drop",
      () => new THREE.OctahedronGeometry(0.34, 0),
    );
  }
  material(
    color: number,
    roughness = 0.8,
    emissive = 0,
    emissiveIntensity = 1,
    metalness = 0,
  ): THREE.MeshStandardMaterial {
    this.assertLive();
    const key = `${color}:${roughness}:${emissive}:${emissiveIntensity}:${metalness}`;
    let material = this.materials.get(key);
    if (material === undefined) {
      material = new THREE.MeshStandardMaterial({
        color,
        roughness,
        emissive,
        emissiveIntensity,
        metalness,
      });
      this.materials.set(key, material);
      this.materialsCreated += 1;
    }
    return material;
  }
  mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    this.assertLive();
    this.meshesCreated += 1;
    return new THREE.Mesh(geometry, material);
  }
  diagnostics() {
    return Object.freeze({
      geometriesCreated: this.geometriesCreated,
      materialsCreated: this.materialsCreated,
      meshesCreated: this.meshesCreated,
      geometriesDisposed: this.geometriesDisposed,
      materialsDisposed: this.materialsDisposed,
    });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const geometry of this.geometries.values()) {
      geometry.dispose();
      this.geometriesDisposed += 1;
    }
    for (const material of this.materials.values()) {
      material.dispose();
      this.materialsDisposed += 1;
    }
    if (this.auraMaterial !== undefined) {
      this.auraMaterial.dispose();
      this.materialsDisposed += 1;
      this.auraMaterial = undefined;
    }
    if (this.crescentMaterial !== undefined) {
      this.crescentMaterial.dispose();
      this.materialsDisposed += 1;
      this.crescentMaterial = undefined;
    }
    this.geometries.clear();
    this.materials.clear();
  }
  private geometry(
    key: string,
    create: () => THREE.BufferGeometry,
  ): THREE.BufferGeometry {
    this.assertLive();
    let geometry = this.geometries.get(key);
    if (geometry === undefined) {
      geometry = create();
      this.geometries.set(key, geometry);
      this.geometriesCreated += 1;
    }
    return geometry;
  }
  private assertLive(): void {
    if (this.disposed) throw new Error("Projection resources disposed");
  }
}
