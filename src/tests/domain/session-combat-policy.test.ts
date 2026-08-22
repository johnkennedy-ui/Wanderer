import { describe, expect, it } from "vitest";
import {
  advanceProjectileFlight,
  enemyPursuitPosition,
  liveTargetsInRange,
  projectileDraftFor,
  projectileLaunchDecision,
} from "../../domain/session/combatPolicy";
import type { Vector2 } from "../../domain/types";

interface TestTarget {
  readonly id: string;
  readonly position: Vector2;
  readonly defeated: boolean;
}

const target = (
  id: string,
  position: Vector2,
  defeated = false,
): TestTarget => ({ id, position, defeated });

describe("session combat policy", () => {
  it("filters to live in-range targets and orders distance ties by stable ID", () => {
    const playerPosition = { x: 0, y: 0 };
    const targets = [
      target("enemy:out-of-range", { x: 3, y: 0 }),
      target("enemy:bravo", { x: -1, y: 0 }),
      target("enemy:defeated", { x: 0.25, y: 0 }, true),
      target("enemy:alpha", { x: 1, y: 0 }),
      target("enemy:edge", { x: 0, y: 2 }),
      target("enemy:near", { x: 0.5, y: 0 }),
    ];

    const ordered = liveTargetsInRange({
      playerPosition,
      targets,
      range: 2,
    });

    expect(ordered.map((candidate) => candidate.id)).toEqual([
      "enemy:near",
      "enemy:alpha",
      "enemy:bravo",
      "enemy:edge",
    ]);
    expect(targets.map((candidate) => candidate.id)).toEqual([
      "enemy:out-of-range",
      "enemy:bravo",
      "enemy:defeated",
      "enemy:alpha",
      "enemy:edge",
      "enemy:near",
    ]);
  });

  it("classifies launch readiness and builds a serial-free projectile draft", () => {
    const targets = [
      target("enemy:primary", { x: 2, y: 0 }),
      target("enemy:secondary", { x: 2.5, y: 0 }),
      target("enemy:third", { x: 3, y: 0 }),
    ];

    expect(
      projectileLaunchDecision({
        targets,
        attackElapsed: 0.4,
        delta: 0.1,
        attackIntervalSeconds: 0.5,
      }),
    ).toEqual({
      kind: "ready",
      target: targets[0],
      attackElapsed: 0,
    });
    expect(
      projectileLaunchDecision({
        targets,
        attackElapsed: 0.2,
        delta: 0.1,
        attackIntervalSeconds: 0.5,
      }),
    ).toEqual({
      kind: "waiting",
      target: targets[0],
      attackElapsed: 0.30000000000000004,
    });
    expect(
      projectileLaunchDecision({
        targets: [],
        attackElapsed: 0.4,
        delta: 0.1,
        attackIntervalSeconds: 0.5,
      }),
    ).toEqual({ kind: "no-target", attackElapsed: 0 });

    expect(
      projectileDraftFor({
        playerPosition: { x: 1, y: -1 },
        target: targets[0],
        targets,
        attackDamage: 12,
        chainTargets: 2,
        chainDamageMultiplier: 0.5,
        hitHeal: 1,
      }),
    ).toEqual({
      origin: { x: 1, y: -1 },
      targetId: "enemy:primary",
      targetPosition: { x: 2, y: 0 },
      damage: 12,
      chainTargetIds: ["enemy:secondary", "enemy:third"],
      chainDamage: 6,
      hitHeal: 1,
    });
  });

  it("keeps projectiles in flight below the threshold and completes at it", () => {
    expect(
      advanceProjectileFlight({
        elapsed: 0.2,
        delta: 0.09,
        travelSeconds: 0.3,
      }),
    ).toEqual({ elapsed: 0.29000000000000004, completed: false });
    expect(
      advanceProjectileFlight({
        elapsed: 0.2,
        delta: 0.1,
        travelSeconds: 0.3,
      }),
    ).toEqual({ elapsed: 0.30000000000000004, completed: true });
  });

  it("moves toward the player without crossing the authored attack standoff", () => {
    expect(
      enemyPursuitPosition({
        enemyPosition: { x: 0, y: 0 },
        playerPosition: { x: 5, y: 0 },
        moveSpeed: 2,
        delta: 0.5,
        attackStandoff: 1.8,
      }),
    ).toEqual({ x: 1, y: 0 });
    expect(
      enemyPursuitPosition({
        enemyPosition: { x: 0, y: 0 },
        playerPosition: { x: 5, y: 0 },
        moveSpeed: 100,
        delta: 0.1,
        attackStandoff: 1.8,
      }),
    ).toEqual({ x: 3.2, y: 0 });
  });
});
