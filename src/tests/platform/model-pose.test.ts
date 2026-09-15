import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyModelPose, bindModelPose } from "../../platform/render/modelPoseHelpers";

describe("model combat pose binding", () => {
  it("measures a rigid part grip, preserves its authored transform, and restores recovery pose", () => {
    const poseRoot = new THREE.Group();
    const model = new THREE.Group();
    poseRoot.add(model);
    const sword = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 0.2));
    sword.name = "sword";
    sword.position.set(1.2, 0.4, -0.3);
    model.add(sword);
    const before = sword.getWorldPosition(new THREE.Vector3()).clone();

    const binding = bindModelPose(model, poseRoot, "player-knight");
    expect(binding).toBeDefined();
    expect(sword.getWorldPosition(new THREE.Vector3())).toEqual(before);

    applyModelPose(
      binding,
      { actorId: "player", sequence: 4, direction: { x: 1, y: 0 }, style: "slash", age: 0.15 },
      0,
      1,
    );
    expect(binding?.aimPivot.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(binding?.weaponPivot.rotation.x).not.toBe(0);

    applyModelPose(binding, undefined, 0, 1);
    expect(binding?.weaponPivot.rotation.x).toBe(0);
    expect(sword.position.toArray()).toEqual(
      binding?.neutralParts[0].position.toArray(),
    );
  });

  it("includes archer bow variants and repaired enemy rigid parts only once", () => {
    const model = new THREE.Group();
    const poseRoot = new THREE.Group();
    poseRoot.add(model);
    for (const name of ["bow_body", "bow_string", "spear", "spear_tip"] as const) {
      const part = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
      part.name = name;
      part.position.x = name.length;
      model.add(part);
    }
    expect(bindModelPose(model, poseRoot, "player-archer")?.neutralParts).toHaveLength(2);
    const scout = new THREE.Group();
    const scoutPoseRoot = new THREE.Group();
    scoutPoseRoot.add(scout);
    for (const name of ["spear", "spear_tip"] as const) {
      const part = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
      part.name = name;
      scout.add(part);
    }
    expect(bindModelPose(scout, scoutPoseRoot, "enemy-scout")?.neutralParts).toHaveLength(2);
  });
});
