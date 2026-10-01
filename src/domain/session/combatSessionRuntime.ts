import { gameplayTuning } from "../../data/definitions";
import type {
  ClassProgression,
  BuildingState,
  FloorDropState,
  MoveCommand,
  PlayerState,
  ResourceBag,
  UpgradeId,
  Vector2,
  WeaponRelicDropState,
  WorldIdentity,
} from "../types";
import {
  enemyTerrainClearanceFor,
  terrainBlocksPosition,
} from "../world/terrainCollision";
import { terrainBlocksProjectileSegment } from "../world/projectileCollision";
import {
  nearestWallSafePosition,
  shortestWallRoute,
  wallBlocksSegment,
} from "./buildingGeometry";
import {
  advanceAutoCombatPhase,
  advanceEnemyCombatPhase,
  type MeleeImpact,
} from "./combatTickRuntime";
import type { ChunkRecipeSource } from "./chunkRecipeCache";
import { EnemyNavigationCache } from "./enemyNavigation";
import { resolveMeleeCombatPhase } from "./meleeCombatRuntime";
import { constrainMovement } from "./movementRuntime";
import { advanceProjectileCombatPhase } from "./projectileCombatRuntime";
import { combatStatsFor } from "./progressionRules";
import { advanceTowerCombatPhase } from "./towerCombatRuntime";
import type {
  RuntimeCrescentAttack,
  RuntimeEnemy,
  RuntimeProjectile,
  SettlementCampfire,
} from "./sessionState";

export const autoCombatPhaseFor = ({
  delta,
  attackSpeedMultiplier,
  playerPosition,
  enemies,
  buildings,
  upgrades,
  classProgression,
  projectiles,
  crescentAttacks,
  attackElapsed,
  nextProjectileSerial,
  nextCrescentSerial,
  nextAttackEventSerial,
  worldSeed,
}: {
  readonly delta: number;
  readonly attackSpeedMultiplier: number;
  readonly playerPosition: Vector2;
  readonly enemies: ReadonlyMap<string, RuntimeEnemy>;
  readonly buildings: readonly BuildingState[];
  readonly upgrades: ReadonlySet<UpgradeId>;
  readonly classProgression: ClassProgression;
  readonly projectiles: readonly RuntimeProjectile[];
  readonly crescentAttacks: readonly RuntimeCrescentAttack[];
  readonly attackElapsed: number;
  readonly nextProjectileSerial: number;
  readonly nextCrescentSerial: number;
  readonly nextAttackEventSerial: number;
  readonly worldSeed: string;
}) =>
  advanceAutoCombatPhase({
    delta,
    attackSpeedMultiplier,
    playerPosition,
    enemies,
    buildings,
    isAttackBlocked: (from, to) => wallBlocksSegment(from, to, buildings),
    upgrades,
    classProgression,
    projectiles,
    crescentAttacks,
    attackElapsed,
    nextProjectileSerial,
    nextCrescentSerial,
    nextAttackEventSerial,
    worldSeed,
  });

export const meleeCombatPhaseFor = ({
  impacts,
  elapsed,
  enemies,
  floorDrops,
  weaponRelicDrops,
  defeatedBossIds,
  pendingUpgradeChoices,
  nextFloorDropSerial,
  worldSeed,
  upgrades,
}: {
  readonly impacts: readonly MeleeImpact[];
  readonly elapsed: number;
  readonly enemies: ReadonlyMap<string, RuntimeEnemy>;
  readonly floorDrops: readonly FloorDropState[];
  readonly weaponRelicDrops: readonly WeaponRelicDropState[];
  readonly defeatedBossIds: ReadonlySet<string>;
  readonly pendingUpgradeChoices: readonly UpgradeId[];
  readonly nextFloorDropSerial: number;
  readonly worldSeed: string;
  readonly upgrades: ReadonlySet<UpgradeId>;
}) =>
  resolveMeleeCombatPhase({
    impacts,
    elapsed,
    enemies,
    floorDrops,
    weaponRelicDrops,
    defeatedBossIds,
    pendingUpgradeChoices,
    nextFloorDropSerial,
    worldSeed,
    upgrades,
    floorDropOffsetDistance: gameplayTuning.floorDropOffsetDistance,
  });

/** Runs every persistent tower through one shared terrain/wall line-of-sight policy. */
export const towerCombatPhaseFor = ({
  delta,
  buildings,
  enemies,
  projectiles,
  elapsedByTowerId,
  nextProjectileSerial,
  nextAttackSequence,
  world,
  chunkRecipeSource,
}: {
  readonly delta: number;
  readonly buildings: readonly BuildingState[];
  readonly enemies: ReadonlyMap<string, RuntimeEnemy>;
  readonly projectiles: readonly RuntimeProjectile[];
  readonly elapsedByTowerId: ReadonlyMap<string, number>;
  readonly nextProjectileSerial: number;
  readonly nextAttackSequence: number;
  readonly world: WorldIdentity;
  readonly chunkRecipeSource: ChunkRecipeSource;
}) =>
  advanceTowerCombatPhase({
    delta,
    buildings,
    enemies,
    projectiles,
    elapsedByTowerId,
    nextProjectileSerial,
    nextAttackSequence,
    isAttackBlocked: (from, to) =>
      wallBlocksSegment(from, to, buildings) ||
      terrainBlocksProjectileSegment(world, from, to, chunkRecipeSource),
  });

export const projectileCombatPhaseFor = ({
  delta,
  elapsed,
  player,
  enemies,
  projectiles,
  floorDrops,
  weaponRelicDrops,
  defeatedBossIds,
  pendingUpgradeChoices,
  nextFloorDropSerial,
  world,
  upgrades,
  buildings,
  chunkRecipeSource,
}: {
  readonly delta: number;
  readonly elapsed: number;
  readonly player: PlayerState;
  readonly enemies: ReadonlyMap<string, RuntimeEnemy>;
  readonly projectiles: readonly RuntimeProjectile[];
  readonly floorDrops: readonly FloorDropState[];
  readonly weaponRelicDrops: readonly WeaponRelicDropState[];
  readonly defeatedBossIds: ReadonlySet<string>;
  readonly pendingUpgradeChoices: readonly UpgradeId[];
  readonly nextFloorDropSerial: number;
  readonly world: WorldIdentity;
  readonly upgrades: ReadonlySet<UpgradeId>;
  readonly buildings: readonly BuildingState[];
  readonly chunkRecipeSource: ChunkRecipeSource;
}) =>
  advanceProjectileCombatPhase({
    delta,
    elapsed,
    playerHp: player.hp,
    playerMaxHp: player.maxHp,
    enemies,
    projectiles,
    floorDrops,
    weaponRelicDrops,
    defeatedBossIds,
    pendingUpgradeChoices,
    nextFloorDropSerial,
    worldSeed: world.seed,
    upgrades,
    projectileTravelSeconds: gameplayTuning.basicProjectileTravelSeconds,
    floorDropOffsetDistance: gameplayTuning.floorDropOffsetDistance,
    isFlightBlocked: (from, to) =>
      wallBlocksSegment(from, to, buildings) ||
      terrainBlocksProjectileSegment(world, from, to, chunkRecipeSource),
  });

export const enemyCombatPhaseFor = ({
  delta,
  elapsed,
  player,
  resources,
  enemies,
  committedSavePoint,
  input,
  destination,
  attackElapsed,
  playerHitRecoveryEndsAt,
  world,
  buildings,
  classProgression,
  upgrades,
  chunkRecipeSource,
  enemyNavigation,
}: {
  readonly delta: number;
  readonly elapsed: number;
  readonly player: PlayerState;
  readonly resources: ResourceBag;
  readonly enemies: ReadonlyMap<string, RuntimeEnemy>;
  readonly committedSavePoint: SettlementCampfire;
  readonly input: MoveCommand;
  readonly destination: Vector2 | null;
  readonly attackElapsed: number;
  readonly playerHitRecoveryEndsAt: number;
  readonly world: WorldIdentity;
  readonly buildings: readonly BuildingState[];
  readonly classProgression: ClassProgression;
  readonly upgrades: ReadonlySet<UpgradeId>;
  readonly chunkRecipeSource: ChunkRecipeSource;
  readonly enemyNavigation: EnemyNavigationCache;
}) => {
  const {
    physicalDefense: playerPhysicalDefense,
    dodgeChance: playerDodgeChance,
  } = combatStatsFor(buildings, upgrades, classProgression);
  return advanceEnemyCombatPhase({
    delta,
    elapsed,
    player,
    resources,
    enemies,
    committedSavePoint,
    input,
    destination,
    attackElapsed,
    enemyAttackStandoff: gameplayTuning.enemyAttackStandoff,
    deathResourceLossRate: gameplayTuning.deathResourceLossRate,
    playerHitRecoveryEndsAt,
    playerHitRecoverySeconds: gameplayTuning.playerHitRecoverySeconds,
    playerPhysicalDefense,
    playerDodgeChance,
    worldSeed: world.seed,
    isAttackBlocked: (from, to) => wallBlocksSegment(from, to, buildings),
    resolveEnemyRespawnPosition: (position, enemy) => {
      const clearance = enemyTerrainClearanceFor(enemy.kind);
      return nearestWallSafePosition(
        position,
        buildings,
        clearance,
        (candidate) =>
          terrainBlocksPosition(world, candidate, chunkRecipeSource, clearance),
      );
    },
    constrainEnemyPosition: (from, desired, enemy) => {
      const clearance = enemyTerrainClearanceFor(enemy.kind);
      return enemyNavigation.route({
        from,
        desired,
        target: player.position,
        enemyId: enemy.id,
        shortestWallRoute: () =>
          wallBlocksSegment(from, desired, buildings, clearance)
            ? shortestWallRoute(from, player.position, buildings, clearance)
            : null,
        constrain: (routeFrom, routeDesired) =>
          constrainMovement({
            world,
            from: routeFrom,
            desired: routeDesired,
            chunkRecipeSource,
            buildings,
            clearance,
          }),
      });
    },
  });
};
