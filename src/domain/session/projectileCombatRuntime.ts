import { enemyDefinitions } from "../../data/definitions";
import type { GameNotice } from "../notices";
import type { FloorDropState, UpgradeId } from "../types";
import { resourceKinds } from "../types";
import { selectBossUpgradeChoices } from "./bossUpgradeChoices";
import { advanceProjectileFlight } from "./combatPolicy";
import {
  floorDropDraftFor,
  projectileImpactResolutionFor,
} from "./combatResolutionPolicy";
import { scaleResourceBag } from "./economy";
import type { RuntimeEnemy, RuntimeProjectile } from "./sessionState";
import { copyVector } from "./sessionState";

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
  readonly experienceEarned: number;
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
      experienceEarned: 1,
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
    experienceEarned: 1,
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
  readonly experienceEarned: number;
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
  let experienceEarned = 0;

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
      experienceEarned += defeat.experienceEarned;
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
    experienceEarned,
  };
};
