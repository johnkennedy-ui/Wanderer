import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  calibratedYawFor,
  shortestYawTowards,
  transformedForwardForYaw,
} from "../../platform/render/modelFacingHelpers";

describe("calibrated continuous model facing", () => {
  it("transforms local -Z to every integer and fractional domain heading", () => {
    for (let degrees = 0; degrees < 360; degrees += 1) {
      const radians = (degrees * Math.PI) / 180;
      const direction = { x: Math.sin(radians), y: Math.cos(radians) };
      const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        calibratedYawFor(direction),
      );
      expect(forward.x).toBeCloseTo(direction.x, 10);
      expect(forward.z).toBeCloseTo(-direction.y, 10);
    }
    const fractional = { x: Math.sin(0.123), y: Math.cos(0.123) };
    expect(
      transformedForwardForYaw(calibratedYawFor(fractional)).x,
    ).toBeCloseTo(fractional.x, 10);
  });

  it("takes the shortest turn across zero and retains zero-motion facing", () => {
    expect(
      Math.sin(shortestYawTowards((359 * Math.PI) / 180, 0, 1)),
    ).toBeCloseTo(0, 5);
    expect(
      Math.sin(
        shortestYawTowards((179 * Math.PI) / 180, (-179 * Math.PI) / 180, 1),
      ),
    ).toBeCloseTo(Math.sin((-179 * Math.PI) / 180), 5);
    expect(shortestYawTowards(0.7, 0.7, 1)).toBeCloseTo(0.7);
  });

  it("calibrates alternate authored forward axes", () => {
    expect(calibratedYawFor({ x: 0, y: 1 })).toBeCloseTo(0);
    expect(calibratedYawFor({ x: 1, y: 0 })).toBeCloseTo(-Math.PI / 2);
    expect(calibratedYawFor({ x: 0, y: 1 }, { x: 0, y: 1 })).toBeCloseTo(
      Math.PI,
    );
  });
});
