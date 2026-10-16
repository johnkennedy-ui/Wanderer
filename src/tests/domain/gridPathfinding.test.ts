import { describe, expect, it } from "vitest";
import type { Vector2 } from "../../domain/types";
import {
  findGridPath,
  GridNavigationCache,
} from "../../domain/session/gridPathfinding";

const close = (a: Vector2, b: Vector2): boolean =>
  Math.hypot(a.x - b.x, a.y - b.y) < 1e-8;

describe("grid A* pathfinding", () => {
  it("uses a direct segment without exploring the graph", () => {
    const result = findGridPath({
      from: { x: 0.2, y: 0.1 },
      target: { x: 4.1, y: 2.7 },
      cellSize: 0.5,
      maxExpandedNodes: 100,
      isClear: () => true,
      canTraverse: () => true,
    });
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.waypoints).toEqual([{ x: 4.1, y: 2.7 }]);
    expect(result.cost).toBeCloseTo(Math.hypot(3.9, 2.6), 12);
    expect(result.expandedNodes).toBe(0);
  });

  it("finds a deterministic collision-clear detour around an obstacle", () => {
    const blocked = (p: Vector2) => Math.abs(p.x) < 0.24 && Math.abs(p.y) < 1.1;
    const clearSegment = (a: Vector2, b: Vector2) => {
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.ceil(length / 0.025);
      for (let i = 0; i <= steps; i++) {
        const t = steps === 0 ? 0 : i / steps;
        if (blocked({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }))
          return false;
      }
      return true;
    };
    const input = {
      from: { x: -2, y: 0 },
      target: { x: 2, y: 0 },
      cellSize: 0.5,
      maxExpandedNodes: 2_000,
      bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
      isClear: (p: Vector2) => !blocked(p),
      canTraverse: clearSegment,
    };
    const result = findGridPath(input);
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.waypoints.length).toBeGreaterThan(2);
    expect(result.waypoints.some((p) => Math.abs(p.y) >= 1.1)).toBe(true);
    let measured = 0;
    let from = input.from;
    for (const waypoint of result.waypoints) {
      expect(clearSegment(from, waypoint)).toBe(true);
      measured += Math.hypot(waypoint.x - from.x, waypoint.y - from.y);
      from = waypoint;
    }
    expect(measured).toBeCloseTo(result.cost, 8);
    expect(findGridPath(input)).toEqual(result);
  });

  it("distinguishes exhaustive bounded failure from a capped search", () => {
    const wall = (p: Vector2) => Math.abs(p.x) < 0.26;
    const clearSegment = (a: Vector2, b: Vector2) => {
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.025);
      for (let i = 0; i <= steps; i++) {
        const t = steps === 0 ? 0 : i / steps;
        if (wall({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }))
          return false;
      }
      return true;
    };
    const input = {
      from: { x: -1, y: 0 },
      target: { x: 1, y: 0 },
      cellSize: 0.5,
      bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
      isClear: (p: Vector2) => !wall(p),
      canTraverse: clearSegment,
    };
    expect(findGridPath({ ...input, maxExpandedNodes: 1 }).status).toBe(
      "incomplete",
    );
    expect(findGridPath({ ...input, maxExpandedNodes: 500 }).status).toBe(
      "unreachable",
    );
    expect(
      findGridPath({ ...input, maxExpandedNodes: 500, bounds: undefined })
        .status,
    ).toBe("incomplete");
  });

  it("never invents a route when no valid source connector exists", () => {
    const result = findGridPath({
      from: { x: 0, y: 0 },
      target: { x: 5, y: 0 },
      cellSize: 1,
      maxExpandedNodes: 100,
      bounds: { minX: -4, maxX: 8, minY: -4, maxY: 4 },
      isClear: (p) => !close(p, { x: 0, y: 0 }),
      canTraverse: () => false,
    });
    expect(result.status).toBe("unreachable");
  });

  it("proves a target outside finite bounds unreachable without searching", () => {
    const result = findGridPath({
      from: { x: 0, y: 0 },
      target: { x: 100, y: 0 },
      cellSize: 1,
      maxExpandedNodes: 10,
      bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
      isClear: () => true,
      canTraverse: () => false,
    });
    expect(result).toEqual({ status: "unreachable", expandedNodes: 0 });
  });

  it("invalidates a cached route edge and replans around a transient block", () => {
    const cache = new GridNavigationCache();
    let blocked = false;
    let plans = 0;
    const first = { x: 1, y: 0 };
    const alternate = { x: 0, y: 1 };
    const step = () =>
      cache.nextWaypoint({
        id: "player",
        from: { x: 0, y: 0 },
        target: { x: 2, y: 0 },
        canTraverse: (_from, to) => !blocked || !close(to, first),
        plan: () => {
          plans += 1;
          return {
            status: "found",
            waypoints: [blocked ? alternate : first, { x: 2, y: 0 }],
            cost: 2,
            expandedNodes: 2,
          };
        },
      });
    expect(step()).toEqual({ status: "found", waypoint: first });
    blocked = true;
    expect(step()).toEqual({ status: "found", waypoint: alternate });
    expect(plans).toBe(2);
  });
});
