import * as THREE from "three";
import { resourceDefinitions } from "../../data/definitions";
import type { GameRendererSnapshot } from "../../domain/notices";
import type {
  BuildingKind,
  EnemyKind,
  ProjectileState,
  Vector2,
} from "../../domain/types";

export interface ThreeRenderer {
  readonly canvas: HTMLCanvasElement;
  render(snapshot: GameRendererSnapshot): void;
  worldPositionFromClientPoint(
    clientX: number,
    clientY: number,
  ): Vector2 | null;
  dispose(): void;
}

const toWorld = (position: Vector2): THREE.Vector3 =>
  new THREE.Vector3(position.x, 0, -position.y);

export const buildingColors = Object.freeze({
  Campfire: 0xff9f43,
  Workshop: 0x8d6e63,
  Farm: 0x4caf50,
  Storage: 0x607d8b,
  Healer: 0x9c6ade,
} satisfies Record<BuildingKind, number>);

interface EnemyPresentation {
  readonly color: number;
  readonly height: number;
  readonly radius: number;
}

export const enemyPresentation = Object.freeze({
  scout: Object.freeze({ color: 0xc75c5c, height: 0.85, radius: 0.43 }),
  brute: Object.freeze({ color: 0x8e2424, height: 0.85, radius: 0.43 }),
  spitter: Object.freeze({ color: 0x6a9f58, height: 0.85, radius: 0.43 }),
  elite: Object.freeze({ color: 0xfbc02d, height: 0.85, radius: 0.6 }),
  boss: Object.freeze({ color: 0xd84315, height: 1.45, radius: 0.85 }),
} satisfies Record<EnemyKind, EnemyPresentation>);

export const defaultThreeCameraTuning = Object.freeze({
  fieldOfViewDegrees: 58,
  playerOffset: { x: 11, y: 17, z: 14 },
});

const projectilePosition = (projectile: ProjectileState): Vector2 => ({
  x:
    projectile.origin.x +
    (projectile.targetPosition.x - projectile.origin.x) * projectile.progress,
  y:
    projectile.origin.y +
    (projectile.targetPosition.y - projectile.origin.y) * projectile.progress,
});

const disposeGroup = (group: THREE.Group): void => {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      if (Array.isArray(object.material))
        object.material.forEach((material) => material.dispose());
      else object.material.dispose();
    }
  });
  group.clear();
};

const cylinder = (radius: number, height: number, color: number): THREE.Mesh =>
  new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 10),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
  );

/** Disposable Three.js projection. It only receives snapshots; it cannot command the session. */
export const createThreeRenderer = (host: HTMLElement): ThreeRenderer => {
  const canvas = document.createElement("canvas");
  canvas.dataset.testid = "world-canvas";
  canvas.className = "world-canvas";
  host.append(canvas);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x101820);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    defaultThreeCameraTuning.fieldOfViewDegrees,
    1,
    0.1,
    100,
  );
  const ambient = new THREE.HemisphereLight(0xd9ecff, 0x203019, 2.2);
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(5, 12, 6);
  scene.add(ambient, key);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x30492d, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const projection = new THREE.Group();
  scene.add(projection);
  const playerHealthLabel = document.createElement("div");
  playerHealthLabel.dataset.testid = "world-player-hp";
  playerHealthLabel.className = "world-player-hp";
  playerHealthLabel.setAttribute("aria-label", "Player health");
  host.append(playerHealthLabel);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const worldIntersection = new THREE.Vector3();

  const resize = (): void => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const addMarker = (mesh: THREE.Mesh, position: Vector2): void => {
    mesh.position.copy(toWorld(position));
    projection.add(mesh);
  };

  const worldPositionFromClientPoint = (
    clientX: number,
    clientY: number,
  ): Vector2 | null => {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.ray.intersectPlane(groundPlane, worldIntersection) === null)
      return null;
    return { x: worldIntersection.x, y: -worldIntersection.z };
  };

  const positionPlayerHealthLabel = (snapshot: GameRendererSnapshot): void => {
    const projected = toWorld(snapshot.player.position);
    projected.y = 1.75;
    projected.project(camera);
    playerHealthLabel.style.left = `${((projected.x + 1) / 2) * 100}%`;
    playerHealthLabel.style.top = `${((1 - projected.y) / 2) * 100}%`;
    playerHealthLabel.textContent = `${Math.ceil(snapshot.player.hp)} / ${snapshot.player.maxHp} HP`;
  };

  return {
    canvas,
    worldPositionFromClientPoint,
    render(snapshot: GameRendererSnapshot): void {
      disposeGroup(projection);
      for (const chunk of snapshot.visibleChunks) {
        for (const obstacle of chunk.obstacles)
          addMarker(cylinder(0.38, 0.9, 0x596869), obstacle.position);
        for (const campfire of chunk.campfires) {
          const fire = cylinder(0.35, 0.5, 0xff8a3d);
          fire.position.y = 0.25;
          addMarker(fire, campfire.position);
        }
      }
      for (const building of snapshot.visibleBuildings) {
        const mesh = cylinder(
          0.48 + building.level * 0.07,
          0.7 + building.level * 0.15,
          buildingColors[building.kind],
        );
        mesh.position.y = (0.7 + building.level * 0.15) / 2;
        addMarker(mesh, building.position);
      }
      for (const enemy of snapshot.enemies) {
        const presentation = enemyPresentation[enemy.kind];
        const mesh = cylinder(
          presentation.radius,
          presentation.height,
          presentation.color,
        );
        mesh.position.y = presentation.height / 2;
        addMarker(mesh, enemy.position);
      }
      for (const projectile of snapshot.projectiles) {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.17, 10, 10),
          new THREE.MeshStandardMaterial({
            color: 0xffe082,
            emissive: 0x8a5a00,
            roughness: 0.35,
          }),
        );
        mesh.position.copy(toWorld(projectilePosition(projectile)));
        mesh.position.y = 0.72;
        projection.add(mesh);
      }
      for (const drop of snapshot.floorDrops) {
        const mesh = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.22, 0),
          new THREE.MeshStandardMaterial({
            color: resourceDefinitions[drop.resource].groundDropColor,
            emissive: resourceDefinitions[drop.resource].groundDropColor,
            emissiveIntensity: 0.22,
            roughness: 0.35,
          }),
        );
        mesh.position.copy(toWorld(drop.position));
        mesh.position.y = 0.24;
        projection.add(mesh);
      }
      const player = cylinder(0.45, 1.05, 0x58a6ff);
      player.position.y = 0.525;
      addMarker(player, snapshot.player.position);
      camera.position.set(
        snapshot.player.position.x + defaultThreeCameraTuning.playerOffset.x,
        defaultThreeCameraTuning.playerOffset.y,
        -snapshot.player.position.y + defaultThreeCameraTuning.playerOffset.z,
      );
      camera.lookAt(snapshot.player.position.x, 0, -snapshot.player.position.y);
      positionPlayerHealthLabel(snapshot);
      canvas.dataset.floorDropCount = String(snapshot.floorDrops.length);
      renderer.render(scene, camera);
    },
    dispose(): void {
      observer.disconnect();
      disposeGroup(projection);
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      renderer.dispose();
      playerHealthLabel.remove();
      canvas.remove();
    },
  };
};
