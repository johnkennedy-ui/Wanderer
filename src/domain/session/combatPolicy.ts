import { add, distance, magnitude, normalize, scale } from "../math";
import type { Vector2 } from "../types";

export interface CombatTarget {
  readonly id: string;
  readonly position: Vector2;
  readonly defeated: boolean;
}

export interface LiveTargetsInRangeInput<Target extends CombatTarget> {
  readonly playerPosition: Vector2;
  readonly targets: Iterable<Target>;
  readonly range: number;
}

/** Returns live in-range targets ordered by distance, then their stable IDs. */
export const liveTargetsInRange = <Target extends CombatTarget>({
  playerPosition,
  targets,
  range,
}: LiveTargetsInRangeInput<Target>): Target[] =>
  [...targets]
    .filter(
      (target) =>
        !target.defeated && distance(playerPosition, target.position) <= range,
    )
    .sort((left, right) => {
      const difference =
        distance(playerPosition, left.position) -
        distance(playerPosition, right.position);
      return difference === 0 ? left.id.localeCompare(right.id) : difference;
    });

export interface ProjectileLaunchInput<Target extends CombatTarget> {
  readonly targets: readonly Target[];
  readonly attackElapsed: number;
  readonly delta: number;
  readonly attackIntervalSeconds: number;
}

export type ProjectileLaunchDecision<Target extends CombatTarget> =
  | { readonly kind: "no-target"; readonly attackElapsed: 0 }
  | {
      readonly kind: "waiting";
      readonly target: Target;
      readonly attackElapsed: number;
    }
  | {
      readonly kind: "ready";
      readonly target: Target;
      readonly attackElapsed: 0;
    };

/** Classifies a stationary auto-attack without allocating a projectile serial. */
export const projectileLaunchDecision = <Target extends CombatTarget>({
  targets,
  attackElapsed,
  delta,
  attackIntervalSeconds,
}: ProjectileLaunchInput<Target>): ProjectileLaunchDecision<Target> => {
  const target = targets[0];
  if (target === undefined) return { kind: "no-target", attackElapsed: 0 };

  const nextAttackElapsed = attackElapsed + delta;
  if (nextAttackElapsed < attackIntervalSeconds)
    return {
      kind: "waiting",
      target,
      attackElapsed: nextAttackElapsed,
    };
  return { kind: "ready", target, attackElapsed: 0 };
};

export interface ProjectileDraft {
  readonly origin: Vector2;
  readonly targetId: string;
  readonly targetPosition: Vector2;
  readonly damage: number;
  readonly chainTargetIds: readonly string[];
  readonly chainDamage: number;
  readonly hitHeal: number;
}

export interface ProjectileDraftInput<Target extends CombatTarget> {
  readonly playerPosition: Vector2;
  readonly target: Target;
  readonly targets: readonly Target[];
  readonly attackDamage: number;
  readonly chainTargets: number;
  readonly chainDamageMultiplier: number;
  readonly hitHeal: number;
}

/** Builds projectile values only; GameSession remains responsible for IDs and state. */
export const projectileDraftFor = <Target extends CombatTarget>({
  playerPosition,
  target,
  targets,
  attackDamage,
  chainTargets,
  chainDamageMultiplier,
  hitHeal,
}: ProjectileDraftInput<Target>): ProjectileDraft => ({
  origin: { x: playerPosition.x, y: playerPosition.y },
  targetId: target.id,
  targetPosition: { x: target.position.x, y: target.position.y },
  damage: attackDamage,
  chainTargetIds:
    chainTargets > 0 && chainDamageMultiplier > 0
      ? targets.slice(1, 1 + chainTargets).map((secondary) => secondary.id)
      : [],
  chainDamage: attackDamage * chainDamageMultiplier,
  hitHeal,
});

export interface ProjectileFlightInput {
  readonly elapsed: number;
  readonly delta: number;
  readonly travelSeconds: number;
}

export interface ProjectileFlightResult {
  readonly elapsed: number;
  readonly completed: boolean;
}

/** Advances elapsed flight time and classifies completion at the inclusive threshold. */
export const advanceProjectileFlight = ({
  elapsed,
  delta,
  travelSeconds,
}: ProjectileFlightInput): ProjectileFlightResult => {
  const nextElapsed = elapsed + delta;
  return {
    elapsed: nextElapsed,
    completed: nextElapsed >= travelSeconds,
  };
};

export interface EnemyPursuitInput {
  readonly enemyPosition: Vector2;
  readonly playerPosition: Vector2;
  readonly moveSpeed: number;
  readonly delta: number;
  readonly attackStandoff: number;
}

/** Returns the next enemy position while retaining the authored attack standoff. */
export const enemyPursuitPosition = ({
  enemyPosition,
  playerPosition,
  moveSpeed,
  delta,
  attackStandoff,
}: EnemyPursuitInput): Vector2 => {
  const separation = {
    x: playerPosition.x - enemyPosition.x,
    y: playerPosition.y - enemyPosition.y,
  };
  const playerDistance = magnitude(separation);
  const remainingDistance = playerDistance - attackStandoff;
  if (remainingDistance <= 0) return enemyPosition;

  const travel = Math.min(moveSpeed * delta, remainingDistance);
  const nextPosition = add(enemyPosition, scale(normalize(separation), travel));
  return distance(nextPosition, playerPosition) < attackStandoff
    ? add(
        playerPosition,
        scale(
          normalize({
            x: enemyPosition.x - playerPosition.x,
            y: enemyPosition.y - playerPosition.y,
          }),
          attackStandoff,
        ),
      )
    : nextPosition;
};
