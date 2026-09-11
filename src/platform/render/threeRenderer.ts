import * as THREE from "three";
import { gameplayTuning } from "../../data/definitions";
import type { GameRendererSnapshot } from "../../domain/notices";
import type { Vector2 } from "../../domain/types";
import { RetainedProjection } from "./retainedProjectionHelpers";

export { buildingColors, enemyPresentation } from "./projectionResourceHelpers";

export interface ThreeRenderer {
  readonly canvas: HTMLCanvasElement;
  render(snapshot: GameRendererSnapshot): void;
  worldPositionFromClientPoint(
    clientX: number,
    clientY: number,
  ): Vector2 | null;
  diagnostics(): ReturnType<RetainedProjection["diagnostics"]>;
  dispose(): void;
}

export const defaultThreeCameraTuning = Object.freeze({
  fieldOfViewDegrees: 58,
  playerOffset: { x: 11, y: 17, z: 14 },
});

/** Disposable Three.js projection. It cannot command the session. */
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
  const projection = new RetainedProjection();
  scene.add(projection.group);
  const playerHealthLabel = document.createElement("div");
  playerHealthLabel.dataset.testid = "world-player-hp";
  playerHealthLabel.className = "world-player-hp";
  playerHealthLabel.setAttribute("aria-label", "Player health");
  host.append(playerHealthLabel);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const worldIntersection = new THREE.Vector3();
  const projectedHealth = new THREE.Vector3();
  let disposed = false;

  const resize = (): void => {
    if (disposed) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const worldPositionFromClientPoint = (
    clientX: number,
    clientY: number,
  ): Vector2 | null => {
    if (disposed) return null;
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
    projectedHealth
      .set(snapshot.player.position.x, 1.75, -snapshot.player.position.y)
      .project(camera);
    const left = `${((projectedHealth.x + 1) / 2) * 100}%`;
    const top = `${((1 - projectedHealth.y) / 2) * 100}%`;
    const health = `${Math.ceil(snapshot.player.hp)} / ${snapshot.player.maxHp} HP`;
    if (playerHealthLabel.style.left !== left)
      playerHealthLabel.style.left = left;
    if (playerHealthLabel.style.top !== top) playerHealthLabel.style.top = top;
    if (playerHealthLabel.textContent !== health)
      playerHealthLabel.textContent = health;
  };
  const setDataset = (key: string, value: string): void => {
    if (canvas.dataset[key] !== value) canvas.dataset[key] = value;
  };

  return {
    canvas,
    worldPositionFromClientPoint,
    diagnostics: () => projection.diagnostics(),
    render(snapshot: GameRendererSnapshot): void {
      if (disposed) return;
      projection.render(snapshot);
      camera.position.set(
        snapshot.player.position.x + defaultThreeCameraTuning.playerOffset.x,
        defaultThreeCameraTuning.playerOffset.y,
        -snapshot.player.position.y + defaultThreeCameraTuning.playerOffset.z,
      );
      camera.lookAt(snapshot.player.position.x, 0, -snapshot.player.position.y);
      camera.updateMatrixWorld();
      positionPlayerHealthLabel(snapshot);
      setDataset("floorDropCount", String(snapshot.floorDrops.length));
      setDataset(
        "weaponRelicDropCount",
        String(snapshot.weaponRelicDrops.length),
      );
      let homingProjectileCount = 0;
      for (const projectile of snapshot.projectiles)
        if (projectile.homing === true) homingProjectileCount += 1;
      setDataset("homingProjectileCount", String(homingProjectileCount));
      setDataset("projectileCount", String(snapshot.projectiles.length));
      setDataset(
        "crescentAttackCount",
        String(snapshot.crescentAttacks.length),
      );
      setDataset(
        "playerHitRecovery",
        snapshot.playerHitRecovery.active ? "active" : "inactive",
      );
      setDataset(
        "playerHitFlash",
        snapshot.playerHitRecovery.flashOn ? "on" : "off",
      );
      const healingHutAuras = snapshot.visibleBuildings.filter(
        (building) => building.kind === "Healer",
      );
      setDataset("healingHutAuraCount", String(healingHutAuras.length));
      setDataset(
        "healingHutAuraRadii",
        healingHutAuras
          .map(
            (building) =>
              gameplayTuning.healingHutRadiusByLevel[building.level - 1],
          )
          .join(","),
      );
      renderer.render(scene, camera);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      projection.dispose();
      floor.geometry.dispose();
      floor.material.dispose();
      scene.clear();
      renderer.dispose();
      playerHealthLabel.remove();
      canvas.remove();
    },
  };
};
