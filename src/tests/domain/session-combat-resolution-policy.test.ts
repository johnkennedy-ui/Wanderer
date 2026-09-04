import { describe, expect, it } from "vitest";
import {
  enemyAttackResolutionFor,
  enemyRespawnResolutionFor,
  floorDropDraftFor,
  projectileImpactResolutionFor,
} from "../../domain/session/combatResolutionPolicy";
import { resourceKinds } from "../../domain/types";

const target = (id: string, hp: number, defeated = false) => ({
  id,
  hp,
  defeated,
});

describe("session combat resolution policy", () => {
  it("resolves primary and chain impacts in order without mutating targets", () => {
    const primary = target("enemy:primary", 5);
    const secondary = target("enemy:secondary", 9);
    const targets = new Map([
      [primary.id, primary],
      [secondary.id, secondary],
      ["enemy:defeated", target("enemy:defeated", 12, true)],
    ]);

    expect(
      projectileImpactResolutionFor({
        targets,
        primaryTargetId: primary.id,
        primaryDamage: 2,
        chainTargetIds: [
          "enemy:missing",
          primary.id,
          primary.id,
          "enemy:defeated",
          secondary.id,
        ],
        chainDamage: 2,
      }),
    ).toEqual({
      impacts: [
        { targetId: primary.id, nextHp: 3, lethal: false },
        { targetId: primary.id, nextHp: 1, lethal: false },
        { targetId: primary.id, nextHp: -1, lethal: true },
        { targetId: secondary.id, nextHp: 7, lethal: false },
      ],
      landedHitCount: 4,
    });
    expect(primary).toEqual(target(primary.id, 5));
    expect(secondary).toEqual(target(secondary.id, 9));
  });

  it("classifies enemy attack timing, lethal damage, and respawn boundaries", () => {
    expect(
      enemyAttackResolutionFor({
        defeated: false,
        inAttackRange: true,
        attackElapsed: 0.4,
        attackEverySeconds: 0.5,
        damage: 4,
        playerHp: 12,
        delta: 0.09,
      }),
    ).toEqual({ kind: "waiting", attackElapsed: 0.49 });
    expect(
      enemyAttackResolutionFor({
        defeated: false,
        inAttackRange: true,
        attackElapsed: 0.4,
        attackEverySeconds: 0.5,
        damage: 4,
        playerHp: 3,
        delta: 0.1,
      }),
    ).toEqual({
      kind: "landed",
      attackElapsed: 0,
      nextPlayerHp: -1,
      playerDefeated: true,
    });
    expect(
      enemyAttackResolutionFor({
        defeated: true,
        inAttackRange: true,
        attackElapsed: 0.4,
        attackEverySeconds: 0.5,
        damage: 4,
        playerHp: 12,
        delta: 0.1,
      }),
    ).toEqual({ kind: "inactive" });

    const respawnInput = {
      defeated: true,
      respawnAt: 12,
      maxHp: 24,
      spawnPosition: { x: 2.4, y: 0 },
    };
    expect(
      enemyRespawnResolutionFor({ ...respawnInput, elapsed: 11.9 }),
    ).toEqual({ kind: "waiting" });
    expect(enemyRespawnResolutionFor({ ...respawnInput, elapsed: 12 })).toEqual(
      {
        kind: "ready",
        defeated: false,
        hp: 24,
        position: { x: 2.4, y: 0 },
        respawnAt: null,
        attackElapsed: 0,
      },
    );
  });

  it("drafts deterministic resource-order floor drops from a caller-owned serial", () => {
    const resources = {
      wood: 5,
      stone: 1,
      scrap: 0,
      essence: 0,
      bossCore: 0,
    };
    const input = {
      enemyId: "enemy:starter-scout",
      enemyPosition: { x: 1.8, y: 0 },
      serial: 7,
      resources,
      resourceOrder: resourceKinds,
      rules: { offsetDistance: 0.42 },
    };

    const draft = floorDropDraftFor(input);
    expect(draft).toEqual([
      {
        id: "drop:enemy:starter-scout:7:wood",
        resource: "wood",
        amount: 5,
        position: { x: 2.2, y: -0.14 },
      },
      {
        id: "drop:enemy:starter-scout:7:stone",
        resource: "stone",
        amount: 1,
        position: { x: 1.4, y: 0.14 },
      },
    ]);
    expect(floorDropDraftFor(input)).toEqual(draft);
    expect(
      floorDropDraftFor({ ...input, serial: 8 }).map((drop) => drop.id),
    ).toEqual([
      "drop:enemy:starter-scout:8:wood",
      "drop:enemy:starter-scout:8:stone",
    ]);
    expect(resources).toEqual({
      wood: 5,
      stone: 1,
      scrap: 0,
      essence: 0,
      bossCore: 0,
    });
  });
});
