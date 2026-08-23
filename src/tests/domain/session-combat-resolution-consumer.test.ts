import { describe, expect, it } from "vitest";
import { enemyDefinitions, gameplayTuning } from "../../data/definitions";
import { GameSession } from "../../domain/GameSession";
import { advance, savedAtHome } from "./session-test-helpers";

describe("GameSession combat-resolution consumer coverage", () => {
  it("observes distinct primary and chain hits while capped hit healing restores max HP", () => {
    const base = savedAtHome();
    const session = new GameSession({
      saved: {
        ...base,
        player: { ...base.player, hp: 99 },
        upgrades: ["chain-strike", "invigorating-edge", "long-reach"],
      },
    });
    const before = session.snapshot();
    const primaryBefore = before.enemies.find(
      (enemy) => enemy.id === "enemy:starter-scout",
    );
    const chainBefore = before.enemies.find(
      (enemy) => enemy.id === "enemy:starter-brute",
    );
    if (primaryBefore === undefined || chainBefore === undefined)
      throw new Error(
        "deterministic primary and chain targets should be visible",
      );

    advance(session, gameplayTuning.baseAttackIntervalSeconds);
    expect(session.snapshot().projectiles).toEqual([
      expect.objectContaining({
        targetId: primaryBefore.id,
        progress: 0,
      }),
    ]);

    advance(session, gameplayTuning.basicProjectileTravelSeconds);
    const after = session.snapshot();
    const primaryAfter = after.enemies.find(
      (enemy) => enemy.id === primaryBefore.id,
    );
    const chainAfter = after.enemies.find(
      (enemy) => enemy.id === chainBefore.id,
    );

    expect(primaryAfter?.hp).toBe(
      primaryBefore.hp - before.combatStats.attackDamage,
    );
    expect(chainAfter?.hp).toBe(
      chainBefore.hp - before.combatStats.attackDamage / 2,
    );
    expect(after.player.hp).toBe(before.player.maxHp);
  });

  it("keeps a defeated boss absent past a normal respawn interval and retains its choices", () => {
    const session = new GameSession({ saved: savedAtHome() });
    session.move({ intent: { x: 1, y: 0 }, source: "keyboard", at: 1 });
    advance(session, 1);
    session.move({ intent: { x: 0, y: 0 }, source: "keyboard", at: 2 });
    advance(session, 4.2 + gameplayTuning.basicProjectileTravelSeconds);

    const defeated = session.snapshot();
    const bossId = "boss:ember-wyrm";
    const choices = [...defeated.pendingUpgradeChoices];
    const selectedChoice = choices[0];
    const normalRespawnSeconds = enemyDefinitions.scout.respawnSeconds;
    if (selectedChoice === undefined || normalRespawnSeconds === null)
      throw new Error(
        "the deterministic boss fixture should expose a choice and normal respawn",
      );

    expect(
      defeated.enemies.find((enemy) => enemy.id === bossId),
    ).toBeUndefined();
    expect(defeated.defeatedBossIds).toEqual([bossId]);
    expect(defeated.notice).toEqual({
      kind: "boss.defeated",
      hasUpgradeChoices: true,
    });
    expect(choices).toHaveLength(3);

    advance(session, normalRespawnSeconds + 0.1);
    const afterNormalRespawnWindow = session.snapshot();
    expect(
      afterNormalRespawnWindow.enemies.find((enemy) => enemy.id === bossId),
    ).toBeUndefined();
    expect(afterNormalRespawnWindow.defeatedBossIds).toEqual([bossId]);
    expect(afterNormalRespawnWindow.pendingUpgradeChoices).toEqual(choices);
    expect(session.chooseUpgrade(selectedChoice)).toBe(true);
    expect(session.snapshot().upgrades).toContain(selectedChoice);
  });
});
