import { describe, expect, it } from "vitest";
import { GameSession } from "../../domain/GameSession";

const advance = (session: GameSession, seconds: number): void => {
  for (let step = 0; step < seconds * 10; step += 1) session.tick(0.1);
};

describe("GameSession timed waves", () => {
  it("materializes one five-times-density wave at 120 seconds and clears only its normal enemies at the window end", () => {
    const session = new GameSession({
      world: { seed: "wave-session-seed", generatorVersion: "wanderer-web-v2" },
    });
    advance(session, 120);
    const active = session
      .diagnostics()
      .enemies.filter((enemy) => enemy.waveIndex === 1);
    expect(active.filter((enemy) => !enemy.isWaveBoss)).toHaveLength(15);
    expect(active.filter((enemy) => enemy.isWaveBoss)).toHaveLength(1);
    expect(session.presentation().ui.wave).toMatchObject({
      active: true,
      waveIndex: 1,
      bossActive: true,
    });

    advance(session, 30);
    const expired = session
      .diagnostics()
      .enemies.filter((enemy) => enemy.waveIndex === 1 && !enemy.isWaveBoss);
    expect(expired).toEqual([]);
    expect(session.presentation().ui.wave.active).toBe(false);
  });
});
