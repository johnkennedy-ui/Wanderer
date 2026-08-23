import { describe, expect, it } from "vitest";
import { enemyDefinitions, gameplayTuning } from "../../data/definitions";
import { GameSession } from "../../domain/GameSession";
import { combatStatsFor } from "../../domain/session/progressionRules";
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
    const before = session.presentation();
    const primaryBefore = before.renderer.enemies.find(
      (enemy) => enemy.id === "enemy:starter-scout",
    );
    const chainBefore = before.renderer.enemies.find(
      (enemy) => enemy.id === "enemy:starter-brute",
    );
    if (primaryBefore === undefined || chainBefore === undefined)
      throw new Error(
        "deterministic primary and chain targets should be visible",
      );

    advance(session, gameplayTuning.baseAttackIntervalSeconds);
    expect(session.presentation().renderer.projectiles).toEqual([
      expect.objectContaining({
        targetId: primaryBefore.id,
        progress: 0,
      }),
    ]);

    advance(session, gameplayTuning.basicProjectileTravelSeconds);
    const after = session.presentation();
    const primaryAfter = after.renderer.enemies.find(
      (enemy) => enemy.id === primaryBefore.id,
    );
    const chainAfter = after.renderer.enemies.find(
      (enemy) => enemy.id === chainBefore.id,
    );
    const attackDamage = combatStatsFor(base.buildings, [
      "chain-strike",
      "invigorating-edge",
      "long-reach",
    ]).attackDamage;

    expect(primaryAfter?.hp).toBe(primaryBefore.hp - attackDamage);
    expect(chainAfter?.hp).toBe(chainBefore.hp - attackDamage / 2);
    expect(after.ui.player.hp).toBe(before.ui.player.maxHp);
  });

  it("keeps a defeated boss absent past a normal respawn interval and retains its choices", () => {
    const session = new GameSession({ saved: savedAtHome() });
    session.move({ intent: { x: 1, y: 0 }, source: "keyboard", at: 1 });
    advance(session, 1);
    session.move({ intent: { x: 0, y: 0 }, source: "keyboard", at: 2 });
    advance(session, 4.2 + gameplayTuning.basicProjectileTravelSeconds);

    const defeated = session.presentation();
    const bossId = "boss:ember-wyrm";
    const choices = [...defeated.ui.pendingUpgradeChoices];
    const selectedChoice = choices[0];
    const normalRespawnSeconds = enemyDefinitions.scout.respawnSeconds;
    if (selectedChoice === undefined || normalRespawnSeconds === null)
      throw new Error(
        "the deterministic boss fixture should expose a choice and normal respawn",
      );

    expect(
      defeated.renderer.enemies.find((enemy) => enemy.id === bossId),
    ).toBeUndefined();
    expect(defeated.ui.notice).toEqual({
      kind: "boss.defeated",
      hasUpgradeChoices: true,
    });
    expect(choices).toHaveLength(3);

    advance(session, normalRespawnSeconds + 0.1);
    const afterNormalRespawnWindow = session.presentation();
    expect(
      afterNormalRespawnWindow.renderer.enemies.find(
        (enemy) => enemy.id === bossId,
      ),
    ).toBeUndefined();
    expect(afterNormalRespawnWindow.ui.pendingUpgradeChoices).toEqual(choices);
    session.setDestination({
      destination: { x: 0, y: 0 },
      source: "tap-to-move",
      at: 3,
    });
    advance(session, 2);
    const beforeUpgradeSave = session.createValidCampfireSaveRequest(4);
    if (beforeUpgradeSave === null)
      throw new Error("home campfire should create a save document");
    expect(beforeUpgradeSave.document.defeatedBossIds).toEqual([bossId]);
    expect(beforeUpgradeSave.document.upgrades).toEqual([]);
    expect(session.chooseUpgrade(selectedChoice)).toBe(true);
    const afterUpgradeSave = session.createValidCampfireSaveRequest(5);
    if (afterUpgradeSave === null)
      throw new Error("home campfire should remain saveable");
    expect(afterUpgradeSave.document.upgrades).toContain(selectedChoice);
  });
});
