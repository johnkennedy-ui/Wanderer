import { describe, expect, it } from "vitest";
import {
  knightSlashAnimationFor,
  mageExplosionAnimationFor,
  mageExplosionDurationSeconds,
  mageFireballAnimationFor,
} from "../../platform/render/combatAnimationHelpers";

describe("class combat animation timing", () => {
  it("gives the Knight a wind-up, a forward slash, and a neutral recovery", () => {
    const start = knightSlashAnimationFor(0);
    const windup = knightSlashAnimationFor(0.12);
    const followThrough = knightSlashAnimationFor(0.72);
    const recovery = knightSlashAnimationFor(1);

    expect(start.turn).toBe(0);
    expect(windup.turn).toBeLessThan(0);
    expect(followThrough.turn).toBeGreaterThan(0);
    expect(followThrough.forward).toBeGreaterThan(windup.forward);
    expect(Math.abs(recovery.turn)).toBeLessThan(0.0001);
  });

  it("keeps the Mage fireball visibly pulsing and lifted during flight", () => {
    const early = mageFireballAnimationFor(0.15, 2.1);
    const later = mageFireballAnimationFor(0.8, 2.2);

    expect(early.height).toBeGreaterThan(0.72);
    expect(later.height).toBeGreaterThan(0.72);
    expect(early.scale).toBeGreaterThan(0.89);
    expect(later.trailLength).toBeGreaterThan(early.trailLength);
    expect(later.spin).toBeGreaterThan(early.spin);
  });

  it("expands the Mage impact burst before retiring it", () => {
    const first = mageExplosionAnimationFor(0);
    const middle = mageExplosionAnimationFor(mageExplosionDurationSeconds / 2);
    const complete = mageExplosionAnimationFor(mageExplosionDurationSeconds);

    expect(first.complete).toBe(false);
    expect(middle.ringScale).toBeGreaterThan(first.ringScale);
    expect(middle.emberDistance).toBeGreaterThan(first.emberDistance);
    expect(middle.coreScale).toBeLessThan(first.coreScale);
    expect(complete.complete).toBe(true);
  });
});
