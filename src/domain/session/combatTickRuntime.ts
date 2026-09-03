import { enemyDefinitions } from "../../data/definitions";
import { distance } from "../math";
import type { GameNotice } from "../notices";
import type {
  BuildingState,
  FloorDropState,
  MoveCommand,
  ReadonlyResourceBag,
  ResourceBag,
  UpgradeId,
  Vector2,
} from "../types";
import { resourceKinds } from "../types";
import { selectBossUpgradeChoices } from "./bossUpgradeChoices";
import {
  advanceProjectileFlight,
  enemyPursuitPosition,
  liveTargetsInRange,
  projectileDraftFor,
  projectileLaunchDecision,
} from "./combatPolicy";
import {
  enemyAttackResolutionFor,
  enemyRespawnResolutionFor,
  floorDropDraftFor,
  projectileImpactResolutionFor,
} from "./combatResolutionPolicy";
import { scaleResourceBag, subtractResourceBags } from "./economy";
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

const copyFloorDrop = (drop: FloorDropState): FloorDropState => ({
  ...drop,
  position: copyVector(drop.position),
});

interface EnemyDefeatInput {
  readonly enemy: RuntimeEnemy;
  readonly elapsed: number;
  readonly worldSeed: string;
  readonly upgrades: ReadonlySet<UpgradeId>;
  readonly floorDrops: readonly FloorDropState[];
  readonly defeatedBossIds: ReadonlySet<string>;
  readonly pendingUpgradeChoices: readonly UpgradeId[];
  readonly nextFloorDropSerial: number;
  readonly floorDropOffsetDistance: number;
}

interface EnemyDefeatResult {
  readonly floorDrops: FloorDropState[];
  readonly defeatedBossIds: Set<string>;
  readonly pendingUpgradeChoices: UpgradeId[];
  readonly nextFloorDropSerial: number;
  readonly notice: GameNotice;
}

const defeatEnemy = ({
  enemy,
  elapsed,
  worldSeed,
  upgrades,
  floorDrops,
  defeatedBossIds,
  pendingUpgradeChoices,
  nextFloorDropSerial,
  floorDropOffsetDistance,
}: EnemyDefeatInput): EnemyDefeatResult => {
  const definition = enemyDefinitions[enemy.kind];
  const draftedDrops = floorDropDraftFor({
    enemyId: enemy.id,
    enemyPosition: enemy.position,
    serial: nextFloorDropSerial,
    resources: scaleResourceBag(definition.drops, enemy.dropMultiplier),
    resourceOrder: resourceKinds,
    rules: { offsetDistance: floorDropOffsetDistance },
  });
  enemy.defeated = true;

  if (enemy.kind === "boss") {
    const nextDefeatedBossIds = new Set(defeatedBossIds).add(enemy.id);
    const pendingUpgradeChoices = selectBossUpgradeChoices(worldSeed, upgrades);
    return {
      floorDrops: [...floorDrops.map(copyFloorDrop), ...draftedDrops],
      defeatedBossIds: nextDefeatedBossIds,
      pendingUpgradeChoices,
      nextFloorDropSerial: nextFloorDropSerial + 1,
      notice: {
        kind: "boss.defeated",
        hasUpgradeChoices: pendingUpgradeChoices.length === 3,
      },
    };
  }

  enemy.respawnAt = elapsed + (definition.respawnSeconds ?? 0);
  return {
    floorDrops: [...floorDrops.map(copyFloorDrop), ...draftedDrops],
    defeatedBossIds: new Set(defeatedBossIds),
    pendingUpgradeChoices: [...pendingUpgradeChoices],
    nextFloorDropSerial: nextFloorDropSerial + 1,
    notice: {
      kind: "enemy.defeated",
      enemyKind: enemy.kind,
      respawns: true,
    },
  };
};

export interface ProjectileCombatPhaseInput {
  readonly delta: number;
  readonly elapsed: number;
  readonly playerHp: number;
  readonly playerMaxHp: number;
  readonly enemies: ReadonlyMap<string, RuntimeEnemy>;
  readonly projectiles: readonly RuntimeProjectile[];
  readonly floorDrops: readonly FloorDropState[];
  readonly defeatedBossIds: ReadonlySet<string>;
  readonly pendingUpgradeChoices: readonly UpgradeId[];
  readonly nextFloorDropSerial: number;
  readonly worldSeed: string;
  readonly upgrades: ReadonlySet<UpgradeId>;
  readonly projectileTravelSeconds: number;
  readonly floorDropOffsetDistance: number;
}

export interface ProjectileCombatPhaseResult {
  readonly playerHp: number;
  readonly enemies: Map<string, RuntimeEnemy>;
  readonly projectiles: RuntimeProjectile[];
  readonly floorDrops: FloorDropState[];
  readonly defeatedBossIds: Set<string>;
  readonly pendingUpgradeChoices: UpgradeId[];
  readonly nextFloorDropSerial: number;
  readonly notice: GameNotice | null;
}

/** Advances projectile flight and resolves completed impacts without mutating inputs. */
export const advanceProjectileCombatPhase = ({
  delta,
  elapsed,
  playerHp,
  playerMaxHp,
  enemies: currentEnemies,
  projectiles: currentProjectiles,
  floorDrops: currentFloorDrops,
  defeatedBossIds: currentDefeatedBossIds,
  pendingUpgradeChoices: currentPendingUpgradeChoices,
  nextFloorDropSerial: currentFloorDropSerial,
  worldSeed,
  upgrades,
  projectileTravelSeconds,
  floorDropOffsetDistance,
}: ProjectileCombatPhaseInput): ProjectileCombatPhaseResult => {
  const enemies = copyEnemies(currentEnemies);
  const projectiles: RuntimeProjectile[] = [];
  const completed: RuntimeProjectile[] = [];
  let floorDrops = currentFloorDrops.map(copyFloorDrop);
  let defeatedBossIds = new Set(currentDefeatedBossIds);
  let pendingUpgradeChoices = [...currentPendingUpgradeChoices];
  let nextFloorDropSerial = currentFloorDropSerial;
  let nextPlayerHp = playerHp;
  let notice: GameNotice | null = null;

  for (const current of currentProjectiles) {
    const projectile = copyProjectile(current);
    const flight = advanceProjectileFlight({
      elapsed: projectile.elapsed,
      delta,
      travelSeconds: projectileTravelSeconds,
    });
    projectile.elapsed = flight.elapsed;
    (flight.completed ? completed : projectiles).push(projectile);
  }

  for (const projectile of completed) {
    const resolution = projectileImpactResolutionFor({
      targets: enemies,
      primaryTargetId: projectile.targetId,
      primaryDamage: projectile.damage,
      chainTargetIds: projectile.chainTargetIds,
      chainDamage: projectile.chainDamage,
    });
    for (const impact of resolution.impacts) {
      const enemy = enemies.get(impact.targetId);
      if (enemy === undefined || enemy.defeated) continue;
      enemy.hp = impact.nextHp;
      if (!impact.lethal) continue;
      const defeat = defeatEnemy({
        enemy,
        elapsed,
        worldSeed,
        upgrades,
        floorDrops,
        defeatedBossIds,
        pendingUpgradeChoices,
        nextFloorDropSerial,
        floorDropOffsetDistance,
      });
      floorDrops = defeat.floorDrops;
      defeatedBossIds = defeat.defeatedBossIds;
      pendingUpgradeChoices = defeat.pendingUpgradeChoices;
      nextFloorDropSerial = defeat.nextFloorDropSerial;
      notice = defeat.notice;
    }
    if (resolution.landedHitCount > 0 && projectile.hitHeal > 0)
      nextPlayerHp = Math.min(
        playerMaxHp,
        nextPlayerHp + resolution.landedHitCount * projectile.hitHeal,
      );
  }

  return {
    playerHp: nextPlayerHp,
    enemies,
    projectiles,
    floorDrops,
    defeatedBossIds,
    pendingUpgradeChoices,
    nextFloorDropSerial,
    notice,
  };
};

export interface AutoCombatPhaseInput {
  readonly delta: number;
  readonly playerPosition: Vector2;
  readonly enemies: ReadonlyMap<string, RuntimeEnemy>;
  readonly buildings: readonly BuildingState[];
  readonly upgrades: ReadonlySet<UpgradeId>;
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
  projectiles: currentProjectiles,
  attackElapsed,
  nextProjectileSerial,
}: AutoCombatPhaseInput): AutoCombatPhaseResult => {
  const projectiles = currentProjectiles.map(copyProjectile);
  const stats = combatStatsFor(buildings, upgrades);
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

  const projectileEffects = projectileUpgradeEffectsFor(upgrades);
  const draft = projectileDraftFor({
    playerPosition,
    target: decision.target,
    targets,
    attackDamage: stats.attackDamage,
    chainTargets: stats.chainTargets,
    chainDamageMultiplier: projectileEffects.chainDamageMultiplier,
    hitHeal: projectileEffects.hitHeal,
  });
  projectiles.push({
    id: `projectile:${nextProjectileSerial.toString().padStart(4, "0")}`,
    ...draft,
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
}

export interface EnemyCombatPhaseResult {
  readonly player: CombatPlayerState;
  readonly resources: ResourceBag;
  readonly enemies: Map<string, RuntimeEnemy>;
  readonly input: MoveCommand;
  readonly destination: Vector2 | null;
  readonly attackElapsed: number;
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
    player.hp = resolution.nextPlayerHp;
    if (!resolution.playerDefeated) continue;

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
    notice: null,
    resetHarvest: false,
  };
};
