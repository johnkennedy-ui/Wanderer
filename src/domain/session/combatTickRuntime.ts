import { distance } from "../math";
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
import type {
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

export interface AutoCombatPhaseInput {
  readonly delta: number;
  readonly playerPosition: Vector2;
  readonly enemies: ReadonlyMap<string, RuntimeEnemy>;
  readonly buildings: readonly BuildingState[];
  readonly upgrades: ReadonlySet<UpgradeId>;
  readonly classProgression?: ClassProgression;
  readonly projectiles: readonly RuntimeProjectile[];
  readonly attackElapsed: number;
  readonly nextProjectileSerial: number;
}

export interface AutoCombatPhaseResult {
  readonly projectiles: RuntimeProjectile[];
  readonly attackElapsed: number;
  readonly nextProjectileSerial: number;
  readonly combatStatus: string;
}

/** Advances stationary auto-combat and allocates at most one projectile serial. */
export const advanceAutoCombatPhase = ({
  delta,
  playerPosition,
  enemies,
  buildings,
  upgrades,
  classProgression,
  projectiles: currentProjectiles,
  attackElapsed,
  nextProjectileSerial,
}: AutoCombatPhaseInput): AutoCombatPhaseResult => {
  const projectiles = currentProjectiles.map(copyProjectile);
  const stats = combatStatsFor(buildings, upgrades, classProgression);
  const targets = liveTargetsInRange({
    playerPosition,
    targets: enemies.values(),
    range: stats.attackRange,
  });
  const decision = projectileLaunchDecision({
    targets,
    attackElapsed,
    delta,
    attackIntervalSeconds: stats.attackIntervalSeconds,
  });
  if (decision.kind === "no-target")
    return {
      projectiles,
      attackElapsed: decision.attackElapsed,
      nextProjectileSerial,
      combatStatus: "Stationary: seeking a target",
    };

  const combatStatus = `Auto-attacking ${decision.target.kind} (${Math.ceil(
    decision.target.hp,
  )}/${decision.target.maxHp})`;
  if (decision.kind === "waiting")
    return {
      projectiles,
      attackElapsed: decision.attackElapsed,
      nextProjectileSerial,
      combatStatus,
    };

  const projectileEffects = projectileUpgradeEffectsFor(
    upgrades,
    classProgression,
  );
  const classSecondaryTargetIds = classSecondaryTargetIdsFor({
    style: stats.attackStyle,
    playerPosition,
    primaryTarget: decision.target,
    targets,
    maximumTargets: stats.chainTargets,
    areaRadius: stats.classAreaRadius,
    arcCosine: stats.classArcCosine,
  });
  const draft = projectileDraftFor({
    playerPosition,
    target: decision.target,
    targets,
    attackDamage: stats.attackDamage,
    chainTargets: 0,
    chainDamageMultiplier: 0,
    hitHeal: projectileEffects.hitHeal,
  });
  projectiles.push({
    id: `projectile:${nextProjectileSerial.toString().padStart(4, "0")}`,
    ...draft,
    chainTargetIds: classSecondaryTargetIds,
    chainDamage:
      stats.attackDamage *
      (stats.classSecondaryDamageMultiplier ||
        projectileEffects.chainDamageMultiplier),
    style: stats.attackStyle,
    elapsed: 0,
  });
  return {
    projectiles,
    attackElapsed: decision.attackElapsed,
    nextProjectileSerial: nextProjectileSerial + 1,
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
      damage: enemy.damage,
      playerHp: player.hp,
      delta,
    });
    if (resolution.kind === "inactive") continue;
    enemy.attackElapsed = resolution.attackElapsed;
    if (resolution.kind === "waiting") continue;
    if (elapsed < playerHitRecoveryEndsAt) continue;
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
