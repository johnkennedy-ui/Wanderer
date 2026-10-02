import { towerCombatDefinitionFor } from "../../data/definitions";
import { distance, normalize } from "../math";
import {
  isTowerBuildingKind,
  type BuildingState,
  type TowerBuildingKind,
  type Vector2,
} from "../types";
import { liveTargetsInRange } from "./combatPolicy";
import type { MeleeImpact } from "./combatTickRuntime";
import type {
  RuntimeAttackPresentation,
  RuntimeCrescentAttack,
  RuntimeEnemy,
  RuntimeProjectile,
} from "./sessionState";

export interface TowerCombatPhaseInput {
  readonly delta: number;
  readonly buildings: readonly BuildingState[];
  readonly enemies: ReadonlyMap<string, RuntimeEnemy>;
  readonly projectiles: readonly RuntimeProjectile[];
  readonly elapsedByTowerId: ReadonlyMap<string, number>;
  readonly nextProjectileSerial: number;
  readonly nextAttackSequence: number;
  readonly isAttackBlocked: (from: Vector2, to: Vector2) => boolean;
}

export interface TowerCombatPhaseResult {
  readonly projectiles: RuntimeProjectile[];
  readonly meleeImpacts: readonly MeleeImpact[];
  readonly sweepAttacks: readonly RuntimeCrescentAttack[];
  readonly presentationAttacks: readonly RuntimeAttackPresentation[];
  readonly elapsedByTowerId: Map<string, number>;
  readonly nextProjectileSerial: number;
  readonly nextAttackSequence: number;
}

const isTowerBuilding = (
  building: BuildingState,
): building is BuildingState & { readonly kind: TowerBuildingKind } =>
  isTowerBuildingKind(building.kind);

/**
 * Advances autonomous towers in stable building-ID order. Tower cooldowns,
 * bolts and cues are runtime-only; the building record remains the sole save
 * authority. Walls and terrain are supplied as a line-of-sight policy by the
 * owning session.
 */
export const advanceTowerCombatPhase = ({
  delta,
  buildings,
  enemies,
  projectiles: currentProjectiles,
  elapsedByTowerId: currentElapsedByTowerId,
  nextProjectileSerial: initialProjectileSerial,
  nextAttackSequence: initialAttackSequence,
  isAttackBlocked,
}: TowerCombatPhaseInput): TowerCombatPhaseResult => {
  const projectiles = [...currentProjectiles];
  const meleeImpacts: MeleeImpact[] = [];
  const sweepAttacks: RuntimeCrescentAttack[] = [];
  const presentationAttacks: RuntimeAttackPresentation[] = [];
  const elapsedByTowerId = new Map<string, number>();
  let nextProjectileSerial = initialProjectileSerial;
  let nextAttackSequence = initialAttackSequence;

  for (const building of [...buildings].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (!isTowerBuilding(building)) continue;
    const tower = building;
    const definition = towerCombatDefinitionFor(tower.kind);
    const targets = liveTargetsInRange({
      playerPosition: tower.position,
      targets: enemies.values(),
      range: definition.range,
    }).filter((target) => !isAttackBlocked(tower.position, target.position));
    const target = targets[0];
    if (target === undefined) continue;

    const elapsed = (currentElapsedByTowerId.get(tower.id) ?? 0) + delta;
    if (elapsed < definition.attackEverySeconds) {
      elapsedByTowerId.set(tower.id, elapsed);
      continue;
    }
    elapsedByTowerId.set(tower.id, 0);
    const direction = normalize({
      x: target.position.x - tower.position.x,
      y: target.position.y - tower.position.y,
    });
    const sequence = nextAttackSequence;
    presentationAttacks.push({
      actorId: tower.id,
      sequence,
      direction,
      style: definition.attackStyle,
      durationSeconds: definition.presentationSeconds,
      committedAt: 0,
    });
    nextAttackSequence = sequence + 1;

    if (definition.attackStyle === "slash") {
      sweepAttacks.push({
        id: `tower-sweep:${tower.id}:${sequence.toString().padStart(4, "0")}`,
        origin: { ...tower.position },
        direction,
        radius: definition.range,
        arcCosine: -1,
        centered: true,
        elapsed: 0,
      });
      for (const candidate of targets)
        meleeImpacts.push({
          targetId: candidate.id,
          damage: definition.damage,
        });
      continue;
    }

    const splashTargets = targets
      .filter(
        (candidate) =>
          candidate.id !== target.id &&
          distance(candidate.position, target.position) <=
            (definition.splashRadius ?? 0),
      )
      .slice(0, definition.chainTargets ?? 0);
    projectiles.push({
      id: `tower-projectile:${nextProjectileSerial.toString().padStart(4, "0")}`,
      origin: { ...tower.position },
      targetId: target.id,
      targetPosition: { ...target.position },
      damage: definition.damage,
      chainTargetIds: splashTargets.map((candidate) => candidate.id),
      chainDamage: definition.damage * (definition.chainDamageMultiplier ?? 0),
      hitHeal: 0,
      style: definition.attackStyle,
      ...(definition.projectileVisual === undefined
        ? {}
        : { visual: definition.projectileVisual }),
      elapsed: 0,
    });
    nextProjectileSerial += 1;
  }

  return {
    projectiles,
    meleeImpacts,
    sweepAttacks,
    presentationAttacks,
    elapsedByTowerId,
    nextProjectileSerial,
    nextAttackSequence,
  };
};
