import { distanceSquared, magnitude, normalize } from "../math";
import type { Vector2 } from "../types";

export interface EnemyNavigationInput {
  readonly from: Vector2;
  readonly desired: Vector2;
  readonly target: Vector2;
  readonly enemyId: string;
  /** The existing terrain resolver is the sole collision authority. */
  readonly constrain: (from: Vector2, desired: Vector2) => Vector2;
}

interface PlannedRoute {
  readonly target: Vector2;
  readonly waypoints: Vector2[];
}

interface FailedRoute {
  readonly from: Vector2;
  readonly target: Vector2;
}

interface SearchNode {
  readonly position: Vector2;
  readonly waypoints: readonly Vector2[];
}

const ROUTE_EPSILON_SQUARED = 0.000001;
const WAYPOINT_EPSILON = 0.02;
const MAX_CACHED_ROUTES = 128;
const MAX_SEARCH_DEPTH = 8;
const MAX_SEARCH_NODES_PER_DEPTH = 4;
/** Includes the initial direct collision sweep made before planning. */
const MAX_SEARCH_SWEEPS = 159;
const SEARCH_EDGE_DISTANCE = 1;
const ROUNDED_STEP_MARGIN = 0.008;
const REPLAN_DISTANCE = 0.5;
const SEARCH_ANGLES = Object.freeze([
  0,
  Math.PI / 4,
  -Math.PI / 4,
  Math.PI / 2,
  -Math.PI / 2,
  (3 * Math.PI) / 4,
  (-3 * Math.PI) / 4,
  Math.PI,
] as const);

const closeEnough = (
  left: Vector2,
  right: Vector2,
  epsilon = WAYPOINT_EPSILON,
) => distanceSquared(left, right) <= epsilon * epsilon;

const routeScore = (position: Vector2, target: Vector2, depth: number) =>
  distanceSquared(position, target) + depth * 0.01;

/**
 * Session-owned, finite enemy routes. Planning only occurs after a blocked
 * direct sweep; every generated edge is accepted only when the existing sweep
 * reaches its endpoint. The retained path prevents rounded frame movement
 * from reselecting alternating tangents.
 */
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
      )
        return input.from;
      this.failedRoutes.delete(input.enemyId);
    }

    const cached = this.routes.get(input.enemyId);
    if (cached !== undefined) {
      if (!closeEnough(cached.target, input.target, 0.5))
        this.routes.delete(input.enemyId);
      else {
        while (
          cached.waypoints.length > 0 &&
          closeEnough(input.from, cached.waypoints[0])
        )
          cached.waypoints.shift();
        const waypoint = cached.waypoints[0];
        if (waypoint !== undefined) {
          const delta = {
            x: waypoint.x - input.from.x,
            y: waypoint.y - input.from.y,
          };
          const length = magnitude(delta);
          if (length <= WAYPOINT_EPSILON) {
            cached.waypoints.shift();
            return this.route(input);
          }
          const step = Math.min(
            Math.max(0, attemptedDistance - ROUNDED_STEP_MARGIN),
            length,
          );
          const next = input.constrain(input.from, {
            x: input.from.x + (delta.x / length) * step,
            y: input.from.y + (delta.y / length) * step,
          });
          if (distanceSquared(input.from, next) > ROUTE_EPSILON_SQUARED)
            return next;
        }
        this.routes.delete(input.enemyId);
      }
    }

    const direct = input.constrain(input.from, input.desired);
    if (
      magnitude({ x: direct.x - input.from.x, y: direct.y - input.from.y }) >=
      attemptedDistance - WAYPOINT_EPSILON
    )
      return direct;

    const route = this.plan(input, attemptedDistance);
    if (route === null) {
      if (this.failedRoutes.size >= MAX_CACHED_ROUTES)
        this.failedRoutes.delete(this.failedRoutes.keys().next().value!);
      this.failedRoutes.set(input.enemyId, {
        from: input.from,
        target: input.target,
      });
      return direct;
    }
    if (this.routes.size >= MAX_CACHED_ROUTES)
      this.routes.delete(this.routes.keys().next().value!);
    this.routes.set(input.enemyId, route);
    const waypoint = route.waypoints[0];
    if (waypoint === undefined) return direct;
    const delta = {
      x: waypoint.x - input.from.x,
      y: waypoint.y - input.from.y,
    };
    const length = magnitude(delta);
    if (length <= WAYPOINT_EPSILON) return direct;
    return input.constrain(input.from, {
      x:
        input.from.x +
        (delta.x / length) *
          Math.min(
            Math.max(0, attemptedDistance - ROUNDED_STEP_MARGIN),
            length,
          ),
      y:
        input.from.y +
        (delta.y / length) *
          Math.min(
            Math.max(0, attemptedDistance - ROUNDED_STEP_MARGIN),
            length,
          ),
    });
  }

  private plan(
    input: EnemyNavigationInput,
    attemptedDistance: number,
  ): PlannedRoute | null {
    let sweeps = 0;
    let frontier: readonly SearchNode[] = [
      { position: input.from, waypoints: [] },
    ];
    let best: SearchNode | null = null;
    for (
      let depth = 0;
      depth < MAX_SEARCH_DEPTH && sweeps < MAX_SEARCH_SWEEPS;
      depth += 1
    ) {
      const candidates: SearchNode[] = [];
      for (const node of frontier) {
        const direction = normalize({
          x: input.target.x - node.position.x,
          y: input.target.y - node.position.y,
        });
        if (direction.x === 0 && direction.y === 0)
          return { target: input.target, waypoints: [...node.waypoints] };
        for (const angle of SEARCH_ANGLES) {
          if (sweeps >= MAX_SEARCH_SWEEPS) break;
          const cosine = Math.cos(angle);
          const sine = Math.sin(angle);
          const rotated = {
            x: direction.x * cosine - direction.y * sine,
            y: direction.x * sine + direction.y * cosine,
          };
          const endpoint = {
            x:
              node.position.x +
              rotated.x *
                Math.min(4, Math.max(SEARCH_EDGE_DISTANCE, attemptedDistance)),
            y:
              node.position.y +
              rotated.y *
                Math.min(4, Math.max(SEARCH_EDGE_DISTANCE, attemptedDistance)),
          };
          const reached = input.constrain(node.position, endpoint);
          sweeps += 1;
          if (!closeEnough(reached, endpoint)) continue;
          const waypoints = [...node.waypoints, endpoint];
          const candidate = { position: endpoint, waypoints };
          if (
            best === null ||
            routeScore(candidate.position, input.target, depth) <
              routeScore(best.position, input.target, depth)
          )
            best = candidate;
          if (
            magnitude({
              x: input.target.x - endpoint.x,
              y: input.target.y - endpoint.y,
            }) <= 4
          ) {
            if (sweeps >= MAX_SEARCH_SWEEPS) continue;
            const toTarget = input.constrain(endpoint, input.target);
            sweeps += 1;
            if (closeEnough(toTarget, input.target))
              return {
                target: input.target,
                waypoints: [...waypoints, input.target],
              };
          }
          candidates.push(candidate);
        }
      }
      frontier = candidates
        .sort(
          (left, right) =>
            routeScore(left.position, input.target, depth) -
            routeScore(right.position, input.target, depth),
        )
        .slice(0, MAX_SEARCH_NODES_PER_DEPTH);
      if (frontier.length === 0) break;
    }
    return best === null
      ? null
      : { target: input.target, waypoints: [...best.waypoints] };
  }
}

/** Stateless compatibility entry point for focused callers. */
export const routeEnemyPosition = (input: EnemyNavigationInput): Vector2 =>
  new EnemyNavigationCache().route(input);
