/** Clamp renderer-only phase input without touching simulation state. */
const unit = (value: number): number => Math.min(1, Math.max(0, value));

const smoothstep = (value: number): number => {
  const phase = unit(value);
  return phase * phase * (3 - phase * 2);
};

const ramp = (value: number, from: number, to: number): number =>
  smoothstep((value - from) / (to - from));

export interface KnightSlashAnimation {
  readonly forward: number;
  readonly height: number;
  readonly scale: number;
  readonly turn: number;
}

/** A readable wind-up, sweeping arc, and recovery for the Knight's melee cue. */
export const knightSlashAnimationFor = (
  progress: number,
): KnightSlashAnimation => {
  const phase = unit(progress);
  const windup = ramp(phase, 0, 0.16);
  const sweep = ramp(phase, 0.06, 0.72);
  const recovery = ramp(phase, 0.7, 1);
  return Object.freeze({
    forward: (0.14 + sweep * 0.31) * (1 - recovery * 0.35),
    height: 0.08 + Math.sin(phase * Math.PI) * 0.14,
    scale: (0.76 + sweep * 0.38) * (1 - recovery * 0.28),
    turn: (-windup * 0.92 + sweep * 1.84) * (1 - recovery),
  });
};

export interface MageFireballAnimation {
  readonly height: number;
  readonly scale: number;
  readonly spin: number;
  readonly trailLength: number;
}

/** Simulated-time fireball pulse: identical replays render identically. */
export const mageFireballAnimationFor = (
  progress: number,
  presentationElapsed: number,
): MageFireballAnimation => {
  const phase = unit(progress);
  const pulse = (Math.sin(presentationElapsed * 20 + phase * 5) + 1) * 0.5;
  return Object.freeze({
    height: 0.72 + Math.sin(phase * Math.PI) * 0.11 + pulse * 0.025,
    scale: 0.9 + pulse * 0.22,
    spin: presentationElapsed * 8,
    trailLength: 1.45 + pulse * 0.85 + phase * 0.3,
  });
};

export const mageExplosionDurationSeconds = 0.42;

export interface MageExplosionAnimation {
  readonly complete: boolean;
  readonly coreScale: number;
  readonly emberDistance: number;
  readonly emberHeight: number;
  readonly ringScale: number;
}

/** Short fireball-impact burst with an expanding ring and deterministic embers. */
export const mageExplosionAnimationFor = (
  age: number,
): MageExplosionAnimation => {
  const phase = unit(age / mageExplosionDurationSeconds);
  const expansion = smoothstep(phase);
  return Object.freeze({
    complete: age >= mageExplosionDurationSeconds,
    coreScale: Math.max(0.12, 1.25 - phase * 0.93),
    emberDistance: 0.14 + expansion * 0.92,
    emberHeight: 0.08 + Math.sin(phase * Math.PI) * 0.3,
    ringScale: 0.45 + expansion * 2.15,
  });
};
