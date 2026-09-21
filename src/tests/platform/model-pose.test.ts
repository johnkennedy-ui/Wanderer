import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  applyModelPose,
  bindModelPose,
} from "../../platform/render/modelPoseHelpers";
import { calibratedYawFor } from "../../platform/render/modelFacingHelpers";

const loadModel = async (asset: string): Promise<THREE.Group> => {
  const bytes = readFileSync(resolve("public/assets/models", asset));
  const payload = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  return new Promise((resolveModel, reject) => {
    new GLTFLoader().parse(
      payload,
      "",
      (gltf) => resolveModel(gltf.scene),
      reject,
    );
  });
};

const worldForwardFor = (node: THREE.Object3D): THREE.Vector3 =>
  new THREE.Vector3(0, 0, -1)
    .applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion()))
    .normalize();

const expectVectorCloseTo = (
  actual: THREE.Vector3,
  expected: THREE.Vector3,
): void => {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
  expect(actual.z).toBeCloseTo(expected.z, 6);
};

describe("model combat pose binding", () => {
  it("aims a real GLB local -Z forward at the committed direction through translated and scaled actor roots", async () => {
    const actorRoot = new THREE.Group();
    actorRoot.position.set(3.1, 0.7, -2.4);
    actorRoot.scale.setScalar(1.35);
    const bodyYaw = calibratedYawFor({ x: -0.4, y: 0.9 });
    actorRoot.rotation.y = bodyYaw;
    const poseRoot = new THREE.Group();
    const model = await loadModel("winding-fixed-v1/player_knight.glb");
    actorRoot.add(poseRoot);
    poseRoot.add(model);

    const binding = bindModelPose(model, poseRoot, "player-knight");
    expect(binding).toBeDefined();

    applyModelPose(
      binding,
      {
        actorId: "player",
        sequence: 4,
        direction: { x: 0.6, y: 0.8 },
        style: "slash",
        age: 0,
      },
      bodyYaw,
      10,
    );
    actorRoot.updateWorldMatrix(true, true);
    expectVectorCloseTo(
      worldForwardFor(binding?.aimPivot ?? poseRoot),
      new THREE.Vector3(0.6, 0, -0.8),
    );
    expect(binding?.weaponPivot.rotation.x).toBeCloseTo(0);

    applyModelPose(binding, undefined, bodyYaw, 10);
    expect(binding?.weaponPivot.rotation.x).toBeCloseTo(0);
  });

  it.each([
    ["actor-geometry-v2/player_archer.glb", "player-archer", [0.55, 0.6, 0]],
    ["actor-geometry-v2/enemy_scout.glb", "enemy-scout", [0.34, 0.55, 0]],
    ["actor-geometry-v2/enemy_brute.glb", "enemy-brute", [0.78, 0.58, 0.05]],
  ] as const)(
    "uses the authored repaired grip for %s",
    async (file, asset, grip) => {
      const actorRoot = new THREE.Group();
      actorRoot.position.set(-1.2, 0.5, 4.4);
      actorRoot.scale.setScalar(0.72);
      actorRoot.rotation.y = 0.43;
      const poseRoot = new THREE.Group();
      const model = await loadModel(file);
      actorRoot.add(poseRoot);
      poseRoot.add(model);
      actorRoot.updateWorldMatrix(true, true);
      const expectedGrip = model.localToWorld(new THREE.Vector3(...grip));

      const binding = bindModelPose(model, poseRoot, asset);
      actorRoot.updateWorldMatrix(true, true);
      expectVectorCloseTo(
        binding?.weaponPivot.getWorldPosition(new THREE.Vector3()) ??
          new THREE.Vector3(),
        expectedGrip,
      );
      expect(binding?.neutralParts.length).toBeGreaterThan(1);
    },
  );

  it.each([
    ["winding-fixed-v1/player_knight.glb", "player-knight", "sword"],
    ["winding-fixed-v1/player_wizard.glb", "player-wizard", "staff"],
  ] as const)(
    "measures the primary %s rigid-part vertex bounds for %s",
    async (file, asset, primaryName) => {
      const poseRoot = new THREE.Group();
      const model = await loadModel(file);
      poseRoot.add(model);
      poseRoot.updateWorldMatrix(true, true);
      const primary = model.getObjectByName(primaryName);
      if (primary === undefined)
        throw new Error(`${primaryName} is required in ${file}`);
      const expectedGrip = new THREE.Box3()
        .setFromObject(primary)
        .getCenter(new THREE.Vector3());
      const binding = bindModelPose(model, poseRoot, asset);
      expectVectorCloseTo(
        binding?.weaponPivot.getWorldPosition(new THREE.Vector3()) ??
          new THREE.Vector3(),
        expectedGrip,
      );
    },
  );

  it("gives existing spitter and elite attack cues a bounded body-only response", async () => {
    for (const [file, asset] of [
      ["winding-fixed-v1/enemy_spitter.glb", "enemy-spitter"],
      ["winding-fixed-v1/enemy_elite.glb", "enemy-elite"],
    ] as const) {
      const poseRoot = new THREE.Group();
      poseRoot.add(await loadModel(file));
      const binding = bindModelPose(
        poseRoot.children[0] as THREE.Group,
        poseRoot,
        asset,
      );
      expect(binding?.bodyOnly).toBe(true);
      applyModelPose(
        binding,
        { actorId: asset, sequence: 1, direction: { x: 0, y: 1 }, age: 0.225 },
        0,
        1,
      );
      expect(binding?.poseRoot.rotation.x).not.toBe(0);
    }
  });

  it("gives Knight slash and Mage fireball casts separate wind-up, release, and recovery poses", async () => {
    const knightPoseRoot = new THREE.Group();
    const knightModel = await loadModel("winding-fixed-v1/player_knight.glb");
    knightPoseRoot.add(knightModel);
    const knight = bindModelPose(knightModel, knightPoseRoot, "player-knight");
    const slashCue = {
      actorId: "player",
      sequence: 9,
      direction: { x: 1, y: 0 },
      style: "slash" as const,
    };
    applyModelPose(knight, { ...slashCue, age: 0.06 }, 0, 1);
    const slashWindup = knight?.weaponPivot.rotation.x ?? 0;
    applyModelPose(knight, { ...slashCue, age: 0.3 }, 0, 1.24);
    const slashRelease = knight?.weaponPivot.rotation.x ?? 0;
    applyModelPose(knight, { ...slashCue, age: 0.45 }, 0, 1.45);
    expect(slashWindup).toBeLessThan(0);
    expect(slashRelease).toBeGreaterThan(0);
    expect(knight?.weaponPivot.rotation.x).toBeCloseTo(0);

    const magePoseRoot = new THREE.Group();
    const mageModel = await loadModel("winding-fixed-v1/player_wizard.glb");
    magePoseRoot.add(mageModel);
    const mage = bindModelPose(mageModel, magePoseRoot, "player-wizard");
    const fireballCue = {
      actorId: "player",
      sequence: 10,
      direction: { x: 1, y: 0 },
      style: "magic" as const,
    };
    applyModelPose(mage, { ...fireballCue, age: 0.1 }, 0, 2);
    const castWindup = mage?.weaponPivot.rotation.x ?? 0;
    applyModelPose(mage, { ...fireballCue, age: 0.27 }, 0, 2.17);
    const castRelease = mage?.weaponPivot.rotation.x ?? 0;
    applyModelPose(mage, { ...fireballCue, age: 0.45 }, 0, 2.45);
    expect(castWindup).toBeLessThan(0);
    expect(castRelease).toBeGreaterThan(0);
    expect(mage?.weaponPivot.rotation.x).toBeCloseTo(0);
    expect(mage?.aimPivot.rotation.x).toBeCloseTo(0);
  });

  it("uses retained travel only while moving and restores every rigid part neutrally", async () => {
    const poseRoot = new THREE.Group();
    const model = await loadModel("actor-geometry-v2/player_archer.glb");
    poseRoot.add(model);
    const binding = bindModelPose(model, poseRoot, "player-archer");
    const neutralPositions = binding?.neutralParts.map((part) =>
      part.position.clone(),
    );
    applyModelPose(binding, undefined, 0, 4, { distance: 12, moving: false });
    expect(binding?.poseRoot.position.y).toBe(0);
    applyModelPose(binding, undefined, 0, 400, { distance: 0.4, moving: true });
    expect(binding?.poseRoot.position.y).not.toBe(0);
    applyModelPose(binding, undefined, 0, 401, {
      distance: 0.4,
      moving: false,
    });
    expect(binding?.poseRoot.position.y).toBe(0);
    expect(binding?.neutralParts.map((part) => part.position)).toEqual(
      neutralPositions,
    );
  });
});
