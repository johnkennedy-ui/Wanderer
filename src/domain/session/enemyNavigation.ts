import { distanceSquared, magnitude } from "../math";
import type { Vector2 } from "../types";
import { findGridPath } from "./gridPathfinding";

export interface EnemyNavigationInput {
  readonly from: Vector2;
  readonly desired: Vector2;
  readonly target: Vector2;
  readonly enemyId: string;
  /** Existing collision resolver and its point-clearance twin are authoritative. */
  readonly constrain: (from: Vector2, desired: Vector2) => Vector2;
  readonly isClear: (position: Vector2) => boolean;
  /** Supplied only for a finite, completely enumerated navigation component. */
  readonly bounds?: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
  };
}

interface PlannedRoute {
  readonly target: Vector2;
  readonly waypoints: Vector2[];
}
interface FailedRoute {
  readonly from: Vector2;
  readonly target: Vector2;
  retriesIn: number;
}
const ROUTE_EPSILON = 0.001;
const ROUTE_EPSILON_SQUARED = ROUTE_EPSILON * ROUTE_EPSILON;
const WAYPOINT_EPSILON = 0.02;
const REPLAN_DISTANCE = 0.5;
const MAX_CACHED_ROUTES = 128;
const GRID_CELL_SIZE = 0.5;
const MAX_EXPANDED_NODES = 4096;

const closeEnough = (
  left: Vector2,
  right: Vector2,
  epsilon = WAYPOINT_EPSILON,
): boolean => distanceSquared(left, right) <= epsilon * epsilon;

const stepToward = (
  input: EnemyNavigationInput,
  waypoint: Vector2,
  attemptedDistance: number,
): Vector2 => {
  const dx = waypoint.x - input.from.x;
  const dy = waypoint.y - input.from.y;
  const length = Math.hypot(dx, dy);
  if (length <= WAYPOINT_EPSILON) return input.from;
  const margin = Math.min(0.008, attemptedDistance * 0.1);
  const step = Math.min(Math.max(0, attemptedDistance - margin), length);
  return input.constrain(input.from, {
    x: input.from.x + (dx / length) * step,
    y: input.from.y + (dy / length) * step,
  });
};

/** Session-owned A* routes; every grid edge is checked by the authoritative movement sweep. */
export class EnemyNavigationCache {
  private readonly routes = new Map<string, PlannedRoute>();
  private readonly failedRoutes = new Map<string, FailedRoute>();

  clear(): void {
    this.routes.clear();
    this.failedRoutes.clear();
  }

  route(input: EnemyNavigationInput): Vector2 {
    const attemptedDistance = magnitude({
      x: input.desired.x - input.from.x,
      y: input.desired.y - input.from.y,
    });
    if (attemptedDistance === 0) return input.from;

    const failed = this.failedRoutes.get(input.enemyId);
    if (failed !== undefined) {
      if (
        closeEnough(failed.from, input.from, REPLAN_DISTANCE) &&
        closeEnough(failed.target, input.target, REPLAN_DISTANCE)
      ) {
        if (failed.retriesIn > 0) {
          failed.retriesIn -= 1;
          return input.from;
        }
      }
      this.failedRoutes.delete(input.enemyId);
    }

    const cached = this.routes.get(input.enemyId);
    if (cached !== undefined) {
      if (!closeEnough(cached.target, input.target, REPLAN_DISTANCE))
        this.routes.delete(input.enemyId);
      else {
        while (
          cached.waypoints.length > 0 &&
          closeEnough(input.from, cached.waypoints[0])
        )
          cached.waypoints.shift();
        const waypoint = cached.waypoints[0];
        if (waypoint !== undefined) {
          const next = stepToward(input, waypoint, attemptedDistance);
          if (distanceSquared(input.from, next) > ROUTE_EPSILON_SQUARED)
            return next;
        }
        this.routes.delete(input.enemyId);
      }
    }

    const direct = input.constrain(input.from, input.desired);
    if (closeEnough(direct, input.desired, ROUTE_EPSILON)) return direct;

    const result = findGridPath({
      from: input.from,
      target: input.target,
      cellSize: GRID_CELL_SIZE,
      maxExpandedNodes: MAX_EXPANDED_NODES,
      ...(input.bounds === undefined ? {} : { bounds: input.bounds }),
      isClear: input.isClear,
      canTraverse: (from, to) =>
        closeEnough(input.constrain(from, to), to, ROUTE_EPSILON),
    });
    if (result.status !== "found") {
      if (this.failedRoutes.size >= MAX_CACHED_ROUTES)
        this.failedRoutes.delete(this.failedRoutes.keys().next().value!);
      this.failedRoutes.set(input.enemyId, {
        from: input.from,
        target: input.target,
        retriesIn: 15,
      });
      return direct;
    }

    if (this.routes.size >= MAX_CACHED_ROUTES)
      this.routes.delete(this.routes.keys().next().value!);
    const route = { target: input.target, waypoints: [...result.waypoints] };
    this.routes.set(input.enemyId, route);
    const waypoint = route.waypoints[0];
    if (waypoint === undefined || closeEnough(input.from, waypoint))
      return direct;
    return stepToward(input, waypoint, attemptedDistance);
  }
}

/** Stateless entry point retained for focused callers and tests. */
export const routeEnemyPosition = (input: EnemyNavigationInput): Vector2 =>
  new EnemyNavigationCache().route(input);
