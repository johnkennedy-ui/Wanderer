import { describe, expect, it } from "vitest";
import { enemyDefinitions, gameplayTuning } from "../../data/definitions";
import {
  waveEnemyDraftsFor,
  wavePhaseFor,
} from "../../domain/session/wavePolicy";

describe("timed wave policy", () => {
  it("starts at two minutes, runs for exactly thirty seconds, then schedules the next interval", () => {
    expect(wavePhaseFor(119.999)).toMatchObject({
      active: false,
      waveIndex: 0,
    });
    expect(wavePhaseFor(119.999).nextWaveInSeconds).toBeCloseTo(0.001, 6);
    expect(wavePhaseFor(120)).toMatchObject({
      active: true,
      waveIndex: 1,
      startsAt: 120,
      endsAt: 150,
      secondsRemaining: 30,
      nextWaveInSeconds: 0,
    });
    expect(wavePhaseFor(149.9)).toMatchObject({ active: true, waveIndex: 1 });
    expect(wavePhaseFor(149.9).secondsRemaining).toBeCloseTo(0.1, 6);
    expect(wavePhaseFor(150)).toMatchObject({
      active: false,
      waveIndex: 1,
      nextWaveInSeconds: 90,
    });
  });

  it("creates five deterministic three-enemy groups plus one large seeded boss", () => {
    const input = {
      seed: "wave-policy-seed",
      waveIndex: 1,
      center: { x: 10, y: -4 },
    };
    const first = waveEnemyDraftsFor(input);
    const second = waveEnemyDraftsFor(input);
    expect(first).toEqual(second);
    const normal = first.filter((enemy) => !enemy.isWaveBoss);
    const boss = first.find((enemy) => enemy.isWaveBoss);
    expect(normal).toHaveLength(
      gameplayTuning.waveDensityMultiplier * gameplayTuning.waveBaseGroupSize,
    );
    expect(new Set(normal.map((enemy) => enemy.id)).size).toBe(15);
    expect(normal.every((enemy) => enemy.waveExpiresAt === 150)).toBe(true);
    expect(boss).toMatchObject({
      kind: "boss",
      waveIndex: 1,
      isWaveBoss: true,
      maxHp:
        enemyDefinitions.boss.maxHp * gameplayTuning.waveBossHealthMultiplier,
      damage:
        enemyDefinitions.boss.damage * gameplayTuning.waveBossDamageMultiplier,
      dropMultiplier: gameplayTuning.waveBossDropMultiplier,
    });
  });
});
