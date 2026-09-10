import { copyGameNotice } from "../notices";
import type {
  GameNotice,
  GamePresentation,
  PlayerHitRecoveryPresentation,
  WaveStatus,
} from "../notices";
import type {
  BuildingState,
  ClassProgression,
  ClassSkillId,
  CrescentAttackState,
  ChunkRecipe,
  EnemyKind,
  FloorDropState,
  InputSource,
  PlayerClass,
  PlayerState,
  PlayerStats,
  ReadonlyResourceBag,
  UpgradeId,
  Vector2,
  WeaponRelicDropState,
  WorldIdentity,
} from "../types";
import { chunkCoordinateFor, chunkKey } from "../world";
import { cloneResources, copyVector } from "./sessionState";

/** The runtime enemy facts needed to construct a read model. */
export interface ReadModelEnemyInput {
  readonly id: string;
  readonly kind: EnemyKind;
  readonly position: Vector2;
  readonly hp: number;
  readonly maxHp: number;
  readonly damage: number;
  readonly dangerTier: number;
  readonly respawnAt: number | null;
  readonly defeated: boolean;
  readonly isWaveBoss?: boolean;
  readonly bossName?: string;
}

/** The runtime projectile facts needed to construct a read model. */
export interface ReadModelProjectileInput {
  readonly id: string;
  readonly origin: Vector2;
  readonly targetId: string;
  readonly targetPosition: Vector2;
  readonly elapsed: number;
  readonly style?: "basic" | "slash" | "magic" | "arrow";
  readonly homing?: boolean;
}

export interface ReadModelCrescentAttackInput {
  readonly id: string;
  readonly origin: Vector2;
  readonly direction: Vector2;
  readonly radius: number;
  readonly arcCosine: number;
  readonly elapsed: number;
}

/** Explicit facts from which the two narrow presentation views are built. */
export interface PresentationProjectionInput {
  readonly world: WorldIdentity;
  readonly player: PlayerState;
  readonly playerStats: PlayerStats;
  readonly playerHitRecovery: PlayerHitRecoveryPresentation;
  readonly resources: ReadonlyResourceBag;
  readonly buildings: readonly BuildingState[];
  readonly enemies: ReadonlyMap<string, ReadModelEnemyInput>;
  readonly projectiles: readonly ReadModelProjectileInput[];
  readonly crescentAttacks: readonly ReadModelCrescentAttackInput[];
  readonly floorDrops: readonly FloorDropState[];
  readonly weaponRelicDrops: readonly WeaponRelicDropState[];
  readonly visibleChunks: readonly ChunkRecipe[];
  readonly materialCapacity: number;
  readonly buildRadius: number;
  readonly inputSource: InputSource;
  readonly combatStatus: string;
  readonly wave: WaveStatus;
  readonly effects: readonly string[];
  readonly pendingUpgradeChoices: readonly UpgradeId[];
  readonly classProgression: ClassProgression;
  readonly pendingClassChoices: readonly PlayerClass[];
  readonly pendingClassSkillChoices: readonly ClassSkillId[];
  readonly canSave: boolean;
  readonly savePointLabel: string | null;
  readonly notice: GameNotice;
  readonly projectileTravelSeconds: number;
}

/**
 * Builds one current presentation result without observing or mutating a
 * GameSession. The caller owns gameplay-derived values and visible chunks;
 * this builder only copies and composes their narrow read-model views.
 */
export const projectGamePresentation = (
  input: PresentationProjectionInput,
): GamePresentation => {
  const visibleChunkKeys = new Set(
    input.visibleChunks.map((chunk) => chunk.key),
  );
  const world = { ...input.world };
  const player = {
    position: copyVector(input.player.position),
    hp: input.player.hp,
    maxHp: input.player.maxHp,
  };
  const playerStats = { ...input.playerStats };
  const playerHitRecovery = { ...input.playerHitRecovery };
  const resources = cloneResources(input.resources);
  const buildings = input.buildings.map((building) => ({
    ...building,
    position: copyVector(building.position),
  }));
  const visibleBuildings = buildings.filter((building) =>
    visibleChunkKeys.has(chunkKey(chunkCoordinateFor(building.position))),
  );
  const enemies = [...input.enemies.values()]
    .filter(
      (enemy) =>
        !enemy.defeated &&
        visibleChunkKeys.has(chunkKey(chunkCoordinateFor(enemy.position))),
    )
    .map((enemy) => ({
      id: enemy.id,
      kind: enemy.kind,
      position: copyVector(enemy.position),
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      damage: enemy.damage,
      dangerTier: enemy.dangerTier,
      respawnAt: enemy.respawnAt,
      defeated: enemy.defeated,
      ...(enemy.isWaveBoss === true
        ? { isWaveBoss: true, bossName: enemy.bossName }
        : {}),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const projectiles = input.projectiles.map((projectile) => {
    const target = input.enemies.get(projectile.targetId);
    return {
      id: projectile.id,
      origin: copyVector(projectile.origin),
      targetId: projectile.targetId,
      targetPosition: copyVector(
        target !== undefined && !target.defeated
          ? target.position
          : projectile.targetPosition,
      ),
      progress: Math.min(1, projectile.elapsed / input.projectileTravelSeconds),
      style: projectile.style ?? "basic",
      ...(projectile.homing === true ? { homing: true } : {}),
    };
  });
  const crescentAttacks: readonly CrescentAttackState[] =
    input.crescentAttacks.map((attack) => ({
      id: attack.id,
      origin: copyVector(attack.origin),
      direction: copyVector(attack.direction),
      radius: attack.radius,
      arcCosine: attack.arcCosine,
      progress: Math.min(1, attack.elapsed / 0.18),
    }));
  const floorDrops = input.floorDrops
    .filter((drop) =>
      visibleChunkKeys.has(chunkKey(chunkCoordinateFor(drop.position))),
    )
    .map((drop) => ({
      ...drop,
      position: copyVector(drop.position),
    }));
  const weaponRelicDrops = input.weaponRelicDrops
    .filter((drop) =>
      visibleChunkKeys.has(chunkKey(chunkCoordinateFor(drop.position))),
    )
    .map((drop) => ({ ...drop, position: copyVector(drop.position) }));
  const notice = copyGameNotice(input.notice);
  const ui = {
    world,
    player,
    playerStats,
    resources,
    materialCapacity: input.materialCapacity,
    buildRadius: input.buildRadius,
    inputSource: input.inputSource,
    combatStatus: input.combatStatus,
    wave: { ...input.wave },
    projectileCount: projectiles.length,
    buildings,
    effects: input.effects,
    pendingUpgradeChoices: input.pendingUpgradeChoices,
    classProgression: {
      ...input.classProgression,
      skillIds: [...input.classProgression.skillIds],
      weaponRank: input.classProgression.weaponRank ?? 0,
    },
    pendingClassChoices: [...input.pendingClassChoices],
    pendingClassSkillChoices: [...input.pendingClassSkillChoices],
    weaponRelicDropCount: weaponRelicDrops.length,
    canSave: input.canSave,
    savePointLabel: input.savePointLabel,
    notice,
  };
  const renderer = {
    player,
    playerHitRecovery,
    enemies,
    projectiles,
    crescentAttacks,
    floorDrops,
    weaponRelicDrops,
    visibleBuildings,
    visibleChunks: input.visibleChunks,
  };
  return { ui, renderer };
};
