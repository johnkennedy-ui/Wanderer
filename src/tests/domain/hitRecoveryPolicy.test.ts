import { describe, expect, it } from "vitest";
import {
  playerHitRecoveryEndsAtFor,
  playerHitRecoveryPresentationFor,
  playerMoveDistanceWithHitRecoveryFor,
} from "../../domain/session/hitRecoveryPolicy";

describe("player hit recovery policy", () => {
  it("starts flashing immediately, alternates during recovery, and expires at 0.5 seconds", () => {
    const recoveryEndsAt = playerHitRecoveryEndsAtFor({
      elapsed: 10,
      recoverySeconds: 0.5,
    });
    expect(recoveryEndsAt).toBe(10.5);
    expect(
      playerHitRecoveryPresentationFor({
        elapsed: 10,
        recoveryEndsAt,
        recoverySeconds: 0.5,
        flashIntervalSeconds: 0.1,
      }),
    ).toEqual({ active: true, flashOn: true });
    expect(
      playerHitRecoveryPresentationFor({
        elapsed: 10.1,
        recoveryEndsAt,
        recoverySeconds: 0.5,
        flashIntervalSeconds: 0.1,
      }),
    ).toEqual({ active: true, flashOn: false });
    expect(
      playerHitRecoveryPresentationFor({
        elapsed: 10.2,
        recoveryEndsAt,
        recoverySeconds: 0.5,
        flashIntervalSeconds: 0.1,
      }),
    ).toEqual({ active: true, flashOn: true });
    expect(
      playerHitRecoveryPresentationFor({
        elapsed: 10.5,
        recoveryEndsAt,
        recoverySeconds: 0.5,
        flashIntervalSeconds: 0.1,
      }),
    ).toEqual({ active: false, flashOn: false });
  });

  it("applies the 2x multiplier only to the recovery-covered part of a frame", () => {
    expect(
      playerMoveDistanceWithHitRecoveryFor({
        baseMoveSpeed: 3,
        frameStartElapsed: 10,
        delta: 0.1,
        recoveryEndsAt: 10.5,
        recoverySeconds: 0.5,
        speedMultiplier: 2,
      }),
    ).toBeCloseTo(0.6, 8);
    expect(
      playerMoveDistanceWithHitRecoveryFor({
        baseMoveSpeed: 3,
        frameStartElapsed: 10.45,
        delta: 0.1,
        recoveryEndsAt: 10.5,
        recoverySeconds: 0.5,
        speedMultiplier: 2,
      }),
    ).toBeCloseTo(0.45, 8);
    expect(
      playerMoveDistanceWithHitRecoveryFor({
        baseMoveSpeed: 3,
        frameStartElapsed: 10.5,
        delta: 0.1,
        recoveryEndsAt: 10.5,
        recoverySeconds: 0.5,
        speedMultiplier: 2,
      }),
    ).toBeCloseTo(0.3, 8);
  });
});
