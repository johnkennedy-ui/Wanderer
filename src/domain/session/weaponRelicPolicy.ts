import { distance } from "../math";
import type {
  ClassProgression,
  PlayerClass,
  Vector2,
  WeaponRelicDropState,
} from "../types";
import type { RuntimeEnemy } from "./sessionState";

const copyDrop = (drop: WeaponRelicDropState): WeaponRelicDropState => ({
  ...drop,
  position: { ...drop.position },
});

/** Creates one stable, visible relic identity from a timed-wave boss only. */
export const weaponRelicDropForWaveBoss = (
  enemy: RuntimeEnemy,
): WeaponRelicDropState | null => {
  if (
    enemy.isWaveBoss !== true ||
    enemy.waveIndex === undefined ||
    enemy.bossName === undefined
  )
    return null;
  return {
    id: `weapon-relic:${enemy.id}`,
    position: { ...enemy.position },
    waveIndex: enemy.waveIndex,
    bossName: enemy.bossName,
  };
};

export interface WeaponRelicCollectionInput {
  readonly playerPosition: Vector2;
  readonly drops: readonly WeaponRelicDropState[];
  readonly progression: ClassProgression;
  readonly collectDistance: number;
}

export interface WeaponRelicCollectionResult {
  readonly drops: readonly WeaponRelicDropState[];
  readonly progression: ClassProgression;
  readonly collectedRank: number | null;
  readonly playerClass: PlayerClass | null;
}

/**
 * Relics remain on the floor until a class has been selected. Each collected
 * wave-boss relic adds exactly one unbounded deterministic rank.
 */
export const collectNearbyWeaponRelics = ({
  playerPosition,
  drops,
  progression,
  collectDistance,
}: WeaponRelicCollectionInput): WeaponRelicCollectionResult => {
  if (progression.playerClass === null)
    return {
      drops: drops.map(copyDrop),
      progression: { ...progression, skillIds: [...progression.skillIds] },
      collectedRank: null,
      playerClass: null,
    };

  const nearby = drops.filter(
    (drop) => distance(playerPosition, drop.position) <= collectDistance,
  );
  if (nearby.length === 0)
    return {
      drops: drops.map(copyDrop),
      progression: { ...progression, skillIds: [...progression.skillIds] },
      collectedRank: null,
      playerClass: progression.playerClass,
    };

  const collectedIds = new Set(nearby.map((drop) => drop.id));
  const weaponRank = (progression.weaponRank ?? 0) + nearby.length;
  return {
    drops: drops.filter((drop) => !collectedIds.has(drop.id)).map(copyDrop),
    progression: {
      ...progression,
      skillIds: [...progression.skillIds],
      weaponRank,
    },
    collectedRank: weaponRank,
    playerClass: progression.playerClass,
  };
};
