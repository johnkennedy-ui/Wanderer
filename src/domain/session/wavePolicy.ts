import { enemyDefinitions, gameplayTuning } from "../../data/definitions";
import type { EnemyKind, Vector2 } from "../types";
import type { RuntimeEnemy } from "./sessionState";
import { copyVector } from "./sessionState";

export const waveBossNames = Object.freeze([
  "Ember Wyrm",
  "Iron Colossus",
  "Void Sage",
] as const);

export type WaveBossName = (typeof waveBossNames)[number];

export interface WavePhase {
  readonly waveIndex: number;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly active: boolean;
  readonly secondsRemaining: number;
  readonly nextWaveInSeconds: number;
}

const hashText = (text: string): number => {
  let hash = 2_166_136_261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

const unitFor = (key: string): number => (hashText(key) % 10_000) / 10_000;

/** Computes the wave schedule without observing runtime state. */
export const wavePhaseFor = (elapsed: number): WavePhase => {
  const interval = gameplayTuning.waveIntervalSeconds;
  const duration = gameplayTuning.waveDurationSeconds;
  // Ticks are decimal fractions; normalize tiny representation drift without
  // changing any meaningful (microsecond-or-greater) gameplay timing.
  const effectiveElapsed = Math.round(elapsed * 1_000_000) / 1_000_000;
  if (effectiveElapsed < interval)
    return {
      waveIndex: 0,
      startsAt: 0,
      endsAt: 0,
      active: false,
      secondsRemaining: 0,
      nextWaveInSeconds: Math.max(0, interval - effectiveElapsed),
    };

  const waveIndex = Math.floor(effectiveElapsed / interval);
  const startsAt = waveIndex * interval;
  const endsAt = startsAt + duration;
  const active = effectiveElapsed < endsAt;
  return {
    waveIndex,
    startsAt,
    endsAt,
    active,
    secondsRemaining: active ? Math.max(0, endsAt - effectiveElapsed) : 0,
    nextWaveInSeconds: active
      ? 0
      : Math.max(0, startsAt + interval - effectiveElapsed),
  };
};

export const waveBossNameFor = (
  seed: string,
  waveIndex: number,
): WaveBossName =>
  waveBossNames[
    hashText(`${seed}|wave:${waveIndex}|boss`) % waveBossNames.length
  ];

const normalKinds = Object.freeze([
  "scout",
  "brute",
  "spitter",
] as const satisfies readonly EnemyKind[]);

const spawnPositionFor = (
  seed: string,
  waveIndex: number,
  slot: number,
  center: Vector2,
): Vector2 => {
  const key = `${seed}|wave:${waveIndex}|slot:${slot}`;
  const angle = unitFor(`${key}|angle`) * Math.PI * 2;
  const distance = 5.4 + unitFor(`${key}|distance`) * 2.6;
  return {
    x: Math.round((center.x + Math.cos(angle) * distance) * 100) / 100,
    y: Math.round((center.y + Math.sin(angle) * distance) * 100) / 100,
  };
};

const draftFor = ({
  id,
  kind,
  position,
  waveIndex,
  waveExpiresAt,
  isWaveBoss = false,
  bossName,
}: {
  readonly id: string;
  readonly kind: EnemyKind;
  readonly position: Vector2;
  readonly waveIndex: number;
  readonly waveExpiresAt?: number;
  readonly isWaveBoss?: boolean;
  readonly bossName?: WaveBossName;
}): RuntimeEnemy => {
  const definition = enemyDefinitions[kind];
  const healthMultiplier = isWaveBoss
    ? gameplayTuning.waveBossHealthMultiplier
    : 1;
  const damageMultiplier = isWaveBoss
    ? gameplayTuning.waveBossDamageMultiplier
    : 1;
  return {
    id,
    kind,
    position: copyVector(position),
    spawnPosition: copyVector(position),
    hp: Math.ceil(definition.maxHp * healthMultiplier),
    maxHp: Math.ceil(definition.maxHp * healthMultiplier),
    damage: Math.max(1, Math.ceil(definition.damage * damageMultiplier)),
    dangerTier: isWaveBoss ? 5 : 1,
    dropMultiplier: isWaveBoss ? gameplayTuning.waveBossDropMultiplier : 1,
    moveSpeed: definition.moveSpeed,
    attackEverySeconds: definition.attackEverySeconds,
    respawnAt: null,
    defeated: false,
    attackElapsed: 0,
    waveIndex,
    ...(waveExpiresAt === undefined ? {} : { waveExpiresAt }),
    ...(isWaveBoss ? { isWaveBoss: true, bossName } : {}),
  };
};

/** Creates exactly five three-enemy groups and one large seeded boss. */
export const waveEnemyDraftsFor = ({
  seed,
  waveIndex,
  center,
}: {
  readonly seed: string;
  readonly waveIndex: number;
  readonly center: Vector2;
}): readonly RuntimeEnemy[] => {
  const phase = wavePhaseFor(waveIndex * gameplayTuning.waveIntervalSeconds);
  const normalEnemies = Array.from(
    {
      length:
        gameplayTuning.waveDensityMultiplier * gameplayTuning.waveBaseGroupSize,
    },
    (_, slot) => {
      const group = Math.floor(slot / gameplayTuning.waveBaseGroupSize);
      const member = slot % gameplayTuning.waveBaseGroupSize;
      const kind =
        normalKinds[
          hashText(
            `${seed}|wave:${waveIndex}|group:${group}|member:${member}`,
          ) % normalKinds.length
        ];
      return draftFor({
        id: `wave:${waveIndex}:group:${group}:enemy:${member}`,
        kind,
        position: spawnPositionFor(seed, waveIndex, slot, center),
        waveIndex,
        waveExpiresAt: phase.endsAt,
      });
    },
  );
  const bossName = waveBossNameFor(seed, waveIndex);
  return [
    ...normalEnemies,
    draftFor({
      id: `wave:${waveIndex}:boss:${bossName.toLowerCase().replaceAll(" ", "-")}`,
      kind: "boss",
      position: spawnPositionFor(seed, waveIndex, 99, center),
      waveIndex,
      isWaveBoss: true,
      bossName,
    }),
  ];
};
