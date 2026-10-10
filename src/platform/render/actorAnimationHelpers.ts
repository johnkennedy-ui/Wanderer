import * as THREE from "three";
import type { AttackPresentationCue } from "../../domain/notices";

export interface BoundActorAnimation {
  readonly mixer: THREE.AnimationMixer;
  readonly actions: ReadonlyMap<string, THREE.AnimationAction>;
  activeClip: string | undefined;
}

const animatedAsset = (asset: string): boolean =>
  asset.startsWith("player-") ||
  asset.startsWith("enemy-") ||
  asset.startsWith("tower-") ||
  asset === "building-ArcherTower" ||
  asset === "building-SwordTower" ||
  asset === "building-MageTower";

/** Binds actor and tower clips, leaving static props and projectiles alone. */
export const bindActorAnimation = (
  model: THREE.Group,
  asset: string,
  clips: readonly THREE.AnimationClip[],
): BoundActorAnimation | undefined => {
  if (!animatedAsset(asset) || clips.length === 0) return undefined;
  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of clips)
    if (
      clip.name === "idle" ||
      clip.name === "move" ||
      clip.name === "run" ||
      clip.name === "attack"
    )
      actions.set(clip.name, mixer.clipAction(clip));
  return actions.size === 0
    ? undefined
    : { mixer, actions, activeClip: undefined };
};

const clipNameFor = (
  animation: BoundActorAnimation,
  cue: AttackPresentationCue | undefined,
  moving: boolean,
): string | undefined => {
  const available = (name: string) => animation.actions.has(name);
  if (moving)
    return available("run") ? "run" : available("move") ? "move" : undefined;
  if (
    cue !== undefined &&
    cue.age >= 0 &&
    cue.age <= (cue.durationSeconds ?? 0.45) &&
    available("attack")
  )
    return "attack";
  return available("idle") ? "idle" : undefined;
};

/**
 * Advances from game presentation time, not wall time, so pause/reset behavior
 * remains owned by the session snapshot. Returns false for the procedural
 * compatibility fallback when an actor has no usable clip.
 */
export const applyActorAnimation = (
  animation: BoundActorAnimation | undefined,
  cue: AttackPresentationCue | undefined,
  moving: boolean,
  presentationElapsed: number,
  reset: boolean,
): boolean => {
  if (animation === undefined) return false;
  const clipName = clipNameFor(animation, cue, moving);
  if (clipName === undefined) return false;
  const action = animation.actions.get(clipName);
  if (action === undefined) return false;
  if (animation.activeClip !== clipName) {
    animation.mixer.stopAllAction();
    action.reset();
    action.enabled = true;
    action.clampWhenFinished = clipName === "attack";
    action.setLoop(
      clipName === "attack" ? THREE.LoopOnce : THREE.LoopRepeat,
      clipName === "attack" ? 1 : Infinity,
    );
    action.play();
    animation.activeClip = clipName;
  }
  const time = reset
    ? 0
    : clipName === "attack"
      ? Math.max(0, cue?.age ?? 0)
      : presentationElapsed;
  animation.mixer.setTime(time);
  return true;
};

export const disposeActorAnimation = (
  animation: BoundActorAnimation | undefined,
  model: THREE.Group | undefined,
): void => {
  if (animation === undefined || model === undefined) return;
  animation.mixer.stopAllAction();
  animation.mixer.uncacheRoot(model);
};
