import * as THREE from "three";
import type { BuildingKind, GameSnapshot, Vector2 } from "../../domain/types";

export interface ThreeRenderer {
  render(snapshot: GameSnapshot): void;
  dispose(): void;
}

const toWorld = (position: Vector2): THREE.Vector3 =>
  new THREE.Vector3(position.x, 0, -position.y);

const buildingColor: Readonly<Record<BuildingKind, number>> = {
  Campfire: 0xff9f43,
  Workshop: 0x8d6e63,
  Farm: 0x4caf50,
  Storage: 0x607d8b,
  Healer: 0x9c6ade,
};

export const defaultThreeCameraTuning = Object.freeze({
  fieldOfViewDegrees: 58,
  playerOffset: { x: 11, y: 17, z: 14 },
});

const enemyColor = (kind: string): number => {
  if (kind === "boss") return 0xd84315;
  if (kind === "elite") return 0xfbc02d;
  if (kind === "brute") return 0x8e2424;
  if (kind === "spitter") return 0x6a9f58;
  return 0xc75c5c;
};

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

  return {
    render(snapshot: GameSnapshot): void {
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
          buildingColor[building.kind],
        );
        mesh.position.y = (0.7 + building.level * 0.15) / 2;
        addMarker(mesh, building.position);
      }
      for (const enemy of snapshot.enemies) {
        const height = enemy.kind === "boss" ? 1.45 : 0.85;
        const mesh = cylinder(
          enemy.kind === "boss" ? 0.85 : enemy.kind === "elite" ? 0.6 : 0.43,
          height,
          enemyColor(enemy.kind),
        );
        mesh.position.y = height / 2;
        addMarker(mesh, enemy.position);
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
      renderer.render(scene, camera);
    },
    dispose(): void {
      observer.disconnect();
      disposeGroup(projection);
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
};
