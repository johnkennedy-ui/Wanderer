import type { Vector2 } from "../types";
import { distanceSquared } from "../math";

/** A* is optimal in the configured grid, not necessarily continuous free space. */
export interface GridPathfindingInput {
  readonly from: Vector2;
  readonly target: Vector2;
  readonly cellSize: number;
  readonly maxExpandedNodes: number;
  /** Inclusive integer grid bounds. Only bounded exhaustion proves no route. */
  readonly bounds?: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
  };
  readonly isClear: (point: Vector2) => boolean;
  readonly canTraverse: (from: Vector2, to: Vector2) => boolean;
}

export type GridPathfindingResult =
  | {
      readonly status: "found";
      readonly waypoints: readonly Vector2[];
      readonly cost: number;
      readonly expandedNodes: number;
    }
  | {
      readonly status: "unreachable" | "incomplete";
      readonly expandedNodes: number;
    };

interface Entry {
  readonly x: number;
  readonly y: number;
  readonly g: number;
  readonly f: number;
  readonly order: number;
}
const DIRECTIONS = Object.freeze([
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
] as const);
const CONNECTOR_RADIUS = 1.5;
const key = (x: number, y: number): string => x + "," + y;
const point = (x: number, y: number, size: number): Vector2 => ({
  x: x * size,
  y: y * size,
});
const distance = (a: Vector2, b: Vector2): number =>
  Math.hypot(a.x - b.x, a.y - b.y);
const inBounds = (
  x: number,
  y: number,
  b: GridPathfindingInput["bounds"],
): boolean =>
  b === undefined || (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY);
const validBounds = (b: GridPathfindingInput["bounds"]): boolean =>
  b === undefined ||
  ([b.minX, b.maxX, b.minY, b.maxY].every(Number.isInteger) &&
    b.minX <= b.maxX &&
    b.minY <= b.maxY);

class MinHeap {
  private values: Entry[] = [];
  get size(): number {
    return this.values.length;
  }
  push(entry: Entry): void {
    this.values.push(entry);
    let i = this.values.length - 1;
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (!this.less(this.values[i], this.values[p])) break;
      [this.values[i], this.values[p]] = [this.values[p], this.values[i]];
      i = p;
    }
  }
  pop(): Entry | undefined {
    const result = this.values[0];
    const tail = this.values.pop();
    if (tail !== undefined && this.values.length > 0) {
      this.values[0] = tail;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1,
          r = l + 1;
        let m = i;
        if (l < this.values.length && this.less(this.values[l], this.values[m]))
          m = l;
        if (r < this.values.length && this.less(this.values[r], this.values[m]))
          m = r;
        if (m === i) break;
        [this.values[i], this.values[m]] = [this.values[m], this.values[i]];
        i = m;
      }
    }
    return result;
  }
  private less(a: Entry, b: Entry): boolean {
    if (a.f !== b.f) return a.f < b.f;
    if (a.g !== b.g) return a.g < b.g;
    if (a.x !== b.x) return a.x < b.x;
    if (a.y !== b.y) return a.y < b.y;
    return a.order < b.order;
  }
}

/**
 * Deterministic 8-connected A*: Euclidean edges and heuristic are admissible.
 * A capped or unbounded miss reports incomplete, never a false unreachable claim.
 */
export const findGridPath = (
  input: GridPathfindingInput,
): GridPathfindingResult => {
  const { from, target, cellSize, maxExpandedNodes, bounds } = input;
  if (
    ![from.x, from.y, target.x, target.y, cellSize].every(Number.isFinite) ||
    cellSize <= 0 ||
    !Number.isInteger(maxExpandedNodes) ||
    maxExpandedNodes < 1 ||
    !validBounds(bounds)
  )
    return { status: "incomplete", expandedNodes: 0 };
  if (
    bounds !== undefined &&
    (target.x / cellSize < bounds.minX - CONNECTOR_RADIUS ||
      target.x / cellSize > bounds.maxX + CONNECTOR_RADIUS ||
      target.y / cellSize < bounds.minY - CONNECTOR_RADIUS ||
      target.y / cellSize > bounds.maxY + CONNECTOR_RADIUS)
  )
    return { status: "unreachable", expandedNodes: 0 };
  if (!input.isClear(target))
    return { status: "unreachable", expandedNodes: 0 };
  if (input.canTraverse(from, target))
    return {
      status: "found",
      waypoints: [target],
      cost: distance(from, target),
      expandedNodes: 0,
    };

  const open = new MinHeap();
  const scores = new Map<string, number>();
  const parents = new Map<string, string>();
  const coords = new Map<string, readonly [number, number]>();
  let order = 0;
  const sx = from.x / cellSize,
    sy = from.y / cellSize,
    radius = Math.ceil(CONNECTOR_RADIUS);
  const seeds: { x: number; y: number; cost: number }[] = [];
  for (let y = Math.floor(sy) - radius; y <= Math.ceil(sy) + radius; y++)
    for (let x = Math.floor(sx) - radius; x <= Math.ceil(sx) + radius; x++) {
      const p = point(x, y, cellSize),
        cost = distance(from, p);
      if (
        inBounds(x, y, bounds) &&
        cost <= CONNECTOR_RADIUS * cellSize &&
        input.isClear(p) &&
        input.canTraverse(from, p)
      )
        seeds.push({ x, y, cost });
    }
  seeds.sort((a, b) => a.cost - b.cost || a.x - b.x || a.y - b.y);
  for (const seed of seeds) {
    const k = key(seed.x, seed.y),
      previous = scores.get(k);
    if (previous !== undefined && previous <= seed.cost) continue;
    scores.set(k, seed.cost);
    coords.set(k, [seed.x, seed.y]);
    open.push({
      x: seed.x,
      y: seed.y,
      g: seed.cost,
      f: seed.cost + distance(point(seed.x, seed.y, cellSize), target),
      order: order++,
    });
  }

  let expandedNodes = 0;
  while (open.size > 0 && expandedNodes < maxExpandedNodes) {
    const current = open.pop();
    if (current === undefined) break;
    const ck = key(current.x, current.y);
    if (current.g !== scores.get(ck)) continue;
    expandedNodes++;
    const here = point(current.x, current.y, cellSize);
    if (
      distance(here, target) <= CONNECTOR_RADIUS * cellSize &&
      input.canTraverse(here, target)
    ) {
      const chain = [ck];
      let cursor = ck;
      while (parents.has(cursor)) {
        cursor = parents.get(cursor)!;
        chain.push(cursor);
      }
      chain.reverse();
      const waypoints = chain.map((k) => {
        const [x, y] = coords.get(k)!;
        return point(x, y, cellSize);
      });
      waypoints.push(target);
      const compact = waypoints.filter(
        (p, i) => i === 0 || distance(p, waypoints[i - 1]) > 1e-9,
      );
      return {
        status: "found",
        waypoints: compact,
        cost: current.g + distance(here, target),
        expandedNodes,
      };
    }
    for (const [dx, dy] of DIRECTIONS) {
      const x = current.x + dx,
        y = current.y + dy;
      if (!inBounds(x, y, bounds)) continue;
      const next = point(x, y, cellSize);
      if (!input.isClear(next) || !input.canTraverse(here, next)) continue;
      if (dx !== 0 && dy !== 0) {
        const sideX = point(current.x + dx, current.y, cellSize),
          sideY = point(current.x, current.y + dy, cellSize);
        if (
          !input.isClear(sideX) ||
          !input.isClear(sideY) ||
          !input.canTraverse(here, sideX) ||
          !input.canTraverse(here, sideY)
        )
          continue;
      }
      const nk = key(x, y),
        candidate = current.g + distance(here, next);
      if (candidate >= (scores.get(nk) ?? Number.POSITIVE_INFINITY) - 1e-10)
        continue;
      scores.set(nk, candidate);
      parents.set(nk, ck);
      coords.set(nk, [x, y]);
      open.push({
        x,
        y,
        g: candidate,
        f: candidate + distance(next, target),
        order: order++,
      });
    }
  }
  if (open.size > 0 || bounds === undefined)
    return { status: "incomplete", expandedNodes };
  return { status: "unreachable", expandedNodes };
};

interface CachedGridRoute {
  readonly target: Vector2;
  readonly waypoints: Vector2[];
}
interface CachedGridFailure {
  readonly from: Vector2;
  readonly target: Vector2;
  readonly status: "unreachable" | "incomplete";
  retriesIn: number;
}

export type GridNavigationStep =
  | { readonly status: "found"; readonly waypoint: Vector2 | null }
  | { readonly status: "unreachable" | "incomplete"; readonly waypoint: null };

/** Reuses a proven route while validating every next edge against live collision state. */
export class GridNavigationCache {
  private readonly routes = new Map<string, CachedGridRoute>();
  private readonly failures = new Map<string, CachedGridFailure>();

  clear(id?: string): void {
    if (id === undefined) {
      this.routes.clear();
      this.failures.clear();
      return;
    }
    this.routes.delete(id);
    this.failures.delete(id);
  }

  nextWaypoint({
    id,
    from,
    target,
    plan,
    canTraverse,
  }: {
    readonly id: string;
    readonly from: Vector2;
    readonly target: Vector2;
    readonly plan: () => GridPathfindingResult;
    readonly canTraverse: (from: Vector2, to: Vector2) => boolean;
  }): GridNavigationStep {
    const failure = this.failures.get(id);
    if (failure !== undefined) {
      if (
        distanceSquared(from, failure.from) > 0.5 * 0.5 ||
        distanceSquared(target, failure.target) > 0.5 * 0.5
      )
        this.failures.delete(id);
      else if (failure.retriesIn > 0) {
        failure.retriesIn -= 1;
        return { status: failure.status, waypoint: null };
      } else this.failures.delete(id);
    }

    const cached = this.routes.get(id);
    if (cached !== undefined) {
      if (distanceSquared(target, cached.target) > 0.5 * 0.5)
        this.routes.delete(id);
      else {
        while (
          cached.waypoints.length > 0 &&
          distanceSquared(from, cached.waypoints[0]) <= 0.15 * 0.15
        )
          cached.waypoints.shift();
        const next = cached.waypoints[0];
        if (next !== undefined && canTraverse(from, next))
          return { status: "found", waypoint: next };
        this.routes.delete(id);
      }
    }

    const result = plan();
    if (result.status !== "found") {
      this.failures.set(id, {
        from,
        target,
        status: result.status,
        retriesIn: result.status === "unreachable" ? 60 : 15,
      });
      return { status: result.status, waypoint: null };
    }
    this.failures.delete(id);
    const route = { target, waypoints: [...result.waypoints] };
    while (
      route.waypoints.length > 0 &&
      distanceSquared(from, route.waypoints[0]) <= 0.15 * 0.15
    )
      route.waypoints.shift();
    this.routes.set(id, route);
    const next = route.waypoints[0];
    return next !== undefined && canTraverse(from, next)
      ? { status: "found", waypoint: next }
      : { status: "found", waypoint: null };
  }
}
