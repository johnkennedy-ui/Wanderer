import { enemyDefinitions } from "../../data/definitions";
import type { GameNotice } from "../notices";
import type { FloorDropState, UpgradeId } from "../types";
import { resourceKinds } from "../types";
import { selectBossUpgradeChoices } from "./bossUpgradeChoices";
import { floorDropDraftFor } from "./combatResolutionPolicy";
import { scaleResourceBag } from "./economy";
import type { MeleeImpact } from "./combatTickRuntime";
import type { RuntimeEnemy } from "./sessionState";
import { copyVector } from "./sessionState";

const copyEnemy = (enemy: RuntimeEnemy): RuntimeEnemy => ({
  ...enemy,
  position: copyVector(enemy.position),
  spawnPosition: copyVector(enemy.spawnPosition),
});

const copyFloorDrop = (drop: FloorDropState): FloorDropState => ({
  ...drop,
  position: copyVector(drop.position),
});

export interface MeleeCombatPhaseInput {
  readonly impacts: readonly MeleeImpact[];
  readonly elapsed: number;
  readonly enemies: ReadonlyMap<string, RuntimeEnemy>;
  readonly floorDrops: readonly FloorDropState[];
  readonly defeatedBossIds: ReadonlySet<string>;
  readonly pendingUpgradeChoices: readonly UpgradeId[];
  readonly nextFloorDropSerial: number;
  readonly worldSeed: string;
  readonly upgrades: ReadonlySet<UpgradeId>;
  readonly floorDropOffsetDistance: number;
}

export interface MeleeCombatPhaseResult {
  readonly enemies: Map<string, RuntimeEnemy>;
  readonly floorDrops: FloorDropState[];
  readonly defeatedBossIds: Set<string>;
  readonly pendingUpgradeChoices: UpgradeId[];
  readonly nextFloorDropSerial: number;
  readonly notice: GameNotice | null;
  readonly experienceEarned: number;
}

/** Applies immediate crescent impacts in primary-then-secondary order. */
export const resolveMeleeCombatPhase = ({
  impacts,
  elapsed,
  enemies: currentEnemies,
  floorDrops: currentFloorDrops,
  defeatedBossIds: currentDefeatedBossIds,
  pendingUpgradeChoices: currentPendingUpgradeChoices,
  nextFloorDropSerial: currentFloorDropSerial,
  worldSeed,
  upgrades,
  floorDropOffsetDistance,
}: MeleeCombatPhaseInput): MeleeCombatPhaseResult => {
  const enemies = new Map(
    [...currentEnemies].map(([id, enemy]) => [id, copyEnemy(enemy)]),
  );
  let floorDrops = currentFloorDrops.map(copyFloorDrop);
  let defeatedBossIds = new Set(currentDefeatedBossIds);
  let pendingUpgradeChoices = [...currentPendingUpgradeChoices];
  let nextFloorDropSerial = currentFloorDropSerial;
  let notice: GameNotice | null = null;
  let experienceEarned = 0;

  for (const impact of impacts) {
    const enemy = enemies.get(impact.targetId);
    if (enemy === undefined || enemy.defeated) continue;
    enemy.hp -= impact.damage;
    if (enemy.hp > 0) continue;

    const definition = enemyDefinitions[enemy.kind];
    floorDrops = [
      ...floorDrops,
      ...floorDropDraftFor({
        enemyId: enemy.id,
        enemyPosition: enemy.position,
        serial: nextFloorDropSerial,
        resources: scaleResourceBag(definition.drops, enemy.dropMultiplier),
        resourceOrder: resourceKinds,
        rules: { offsetDistance: floorDropOffsetDistance },
      }),
    ];
    enemy.defeated = true;
    nextFloorDropSerial += 1;
    experienceEarned += 1;
    if (enemy.kind === "boss") {
      defeatedBossIds = new Set(defeatedBossIds).add(enemy.id);
      pendingUpgradeChoices = selectBossUpgradeChoices(worldSeed, upgrades);
      notice = {
        kind: "boss.defeated",
        hasUpgradeChoices: pendingUpgradeChoices.length === 3,
      };
    } else {
      const respawns = enemy.waveIndex === undefined;
      enemy.respawnAt = respawns
        ? elapsed + (definition.respawnSeconds ?? 0)
        : null;
      notice = {
        kind: "enemy.defeated",
        enemyKind: enemy.kind,
        respawns,
      };
    }
  }

  return {
    enemies,
    floorDrops,
    defeatedBossIds,
    pendingUpgradeChoices,
    nextFloorDropSerial,
    notice,
    experienceEarned,
  };
};
