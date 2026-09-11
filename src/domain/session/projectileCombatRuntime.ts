import { enemyDefinitions } from "../../data/definitions";
import { distance } from "../math";
import type { GameNotice } from "../notices";
import type { FloorDropState, UpgradeId, WeaponRelicDropState } from "../types";
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
import { weaponRelicDropForWaveBoss } from "./weaponRelicPolicy";

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

const copyWeaponRelicDrop = (
  drop: WeaponRelicDropState,
): WeaponRelicDropState => ({ ...drop, position: copyVector(drop.position) });

/** Keeps a relic-enabled magic projectile on a living deterministic target. */
const retargetHomingProjectile = (
  projectile: RuntimeProjectile,
  enemies: ReadonlyMap<string, RuntimeEnemy>,
): void => {
  if (projectile.homing !== true) return;
  const currentTarget = enemies.get(projectile.targetId);
  if (currentTarget !== undefined && !currentTarget.defeated) {
    projectile.targetPosition = copyVector(currentTarget.position);
    return;
  }
  const replacement = [...enemies.values()]
    .filter((enemy) => !enemy.defeated)
    .sort((left, right) => {
      const difference =
        distance(projectile.targetPosition, left.position) -
        distance(projectile.targetPosition, right.position);
      return difference === 0 ? left.id.localeCompare(right.id) : difference;
    })[0];
  if (replacement === undefined) return;
  projectile.targetId = replacement.id;
  projectile.targetPosition = copyVector(replacement.position);
};

interface EnemyDefeatInput {
  readonly enemy: RuntimeEnemy;
  readonly elapsed: number;
  readonly worldSeed: string;
  readonly upgrades: ReadonlySet<UpgradeId>;
  readonly floorDrops: readonly FloorDropState[];
  readonly weaponRelicDrops: readonly WeaponRelicDropState[];
  readonly defeatedBossIds: ReadonlySet<string>;
  readonly pendingUpgradeChoices: readonly UpgradeId[];
  readonly nextFloorDropSerial: number;
  readonly floorDropOffsetDistance: number;
}

interface EnemyDefeatResult {
  readonly floorDrops: FloorDropState[];
  readonly weaponRelicDrops: WeaponRelicDropState[];
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
  weaponRelicDrops,
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

  if (enemy.kind === "boss" && enemy.isWaveBoss === true) {
    const weaponRelicDrop = weaponRelicDropForWaveBoss(enemy);
    return {
      floorDrops: [...floorDrops.map(copyFloorDrop), ...draftedDrops],
      weaponRelicDrops:
        weaponRelicDrop === null
          ? weaponRelicDrops.map(copyWeaponRelicDrop)
          : [...weaponRelicDrops.map(copyWeaponRelicDrop), weaponRelicDrop],
      defeatedBossIds: new Set(defeatedBossIds),
      pendingUpgradeChoices: [...pendingUpgradeChoices],
      nextFloorDropSerial: nextFloorDropSerial + 1,
      notice: {
        kind: "weapon-relic.dropped",
        bossName: enemy.bossName ?? "large boss",
      },
      experienceEarned: 1,
    };
  }

  if (enemy.kind === "boss") {
    const nextDefeatedBossIds = new Set(defeatedBossIds).add(enemy.id);
    const pendingUpgradeChoices = selectBossUpgradeChoices(worldSeed, upgrades);
    return {
      floorDrops: [...floorDrops.map(copyFloorDrop), ...draftedDrops],
      weaponRelicDrops: weaponRelicDrops.map(copyWeaponRelicDrop),
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

  const respawns = enemy.waveIndex === undefined;
  enemy.respawnAt = respawns
    ? elapsed + (definition.respawnSeconds ?? 0)
    : null;
  return {
    floorDrops: [...floorDrops.map(copyFloorDrop), ...draftedDrops],
    weaponRelicDrops: weaponRelicDrops.map(copyWeaponRelicDrop),
    defeatedBossIds: new Set(defeatedBossIds),
    pendingUpgradeChoices: [...pendingUpgradeChoices],
    nextFloorDropSerial: nextFloorDropSerial + 1,
    notice: {
      kind: "enemy.defeated",
      enemyKind: enemy.kind,
      respawns,
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
  readonly weaponRelicDrops?: readonly WeaponRelicDropState[];
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
  readonly weaponRelicDrops: WeaponRelicDropState[];
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
  weaponRelicDrops: currentWeaponRelicDrops = [],
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
  let weaponRelicDrops = currentWeaponRelicDrops.map(copyWeaponRelicDrop);
  let defeatedBossIds = new Set(currentDefeatedBossIds);
  let pendingUpgradeChoices = [...currentPendingUpgradeChoices];
  let nextFloorDropSerial = currentFloorDropSerial;
  let nextPlayerHp = playerHp;
  let notice: GameNotice | null = null;
  let experienceEarned = 0;

  for (const current of currentProjectiles) {
    const projectile = copyProjectile(current);
    retargetHomingProjectile(projectile, enemies);
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
      chainTargetIds: projectile.chainTargetIds.filter(
        (targetId, index, ids) =>
          targetId !== projectile.targetId && ids.indexOf(targetId) === index,
      ),
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
        weaponRelicDrops,
        defeatedBossIds,
        pendingUpgradeChoices,
        nextFloorDropSerial,
        floorDropOffsetDistance,
      });
      floorDrops = defeat.floorDrops;
      weaponRelicDrops = defeat.weaponRelicDrops;
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
    weaponRelicDrops,
    defeatedBossIds,
    pendingUpgradeChoices,
    nextFloorDropSerial,
    notice,
    experienceEarned,
  };
};
