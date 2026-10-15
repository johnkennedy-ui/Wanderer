import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  buildingIdFromIntersections,
  harvestableNodeIdFromIntersections,
} from "../../platform/render/harvestRaycastHelpers";

const mesh = (): THREE.Mesh =>
  new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());

const rayHits = (scene: THREE.Object3D): THREE.Intersection[] => {
  scene.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(0, 0, 5),
    new THREE.Vector3(0, 0, -1),
  );
  return raycaster.intersectObjects([scene], true);
};

describe("building raycast selection", () => {
  it("selects a visible building marker, but not through a nearer solid blocker", () => {
    const building = new THREE.Group();
    building.userData.buildingId = "building:seed:1";
    building.position.z = 0;
    building.add(mesh());

    const scene = new THREE.Group();
    scene.add(building);
    expect(buildingIdFromIntersections(rayHits(scene))).toBe("building:seed:1");

    const blocker = new THREE.Group();
    blocker.userData.harvestRayBlocker = true;
    blocker.position.z = 2;
    blocker.add(mesh());
    scene.add(blocker);
    expect(buildingIdFromIntersections(rayHits(scene))).toBeNull();
  });

  it("ignores a hidden building marker", () => {
    const building = new THREE.Group();
    building.visible = false;
    building.userData.buildingId = "building:hidden";
    building.add(mesh());
    expect(buildingIdFromIntersections(rayHits(building))).toBeNull();
  });
});

describe("harvest raycast visibility", () => {
  it("does not select a resource behind a nearer solid terrain obstacle on the same ray", () => {
    const blocker = new THREE.Group();
    blocker.userData.harvestRayBlocker = true;
    blocker.position.z = 2;
    blocker.add(mesh());

    const resource = new THREE.Group();
    resource.userData.harvestRayBlocker = true;
    resource.userData.harvestNodeId = "tree:wanderer-web-v3:seed:0:0:0";
    resource.position.z = 0;
    resource.add(mesh());

    const scene = new THREE.Group();
    scene.add(resource, blocker);
    const hits = rayHits(scene);

    expect(hits.length).toBeGreaterThan(1);
    expect(hits[0]?.distance).toBeLessThan(hits.at(-1)?.distance ?? Infinity);
    expect(harvestableNodeIdFromIntersections(hits)).toBeNull();
  });

  it("ignores invisible and unmarked decoration before a resource", () => {
    const hiddenBlocker = new THREE.Group();
    hiddenBlocker.visible = false;
    hiddenBlocker.userData.harvestRayBlocker = true;
    hiddenBlocker.position.z = 3;
    hiddenBlocker.add(mesh());

    const decoration = mesh();
    decoration.position.z = 2;

    const resource = new THREE.Group();
    resource.userData.harvestRayBlocker = true;
    resource.userData.harvestNodeId = "rock:wanderer-web-v3:seed:0:0:1";
    resource.add(mesh());

    const scene = new THREE.Group();
    scene.add(resource, decoration, hiddenBlocker);

    expect(harvestableNodeIdFromIntersections(rayHits(scene))).toBe(
      "rock:wanderer-web-v3:seed:0:0:1",
    );
  });
});
