import { describe, expect, it } from "vitest";
import { GameSession } from "../../domain/GameSession";
import { savedAtHome } from "./session-test-helpers";

const advance = (session: GameSession, seconds: number): void => {
  for (let tick = 0; tick < Math.ceil(seconds * 10); tick += 1)
    session.tick(0.1);
};

describe("GameSession presentation clock and reset epochs", () => {
  it("keeps renderer elapsed time paused on a zero tick, expires copied cues, and never persists them", () => {
    const session = new GameSession();
    advance(session, 0.6);
    const committed = session.presentation();
    expect(committed.renderer.attackCues).toHaveLength(1);
    const cue = committed.renderer.attackCues[0];
    if (cue === undefined)
      throw new Error("the committed attack cue is required");
    (cue.direction as { x: number }).x = 99;
    const detached = session.presentation();
    expect(detached.renderer.attackCues[0]?.direction.x).not.toBe(99);
    session.tick(0);
    expect(session.presentation().renderer.presentationElapsed).toBe(
      detached.renderer.presentationElapsed,
    );
    session.move({ intent: { x: 1, y: 0 }, source: "keyboard", at: 1 });
    advance(session, 0.5);
    expect(session.presentation().renderer.attackCues).toEqual([]);
    const save = session.createValidCampfireSaveRequest(9);
    expect(save?.document).not.toHaveProperty("attackPresentation");
    expect(save?.document).not.toHaveProperty("presentationResetId");
  });

  it("increments the presentation epoch and clears cues on explicit reset and authoritative death respawn", () => {
    const session = new GameSession();
    advance(session, 0.6);
    const beforeReset = session.presentation().renderer;
    expect(beforeReset.attackCues).toHaveLength(1);
    session.resetWorld("presentation-reset");
    const afterReset = session.presentation().renderer;
    expect(afterReset.presentationResetId).toBeGreaterThan(
      beforeReset.presentationResetId,
    );
    expect(afterReset.presentationElapsed).toBe(
      beforeReset.presentationElapsed,
    );
    expect(afterReset.attackCues).toEqual([]);

    const saved = savedAtHome();
    const respawning = new GameSession({
      saved: { ...saved, player: { ...saved.player, hp: 1 } },
    });
    const beforeDeathEpoch =
      respawning.presentation().renderer.presentationResetId;
    respawning.move({ intent: { x: 1, y: 0 }, source: "keyboard", at: 1 });
    for (let tick = 0; tick < 50; tick += 1) {
      respawning.tick(0.1);
      if (
        respawning.presentation().renderer.presentationResetId >
        beforeDeathEpoch
      )
        break;
    }
    const afterDeath = respawning.presentation();
    expect(afterDeath.ui.notice).toMatchObject({ kind: "player.died" });
    expect(afterDeath.renderer.presentationResetId).toBeGreaterThan(
      beforeDeathEpoch,
    );
    expect(afterDeath.renderer.attackCues).toEqual([]);
  });
});
