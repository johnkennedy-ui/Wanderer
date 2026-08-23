import { describe, expect, it } from "vitest";
import { gameplayTuning } from "../../data/definitions";
import { GameSession } from "../../domain/GameSession";
import { selectBossUpgradeChoices } from "../../domain/session/bossUpgradeChoices";
import type { SaveDocument } from "../../domain/types";
import { createBrowserSaveStorage } from "../../platform/storage/browserSaveStorage";
import { advance, MemoryStore, savedAtHome } from "./session-test-helpers";

const frozenDefaultBossChoiceTrio = [
  "quick-hands",
  "iron-skin",
  "ember-aura",
] as const;

describe("GameSession progression", () => {
  it("keeps Boss Core and upgrades runtime-only until a later manual campfire commit", () => {
    const baseline = savedAtHome();
    const session = new GameSession({ saved: baseline });
    session.move({ intent: { x: 1, y: 0 }, source: "keyboard", at: 1 });
    advance(session, 1);
    session.move({ intent: { x: 0, y: 0 }, source: "keyboard", at: 2 });
    advance(session, 4.2 + gameplayTuning.basicProjectileTravelSeconds);
    const afterBossDefeat = session.presentation();
    const choices = afterBossDefeat.ui.pendingUpgradeChoices;
    const bossDrop = afterBossDefeat.renderer.floorDrops.find(
      (drop) => drop.resource === "bossCore",
    );
    if (bossDrop === undefined) throw new Error("boss should drop a Boss Core");
    expect(afterBossDefeat.ui.resources.bossCore).toBe(0);
    expect(afterBossDefeat.ui.notice).toEqual({
      kind: "boss.defeated",
      hasUpgradeChoices: true,
    });
    expect(choices).toEqual(frozenDefaultBossChoiceTrio);
    expect(
      selectBossUpgradeChoices(
        afterBossDefeat.ui.world.seed,
        baseline.upgrades,
      ),
    ).toEqual(frozenDefaultBossChoiceTrio);
    session.setDestination({
      destination: bossDrop.position,
      source: "tap-to-move",
      at: 2.5,
    });
    advance(session, 1);
    expect(session.presentation().ui.resources.bossCore).toBe(1);
    expect(choices).toHaveLength(3);
    expect(choices).toContain("iron-skin");
    const playerBeforeUpgrade = session.presentation().ui.player;
    expect(session.chooseUpgrade("iron-skin")).toBe(true);
    expect(session.presentation().ui.player.maxHp).toBe(
      playerBeforeUpgrade.maxHp + 25,
    );
    expect(session.presentation().ui.player.hp).toBe(
      Math.min(playerBeforeUpgrade.maxHp + 25, playerBeforeUpgrade.hp + 25),
    );

    const unsavedReload = new GameSession({ saved: baseline });
    expect(unsavedReload.presentation().ui.resources.bossCore).toBe(0);
    const unsavedReloadSave = unsavedReload.createValidCampfireSaveRequest(98);
    if (unsavedReloadSave === null)
      throw new Error("baseline home should create a save document");
    expect(unsavedReloadSave.document.upgrades).toEqual([]);

    session.setDestination({
      destination: { x: 0, y: 0 },
      source: "tap-to-move",
      at: 3,
    });
    advance(session, 3);
    const request = session.createValidCampfireSaveRequest(99);
    expect(request).not.toBeNull();
    expect(request?.document.defeatedBossIds).toHaveLength(1);
    expect(request?.document.upgrades).toContain("iron-skin");
    const storage = createBrowserSaveStorage(new MemoryStore());
    expect(storage.commit(request!.document).ok).toBe(true);
    session.recordSaveCommitted(request!.document);
    expect(session.presentation().ui.notice).toEqual({
      kind: "save.committed",
      savePointId: request!.document.savePointId,
    });
    const savedReload = new GameSession({
      saved: storage.load().document ?? undefined,
    });
    expect(savedReload.presentation().ui.resources.bossCore).toBe(1);
    const savedReloadSave = savedReload.createValidCampfireSaveRequest(100);
    if (savedReloadSave === null)
      throw new Error("saved home should create a save document");
    expect(savedReloadSave.document.upgrades).toContain("iron-skin");
  });

  it("respawns at the committed save-point position, applies the configured 25% loss, and never commits on death", () => {
    const base = savedAtHome();
    const committed: SaveDocument = {
      ...base,
      player: { position: { x: 6, y: 0 }, hp: 1, maxHp: 100 },
      resources: {
        wood: 100,
        stone: 100,
        scrap: 100,
        essence: 100,
        bossCore: 8,
      },
      savePointId: "campfire:player:committed",
      savePointPosition: { x: -1, y: -1 },
    };
    const storage = createBrowserSaveStorage(new MemoryStore());
    expect(storage.commit(committed).ok).toBe(true);
    const session = new GameSession({ saved: committed });
    advance(session, 1.4);

    expect(session.presentation().ui.player.position).toEqual({ x: -1, y: -1 });
    expect(session.presentation().ui.resources).toEqual({
      wood: 75,
      stone: 75,
      scrap: 75,
      essence: 75,
      bossCore: 6,
    });
    expect(session.presentation().ui.notice).toEqual({
      kind: "player.died",
      savePointLabel: "committed campfire",
      resourceLossRate: 0.25,
    });
    expect(storage.load().document).toEqual(committed);
  });
});
