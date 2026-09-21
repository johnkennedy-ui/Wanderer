import * as THREE from "three";
import type { AttackPresentationCue } from "../../domain/notices";
import { knightSlashAnimationFor } from "./combatAnimationHelpers";
import { calibratedYawFor, wrapYaw } from "./modelFacingHelpers";

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
  /** Some existing enemy meshes have no detachable rigid weapon parts. */
  readonly bodyOnly: boolean;
}

export interface ModelLocomotion {
  /** Renderer-retained world travel, reset with the presentation epoch. */
  readonly distance: number;
  /** False for idle and paused frames; elapsed time alone never drives a bob. */
  readonly moving: boolean;
}

const authoredGripByAsset: Readonly<
  Record<string, readonly [number, number, number]>
> = Object.freeze({
  "player-archer": Object.freeze([0.55, 0.6, 0] as const),
  "enemy-scout": Object.freeze([0.34, 0.55, 0] as const),
  "enemy-brute": Object.freeze([0.78, 0.58, 0.05] as const),
});

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
    if (
      names.some(
        (name) => node.name === name || node.name.startsWith(`${name}_`),
      )
    )
      parts.push(node);
  });
  return parts.filter(
    (part) =>
      !parts.some(
        (ancestor) => ancestor !== part && ancestor.children.includes(part),
      ),
  );
};

const primaryRigidPartFor = (
  asset: string,
  parts: readonly THREE.Object3D[],
): THREE.Object3D | undefined => {
  const name =
    asset === "player-knight"
      ? "sword"
      : asset === "player-wizard"
        ? "staff"
        : undefined;
  return name === undefined
    ? undefined
    : parts.find((part) => part.name === name);
};

const gripWorldPositionFor = (
  model: THREE.Group,
  asset: string,
  parts: readonly THREE.Object3D[],
): THREE.Vector3 | undefined => {
  const authoredGrip = authoredGripByAsset[asset];
  if (authoredGrip !== undefined)
    return model.localToWorld(new THREE.Vector3(...authoredGrip));
  const primaryPart = primaryRigidPartFor(asset, parts);
  const measuredPart = primaryPart ?? parts[0];
  if (measuredPart === undefined) return undefined;
  const bounds = new THREE.Box3().setFromObject(measuredPart);
  return bounds.isEmpty() ? undefined : bounds.getCenter(new THREE.Vector3());
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
  const bodyOnly = asset === "enemy-spitter" || asset === "enemy-elite";
  if (parts.length === 0 && !bodyOnly) return undefined;
  model.updateWorldMatrix(true, true);
  const weaponPivot = new THREE.Group();
  weaponPivot.name = "weaponPivot";
  const grip = gripWorldPositionFor(model, asset, parts);
  if (grip !== undefined)
    weaponPivot.position.copy(poseRoot.worldToLocal(grip));
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
  return { poseRoot, weaponPivot, aimPivot, neutralParts, bodyOnly };
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
  locomotion?: ModelLocomotion,
): void => {
  if (binding === undefined) return;
  restoreNeutral(binding);
  if (locomotion?.moving === true)
    binding.poseRoot.position.y = Math.sin(locomotion.distance * 14) * 0.025;
  if (cue === undefined || cue.age < 0 || cue.age > 0.45) return;
  const release = Math.min(1, cue.age / 0.45);
  const recoil = Math.sin(release * Math.PI);
  const aimYaw = calibratedYawFor(cue.direction);
  binding.aimPivot.rotation.y = wrapYaw(aimYaw - bodyYaw);
  if (binding.bodyOnly) {
    binding.poseRoot.rotation.x = -recoil * 0.08;
    return;
  }
  if (cue.style === "slash") {
    const slash = knightSlashAnimationFor(release);
    binding.poseRoot.rotation.z = slash.turn * 0.1;
    binding.weaponPivot.rotation.x = slash.turn * 1.28;
    binding.weaponPivot.rotation.z = -slash.turn * 0.34;
    return;
  }
  if (cue.style === "magic") {
    const charge = Math.sin(release * Math.PI);
    const releasePush = Math.sin(Math.max(0, release - 0.2) * Math.PI * 1.25);
    binding.poseRoot.rotation.x = -charge * 0.055;
    binding.weaponPivot.rotation.x = -charge * 0.24 + releasePush * 0.48;
    binding.weaponPivot.rotation.z = -charge * 0.3;
    binding.aimPivot.rotation.x = -charge * 0.1;
    return;
  }
  binding.weaponPivot.rotation.x = recoil * 0.28;
  binding.weaponPivot.rotation.z = cue.style === "arrow" ? recoil * 0.18 : 0;
};
