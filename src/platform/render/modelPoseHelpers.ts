import * as THREE from "three";
import type { AttackPresentationCue } from "../../domain/notices";
import { wrapYaw } from "./modelFacingHelpers";

interface NeutralPartTransform {
  readonly part: THREE.Object3D;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly scale: THREE.Vector3;
}

export interface BoundModelPose {
  readonly poseRoot: THREE.Group;
  readonly weaponPivot: THREE.Group;
  readonly aimPivot: THREE.Group;
  readonly neutralParts: readonly NeutralPartTransform[];
}

const partNamesFor = (asset: string): readonly string[] =>
  asset === "player-knight"
    ? ["sword"]
    : asset === "player-wizard"
      ? ["staff", "staff_crystal", "crystal"]
      : asset === "player-archer"
        ? ["bow"]
        : asset === "enemy-scout"
          ? ["spear", "spear_tip"]
          : asset === "enemy-brute"
            ? ["club", "club_head"]
            : asset === "enemy-boss"
              ? ["head", "wing_-1", "wing_1", "tail", "crystal"]
              : [];

const namedParts = (model: THREE.Group, names: readonly string[]) => {
  const parts: THREE.Object3D[] = [];
  model.traverse((node) => {
    if (names.some((name) => node.name === name || node.name.startsWith(`${name}_`)))
      parts.push(node);
  });
  return parts;
};

/**
 * Binds authored rigid pieces once after a clone loads. Mesh nodes commonly
 * have zero node offsets, so the pivot is measured from their vertex bounds.
 */
export const bindModelPose = (
  model: THREE.Group,
  poseRoot: THREE.Group,
  asset: string,
): BoundModelPose | undefined => {
  const parts = namedParts(model, partNamesFor(asset));
  if (parts.length === 0) return undefined;
  model.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3();
  for (const part of parts) bounds.expandByObject(part);
  if (bounds.isEmpty()) return undefined;
  const grip = bounds.getCenter(new THREE.Vector3());
  poseRoot.worldToLocal(grip);
  const weaponPivot = new THREE.Group();
  weaponPivot.name = "weaponPivot";
  weaponPivot.position.copy(grip);
  const aimPivot = new THREE.Group();
  aimPivot.name = "aimPivot";
  weaponPivot.add(aimPivot);
  poseRoot.add(weaponPivot);
  poseRoot.updateWorldMatrix(true, true);
  for (const part of parts) aimPivot.attach(part);
  const neutralParts = parts.map((part) => ({
    part,
    position: part.position.clone(),
    quaternion: part.quaternion.clone(),
    scale: part.scale.clone(),
  }));
  return { poseRoot, weaponPivot, aimPivot, neutralParts };
};

const restoreNeutral = (binding: BoundModelPose): void => {
  binding.poseRoot.position.y = 0;
  binding.poseRoot.rotation.set(0, 0, 0);
  binding.weaponPivot.rotation.set(0, 0, 0);
  binding.aimPivot.rotation.set(0, 0, 0);
  for (const neutral of binding.neutralParts) {
    neutral.part.position.copy(neutral.position);
    neutral.part.quaternion.copy(neutral.quaternion);
    neutral.part.scale.copy(neutral.scale);
  }
};

/** Applies an absolute release/recovery pose; no frame-to-frame accumulation. */
export const applyModelPose = (
  binding: BoundModelPose | undefined,
  cue: AttackPresentationCue | undefined,
  bodyYaw: number,
  presentationElapsed: number,
): void => {
  if (binding === undefined) return;
  restoreNeutral(binding);
  binding.poseRoot.position.y = Math.sin(presentationElapsed * 7) * 0.025;
  if (cue === undefined || cue.age < 0 || cue.age > 0.45) return;
  const release = Math.min(1, cue.age / 0.45);
  const recoil = Math.sin(release * Math.PI);
  const aimYaw = Math.atan2(cue.direction.x, -cue.direction.y);
  binding.aimPivot.rotation.y = wrapYaw(aimYaw - bodyYaw);
  binding.weaponPivot.rotation.x =
    cue.style === "slash" ? -recoil * 1.1 : recoil * 0.28;
  binding.weaponPivot.rotation.z =
    cue.style === "arrow" ? recoil * 0.18 : cue.style === "magic" ? -recoil * 0.12 : 0;
};
