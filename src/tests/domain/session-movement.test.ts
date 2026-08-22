import { describe, expect, it } from "vitest";
import { enemyDefinitions, gameplayTuning } from "../../data/definitions";
import { GameSession } from "../../domain/GameSession";
import { advance } from "./session-test-helpers";

describe("GameSession movement", () => {
  it("preserves bounded virtual-stick magnitude after a lower movement dead zone", () => {
    const session = new GameSession();
    session.move({ intent: { x: 0.07, y: 0 }, source: "virtual-stick", at: 1 });
    session.tick(0.1);
    expect(session.snapshot().moving).toBe(false);
    expect(session.snapshot().player.position).toEqual({ x: 0, y: 0 });

    session.move({ intent: { x: 0.2, y: 0 }, source: "virtual-stick", at: 2 });
    session.tick(0.1);
    expect(session.snapshot().moving).toBe(true);
    expect(session.snapshot().player.position).toEqual({ x: 0.06, y: 0 });

    session.move({ intent: { x: 3, y: 4 }, source: "virtual-stick", at: 3 });
    session.tick(0.1);
    expect(session.snapshot().player.position).toEqual({ x: 0.24, y: 0.24 });
  });

  it("immediately suppresses basic attacks while meaningful movement is present", () => {
    const session = new GameSession();
    const scoutBefore = session
      .snapshot()
      .enemies.find((enemy) => enemy.id === "enemy:starter-scout");
    session.move({ intent: { x: 1, y: 0 }, source: "keyboard", at: 1 });
    advance(session, 0.8);
    const scoutAfter = session
      .snapshot()
      .enemies.find((enemy) => enemy.id === "enemy:starter-scout");

    expect(session.snapshot().moving).toBe(true);
    expect(session.snapshot().combatStatus).toContain("suppressed");
    expect(session.snapshot().projectiles).toEqual([]);
    expect(scoutAfter?.hp).toBe(scoutBefore?.hp);

    session.move({ intent: { x: 0, y: 0 }, source: "keyboard", at: 2 });
    advance(session, 0.6);
    expect(session.snapshot().combatStatus).toContain("Auto-attacking");
  });

  it("pursues the player's current location at a data-defined speed without crossing attack standoff", () => {
    const session = new GameSession();
    const scoutBefore = session
      .snapshot()
      .enemies.find((enemy) => enemy.id === "enemy:starter-scout");
    if (scoutBefore === undefined)
      throw new Error("starter scout should be active near the initial player");

    const standoff = gameplayTuning.enemyAttackStandoff;
    const tickSeconds = 0.1;
    const moveAwayFromScout = {
      x: -scoutBefore.position.x,
      y: -scoutBefore.position.y,
    };
    session.move({
      intent: moveAwayFromScout,
      source: "keyboard",
      at: 1,
    });
    session.tick(tickSeconds);

    const afterMovingPlayer = session.snapshot();
    const scoutAfterFirstPursuit = afterMovingPlayer.enemies.find(
      (enemy) => enemy.id === scoutBefore.id,
    );
    if (scoutAfterFirstPursuit === undefined)
      throw new Error("active scout should remain in the snapshot");
    const currentPlayerSeparation = {
      x: afterMovingPlayer.player.position.x - scoutBefore.position.x,
      y: afterMovingPlayer.player.position.y - scoutBefore.position.y,
    };
    const currentPlayerDistance = Math.hypot(
      currentPlayerSeparation.x,
      currentPlayerSeparation.y,
    );
    const expectedTravel = Math.min(
      enemyDefinitions.scout.moveSpeed * tickSeconds,
      currentPlayerDistance - standoff,
    );
    expect(expectedTravel).toBeGreaterThan(0);
    expect(scoutAfterFirstPursuit.position.x).toBeCloseTo(
      scoutBefore.position.x +
        (currentPlayerSeparation.x / currentPlayerDistance) * expectedTravel,
      6,
    );
    expect(scoutAfterFirstPursuit.position.y).toBeCloseTo(
      scoutBefore.position.y +
        (currentPlayerSeparation.y / currentPlayerDistance) * expectedTravel,
      6,
    );

    session.move({ intent: { x: 0, y: 0 }, source: "keyboard", at: 2 });
    const distanceAfterFirstPursuit = Math.hypot(
      afterMovingPlayer.player.position.x - scoutAfterFirstPursuit.position.x,
      afterMovingPlayer.player.position.y - scoutAfterFirstPursuit.position.y,
    );
    const remainingTicks = Math.ceil(
      Math.max(
        0,
        (distanceAfterFirstPursuit - standoff) /
          (enemyDefinitions.scout.moveSpeed * tickSeconds),
      ),
    );
    for (let tick = 0; tick < remainingTicks; tick += 1)
      session.tick(tickSeconds);

    const settledSnapshot = session.snapshot();
    const settledScout = settledSnapshot.enemies.find(
      (enemy) => enemy.id === scoutBefore.id,
    );
    if (settledScout === undefined)
      throw new Error("scout should not be defeated before reaching standoff");
    const settledDistance = Math.hypot(
      settledSnapshot.player.position.x - settledScout.position.x,
      settledSnapshot.player.position.y - settledScout.position.y,
    );
    expect(settledDistance).toBeGreaterThanOrEqual(standoff - 0.000_001);
    expect(settledDistance).toBeCloseTo(standoff, 6);
  });

  it("moves to explicit tap destinations, stops on arrival, and lets manual movement cancel them", () => {
    const session = new GameSession();
    session.setDestination({
      destination: { x: 1, y: 0 },
      source: "tap-to-move",
      at: 1,
    });
    expect(session.snapshot().destination).toEqual({ x: 1, y: 0 });
    advance(session, 1);
    expect(session.snapshot().player.position).toEqual({ x: 1, y: 0 });
    expect(session.snapshot().destination).toBeNull();
    expect(session.snapshot().moving).toBe(false);

    session.setDestination({
      destination: { x: 5, y: 0 },
      source: "tap-to-move",
      at: 2,
    });
    session.move({ intent: { x: -1, y: 0 }, source: "keyboard", at: 3 });
    expect(session.snapshot().destination).toBeNull();
    session.setDestination({
      destination: { x: 5, y: 0 },
      source: "tap-to-move",
      at: 4,
    });
    session.move({
      intent: { x: 1, y: 0 },
      source: "virtual-stick",
      at: 5,
    });
    expect(session.snapshot().destination).toBeNull();
  });
});
