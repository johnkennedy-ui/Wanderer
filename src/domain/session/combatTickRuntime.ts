import { distance, normalize } from "../math";
import type { GameNotice } from "../notices";
import type {
  BuildingState,
  ClassProgression,
  MoveCommand,
  ReadonlyResourceBag,
  ResourceBag,
  UpgradeId,
  Vector2,
} from "../types";
import {
  classSecondaryTargetIdsFor,
  enemyPursuitPosition,
  liveTargetsInRange,
  projectileDraftFor,
  projectileLaunchDecision,
} from "./combatPolicy";
import {
  enemyAttackResolutionFor,
  enemyRespawnResolutionFor,
} from "./combatResolutionPolicy";
import { scaleResourceBag, subtractResourceBags } from "./economy";
import { playerHitRecoveryEndsAtFor } from "./hitRecoveryPolicy";
import {
  combatStatsFor,
  projectileUpgradeEffectsFor,
} from "./progressionRules";
import { deterministicChanceSucceeds } from "./deterministicRoll";
import type {
  RuntimeCrescentAttack,
  RuntimeEnemy,
  RuntimeProjectile,
  SettlementCampfire,
} from "./sessionState";
import { copyVector } from "./sessionState";

export interface CombatPlayerState {
  readonly position: Vector2;
  readonly hp: number;
  readonly maxHp: number;
}

const copyEnemy = (enemy: RuntimeEnemy): RuntimeEnemy => ({
  ...enemy,
  position: copyVector(enemy.position),
  spawnPosition: copyVector(enemy.spawnPosition),
});

const copyEnemies = (
  enemies: ReadonlyMap<string, RuntimeEnemy>,
): Map<string, RuntimeEnemy> =>
  new Map([...enemies].map(([id, enemy]) => [id, copyEnemy(enemy)]));

const copyProjectile = (projectile: RuntimeProjectile): RuntimeProjectile => ({
  ...projectile,
  origin: copyVector(projectile.origin),
  targetPosition: copyVector(projectile.targetPosition),
  chainTargetIds: [...projectile.chainTargetIds],
});

const copyCrescentAttack = (
  attack: RuntimeCrescentAttack,
): RuntimeCrescentAttack => ({
  ...attack,
  origin: copyVector(attack.origin),
  direction: copyVector(attack.direction),
});

export interface MeleeImpact {
  readonly targetId: string;
  readonly damage: number;
}

export interface AutoCombatPhaseInput {
  readonly delta: number;
  /** A moving class may accumulate attack time at a reduced, deterministic rate. */
  readonly attackSpeedMultiplier?: number;
  readonly playerPosition: Vector2;
  readonly enemies: ReadonlyMap<string, RuntimeEnemy>;
  readonly buildings: readonly BuildingState[];
  readonly upgrades: ReadonlySet<UpgradeId>;
  readonly classProgression?: ClassProgression;
  readonly projectiles: readonly RuntimeProjectile[];
  readonly crescentAttacks?: readonly RuntimeCrescentAttack[];
  readonly attackElapsed: number;
  readonly nextProjectileSerial: number;
  readonly nextCrescentSerial?: number;
  /** Runtime-only serial: one value per authored player attack event. */
  readonly nextAttackEventSerial?: number;
  readonly worldSeed?: string;
}

export interface AutoCombatPhaseResult {
  readonly projectiles: RuntimeProjectile[];
  readonly crescentAttacks: RuntimeCrescentAttack[];
  readonly meleeImpacts: readonly MeleeImpact[];
  readonly attackElapsed: number;
  readonly nextProjectileSerial: number;
  readonly nextCrescentSerial: number;
  readonly nextAttackEventSerial: number;
  readonly combatStatus: string;
}

/** Advances auto-combat and allocates one serial for every authored shot. */
export const advanceAutoCombatPhase = ({
  delta,
  attackSpeedMultiplier = 1,
  playerPosition,
  enemies,
  buildings,
  upgrades,
  classProgression,
  projectiles: currentProjectiles,
  crescentAttacks: currentCrescentAttacks = [],
  attackElapsed,
  nextProjectileSerial,
  nextCrescentSerial = 1,
  nextAttackEventSerial = 1,
  worldSeed = "combat-default-seed",
}: AutoCombatPhaseInput): AutoCombatPhaseResult => {
  const projectiles = currentProjectiles.map(copyProjectile);
  const crescentAttacks = currentCrescentAttacks
    .map((attack) => ({
      ...copyCrescentAttack(attack),
      elapsed: attack.elapsed + delta,
    }))
    .filter((attack) => attack.elapsed < 0.18);
  const stats = combatStatsFor(buildings, upgrades, classProgression);
  const targets = liveTargetsInRange({
    playerPosition,
    targets: enemies.values(),
    range: stats.attackRange,
  });
  const decision = projectileLaunchDecision({
    targets,
    attackElapsed,
    delta: delta * attackSpeedMultiplier,
    attackIntervalSeconds: stats.attackIntervalSeconds,
  });
  if (decision.kind === "no-target")
    return {
      projectiles,
      crescentAttacks,
      meleeImpacts: [],
      attackElapsed: decision.attackElapsed,
      nextProjectileSerial,
      nextCrescentSerial,
      nextAttackEventSerial,
      combatStatus: "Stationary: seeking a target",
    };

  const combatStatus = `Auto-attacking ${decision.target.kind} (${Math.ceil(
    decision.target.hp,
  )}/${decision.target.maxHp})`;
  if (decision.kind === "waiting")
    return {
      projectiles,
      crescentAttacks,
      meleeImpacts: [],
      attackElapsed: decision.attackElapsed,
      nextProjectileSerial,
      nextCrescentSerial,
      nextAttackEventSerial,
      combatStatus,
    };

  if (stats.attackStyle === "slash") {
    const critical = deterministicChanceSucceeds(stats.physicalCriticalChance, {
      worldSeed,
      domain: "physical-crit",
      eventSerial: nextAttackEventSerial,
    });
    const damage =
      stats.attackDamage *
      (critical ? stats.physicalCriticalDamageMultiplier : 1);
    const secondaryTargetIds = classSecondaryTargetIdsFor({
      style: stats.attackStyle,
      playerPosition,
      primaryTarget: decision.target,
      targets,
      maximumTargets: stats.chainTargets,
      areaRadius: stats.classAreaRadius,
      arcCosine: stats.classArcCosine,
    });
    const direction = normalize({
      x: decision.target.position.x - playerPosition.x,
      y: decision.target.position.y - playerPosition.y,
    });
    return {
      projectiles,
      crescentAttacks: [
        ...crescentAttacks,
        {
          id: `crescent:${nextCrescentSerial.toString().padStart(4, "0")}`,
          origin: copyVector(playerPosition),
          direction,
          radius: stats.classAreaRadius,
          arcCosine: stats.classArcCosine,
          elapsed: 0,
        },
      ],
      meleeImpacts: [
        { targetId: decision.target.id, damage },
        ...secondaryTargetIds.map((targetId) => ({
          targetId,
          damage: damage * stats.classSecondaryDamageMultiplier,
        })),
      ],
      attackElapsed: decision.attackElapsed,
      nextProjectileSerial,
      nextCrescentSerial: nextCrescentSerial + 1,
      nextAttackEventSerial: nextAttackEventSerial + 1,
      combatStatus,
    };
  }

  const projectileEffects = projectileUpgradeEffectsFor(
    upgrades,
    classProgression,
  );
  const shotTargets = Array.from(
    { length: stats.weaponProjectileCount },
    (_, index) => targets[index] ?? decision.target,
  );
  for (const [index, target] of shotTargets.entries()) {
    const classSecondaryTargetIds = classSecondaryTargetIdsFor({
      style: stats.attackStyle,
      playerPosition,
      primaryTarget: target,
      targets,
      maximumTargets: stats.chainTargets,
      areaRadius: stats.classAreaRadius,
      arcCosine: stats.classArcCosine,
    });
    const critical =
      stats.attackStyle !== "magic" &&
      deterministicChanceSucceeds(stats.physicalCriticalChance, {
        worldSeed,
        domain: "physical-crit",
        /* Archer relic shots must each have an independent authored roll. */
        eventSerial: nextAttackEventSerial * 1_024 + index,
      });
    const shotDamage =
      stats.attackDamage *
      stats.weaponProjectileDamageMultiplier *
      (critical ? stats.physicalCriticalDamageMultiplier : 1);
    const draft = projectileDraftFor({
      playerPosition,
      target,
      targets,
      attackDamage: shotDamage,
      chainTargets: 0,
      chainDamageMultiplier: 0,
      hitHeal: projectileEffects.hitHeal,
    });
    projectiles.push({
      id: `projectile:${(nextProjectileSerial + index)
        .toString()
        .padStart(4, "0")}`,
      ...draft,
      chainTargetIds: classSecondaryTargetIds,
      chainDamage:
        shotDamage *
        (stats.classSecondaryDamageMultiplier ||
          projectileEffects.chainDamageMultiplier),
      style: stats.attackStyle,
      ...(stats.weaponProjectileHoming ? { homing: true } : {}),
      elapsed: 0,
    });
  }
  return {
    projectiles,
    crescentAttacks,
    meleeImpacts: [],
    attackElapsed: decision.attackElapsed,
    nextProjectileSerial: nextProjectileSerial + shotTargets.length,
    nextCrescentSerial,
    nextAttackEventSerial: nextAttackEventSerial + 1,
    combatStatus,
  };
};

export interface EnemyCombatPhaseInput {
  readonly delta: number;
  readonly elapsed: number;
  readonly player: CombatPlayerState;
  readonly resources: ReadonlyResourceBag;
  readonly enemies: ReadonlyMap<string, RuntimeEnemy>;
  readonly committedSavePoint: SettlementCampfire;
  readonly input: MoveCommand;
  readonly destination: Vector2 | null;
  readonly attackElapsed: number;
  readonly enemyAttackStandoff: number;
  readonly deathResourceLossRate: number;
  /** End time for the player's transient post-hit protection window. */
  readonly playerHitRecoveryEndsAt?: number;
  readonly playerHitRecoverySeconds?: number;
  /** Current player-derived physical mitigation; omitted preserves legacy calls. */
  readonly playerPhysicalDefense?: number;
  readonly playerDodgeChance?: number;
  readonly worldSeed?: string;
}

export interface EnemyCombatPhaseResult {
  readonly player: CombatPlayerState;
  readonly resources: ResourceBag;
  readonly enemies: Map<string, RuntimeEnemy>;
  readonly input: MoveCommand;
  readonly destination: Vector2 | null;
  readonly attackElapsed: number;
  readonly playerHitRecoveryEndsAt: number;
  readonly notice: GameNotice | null;
  readonly resetHarvest: boolean;
}

/** Advances pursuit, respawn, and enemy attacks in their original phase order. */
export const advanceEnemyCombatPhase = ({
  delta,
  elapsed,
  player: currentPlayer,
  resources: currentResources,
  enemies: currentEnemies,
  committedSavePoint,
  input: currentInput,
  destination: currentDestination,
  attackElapsed,
  enemyAttackStandoff,
  deathResourceLossRate,
  playerHitRecoveryEndsAt: currentPlayerHitRecoveryEndsAt = 0,
  playerHitRecoverySeconds = 0,
  playerPhysicalDefense = 0,
  playerDodgeChance = 0,
  worldSeed = "combat-default-seed",
}: EnemyCombatPhaseInput): EnemyCombatPhaseResult => {
  const enemies = copyEnemies(currentEnemies);
  const player = {
    position: copyVector(currentPlayer.position),
    hp: currentPlayer.hp,
    maxHp: currentPlayer.maxHp,
  };
  const resources = { ...currentResources };
  const input = { ...currentInput, intent: copyVector(currentInput.intent) };
  const destination =
    currentDestination === null ? null : copyVector(currentDestination);
  let playerHitRecoveryEndsAt = currentPlayerHitRecoveryEndsAt;

  for (const enemy of enemies.values()) {
    if (enemy.defeated) continue;
    enemy.position = enemyPursuitPosition({
      enemyPosition: enemy.position,
      playerPosition: player.position,
      moveSpeed: enemy.moveSpeed,
      delta,
      attackStandoff: enemyAttackStandoff,
    });
  }
  for (const enemy of enemies.values()) {
    const resolution = enemyRespawnResolutionFor({
      defeated: enemy.defeated,
      respawnAt: enemy.respawnAt,
      elapsed,
      maxHp: enemy.maxHp,
      spawnPosition: enemy.spawnPosition,
    });
    if (resolution.kind !== "ready") continue;
    enemy.defeated = resolution.defeated;
    enemy.hp = resolution.hp;
    enemy.position = resolution.position;
    enemy.respawnAt = resolution.respawnAt;
    enemy.attackElapsed = resolution.attackElapsed;
  }
  for (const enemy of enemies.values()) {
    const resolution = enemyAttackResolutionFor({
      defeated: enemy.defeated,
      inAttackRange:
        distance(player.position, enemy.position) <= enemyAttackStandoff,
      attackElapsed: enemy.attackElapsed,
      attackEverySeconds: enemy.attackEverySeconds,
      damage: Math.max(1, enemy.damage - Math.max(0, playerPhysicalDefense)),
      playerHp: player.hp,
      delta,
    });
    if (resolution.kind === "inactive") continue;
    enemy.attackElapsed = resolution.attackElapsed;
    if (resolution.kind === "waiting") continue;
    const attackEventOrdinal = enemy.attackEventOrdinal ?? 0;
    enemy.attackEventOrdinal = attackEventOrdinal + 1;
    /* A recovery-protected attempt is still consumed before dodge/damage. */
    if (elapsed < playerHitRecoveryEndsAt) continue;
    if (
      deterministicChanceSucceeds(playerDodgeChance, {
        worldSeed,
        domain: "enemy-dodge",
        eventSerial: attackEventOrdinal,
        subjectId: enemy.id,
      })
    )
      continue;
    player.hp = resolution.nextPlayerHp;
    if (!resolution.playerDefeated) {
      playerHitRecoveryEndsAt = playerHitRecoveryEndsAtFor({
        elapsed,
        recoverySeconds: playerHitRecoverySeconds,
      });
      continue;
    }

    const carriedLoss = scaleResourceBag(resources, deathResourceLossRate);
    return {
      player: {
        position: copyVector(committedSavePoint.position),
        hp: player.maxHp,
        maxHp: player.maxHp,
      },
      resources: subtractResourceBags(resources, carriedLoss),
      enemies,
      input: { intent: { x: 0, y: 0 }, source: "system", at: elapsed },
      destination: null,
      attackElapsed: 0,
      playerHitRecoveryEndsAt: 0,
      notice: {
        kind: "player.died",
        savePointLabel: committedSavePoint.label,
        resourceLossRate: deathResourceLossRate,
      },
      resetHarvest: true,
    };
  }

  return {
    player,
    resources,
    enemies,
    input,
    destination,
    attackElapsed,
    playerHitRecoveryEndsAt,
    notice: null,
    resetHarvest: false,
  };
};
