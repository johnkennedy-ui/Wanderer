import type { Vector2 } from "../../domain/types";

export const wrapYaw = (yaw: number): number =>
  Math.atan2(Math.sin(yaw), Math.cos(yaw));

/** Domain (x,y) projects to Three world (x,0,-y). */
export const worldHeadingFor = (direction: Vector2): number =>
  Math.atan2(direction.x, -direction.y);

export const calibratedYawFor = (
  direction: Vector2,
  localForward: Vector2 = { x: 0, y: -1 },
): number =>
  wrapYaw(
    worldHeadingFor(direction) - Math.atan2(localForward.x, localForward.y),
  );

export const shortestYawTowards = (
  current: number,
  target: number,
  deltaSeconds: number,
  rate = 16,
): number =>
  current +
  wrapYaw(target - current) * (1 - Math.exp(-rate * Math.max(0, deltaSeconds)));

export const transformedForwardForYaw = (yaw: number): Vector2 => ({
  x: -Math.sin(yaw),
  y: -Math.cos(yaw),
});
