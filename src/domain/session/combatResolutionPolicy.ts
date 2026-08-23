import { add, roundVector } from "../math";
import type {
  FloorDropState,
  ReadonlyResourceBag,
  ResourceKind,
  Vector2,
} from "../types";

export interface ProjectileImpactTarget {
  readonly id: string;
  readonly hp: number;
  readonly defeated: boolean;
}

export interface ProjectileImpactResolutionInput<
  Target extends ProjectileImpactTarget,
> {
  readonly targets: ReadonlyMap<string, Target>;
  readonly primaryTargetId: string;
  readonly primaryDamage: number;
  readonly chainTargetIds: readonly string[];
  readonly chainDamage: number;
}

export interface ResolvedProjectileImpact {
  readonly targetId: string;
  readonly nextHp: number;
  readonly lethal: boolean;
}

export interface ProjectileImpactResolution {
  readonly impacts: readonly ResolvedProjectileImpact[];
  readonly landedHitCount: number;
}

interface ProjectileImpactAttempt {
  readonly targetId: string;
  readonly damage: number;
}

/**
 * Resolves projectile impacts in their authored primary-then-chain order.
 * The caller applies the resulting hit points and owns one-time defeat effects.
 */
export const projectileImpactResolutionFor = <
  Target extends ProjectileImpactTarget,
>({
  targets,
  primaryTargetId,
  primaryDamage,
  chainTargetIds,
  chainDamage,
}: ProjectileImpactResolutionInput<Target>): ProjectileImpactResolution => {
  const attempts: readonly ProjectileImpactAttempt[] = [
    { targetId: primaryTargetId, damage: primaryDamage },
    ...chainTargetIds.map((targetId) => ({ targetId, damage: chainDamage })),
  ];
  const impacts = attempts.reduce<readonly ResolvedProjectileImpact[]>(
    (resolved, attempt) => {
      const target = targets.get(attempt.targetId);
      if (target === undefined || target.defeated) return resolved;

      const preceding = [...resolved]
        .reverse()
        .find((impact) => impact.targetId === attempt.targetId);
      if (preceding?.lethal) return resolved;

      const nextHp = (preceding?.nextHp ?? target.hp) - attempt.damage;
      return [
        ...resolved,
        {
          targetId: attempt.targetId,
          nextHp,
          lethal: nextHp <= 0,
        },
      ];
    },
    [],
  );

  return { impacts, landedHitCount: impacts.length };
};

export interface EnemyAttackResolutionInput {
  readonly defeated: boolean;
  readonly inAttackRange: boolean;
  readonly attackElapsed: number;
  readonly attackEverySeconds: number;
  readonly damage: number;
  readonly playerHp: number;
  readonly delta: number;
}

export type EnemyAttackResolution =
  | { readonly kind: "inactive" }
  | { readonly kind: "waiting"; readonly attackElapsed: number }
  | {
      readonly kind: "landed";
      readonly attackElapsed: 0;
      readonly nextPlayerHp: number;
      readonly playerDefeated: boolean;
    };

/** Classifies attack timing and damage without mutating enemy or player state. */
export const enemyAttackResolutionFor = ({
  defeated,
  inAttackRange,
  attackElapsed,
  attackEverySeconds,
  damage,
  playerHp,
  delta,
}: EnemyAttackResolutionInput): EnemyAttackResolution => {
  if (defeated || !inAttackRange) return { kind: "inactive" };

  const nextAttackElapsed = attackElapsed + delta;
  if (nextAttackElapsed < attackEverySeconds)
    return { kind: "waiting", attackElapsed: nextAttackElapsed };

  const nextPlayerHp = playerHp - damage;
  return {
    kind: "landed",
    attackElapsed: 0,
    nextPlayerHp,
    playerDefeated: nextPlayerHp <= 0,
  };
};

export interface EnemyRespawnResolutionInput {
  readonly defeated: boolean;
  readonly respawnAt: number | null;
  readonly elapsed: number;
  readonly maxHp: number;
  readonly spawnPosition: Vector2;
}

export type EnemyRespawnResolution =
  | { readonly kind: "waiting" }
  | {
      readonly kind: "ready";
      readonly defeated: false;
      readonly hp: number;
      readonly position: Vector2;
      readonly respawnAt: null;
      readonly attackElapsed: 0;
    };

/** Returns a fresh respawn state only once a defeated enemy reaches its deadline. */
export const enemyRespawnResolutionFor = ({
  defeated,
  respawnAt,
  elapsed,
  maxHp,
  spawnPosition,
}: EnemyRespawnResolutionInput): EnemyRespawnResolution => {
  if (!defeated || respawnAt === null || elapsed < respawnAt)
    return { kind: "waiting" };

  return {
    kind: "ready",
    defeated: false,
    hp: maxHp,
    position: { x: spawnPosition.x, y: spawnPosition.y },
    respawnAt: null,
    attackElapsed: 0,
  };
};

export interface FloorDropDraftRules {
  readonly offsetDistance: number;
}

export interface FloorDropDraftInput {
  readonly enemyId: string;
  readonly enemyPosition: Vector2;
  readonly serial: number;
  readonly resources: ReadonlyResourceBag;
  readonly resourceOrder: readonly ResourceKind[];
  readonly rules: FloorDropDraftRules;
}

const hashText = (text: string): number => {
  let hash = 2_166_136_261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

/** Drafts deterministic floor drops; the caller owns definitions and serial allocation. */
export const floorDropDraftFor = ({
  enemyId,
  enemyPosition,
  serial,
  resources,
  resourceOrder,
  rules,
}: FloorDropDraftInput): readonly FloorDropState[] => {
  const droppedResources = resourceOrder.filter(
    (resource) => resources[resource] > 0,
  );
  const startAngle = ((hashText(enemyId) % 360) * Math.PI) / 180;

  return droppedResources.map((resource, index) => {
    const angle = startAngle + (index * Math.PI * 2) / droppedResources.length;
    return {
      id: `drop:${enemyId}:${serial}:${resource}`,
      resource,
      amount: resources[resource],
      position: roundVector(
        add(enemyPosition, {
          x: Math.cos(angle) * rules.offsetDistance,
          y: Math.sin(angle) * rules.offsetDistance,
        }),
      ),
    };
  });
};
