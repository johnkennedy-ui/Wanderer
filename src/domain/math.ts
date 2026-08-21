import type { Vector2 } from "./types";

export const distanceSquared = (left: Vector2, right: Vector2): number => {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
};

export const distance = (left: Vector2, right: Vector2): number =>
  Math.sqrt(distanceSquared(left, right));

export const magnitude = (value: Vector2): number =>
  Math.sqrt(value.x * value.x + value.y * value.y);

export const normalize = (value: Vector2): Vector2 => {
  const length = magnitude(value);
  return length === 0
    ? { x: 0, y: 0 }
    : { x: value.x / length, y: value.y / length };
};

export const add = (left: Vector2, right: Vector2): Vector2 => ({
  x: left.x + right.x,
  y: left.y + right.y,
});

export const scale = (value: Vector2, amount: number): Vector2 => ({
  x: value.x * amount,
  y: value.y * amount,
});

export const roundVector = (value: Vector2): Vector2 => ({
  x: Math.round(value.x * 100) / 100,
  y: Math.round(value.y * 100) / 100,
});
