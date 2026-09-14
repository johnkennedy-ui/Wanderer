/**
 * The baseline primary hit deliberately omits optional skills, allocated
 * stats, settlement upgrades, and weapon relics. Those choices must remain
 * genuine ways to improve a build rather than raising enemy health in lockstep.
 */
export interface EnemyHealthContext {
  readonly level: number;
  readonly normalPrimaryDamage: number;
}

export interface EnemyHealthScalingInput {
  readonly authoredMaxHp: number;
  /** Distance danger for world enemies, 1 for normal waves, and 5 for wave bosses. */
  readonly spawnHealthMultiplier?: number;
  readonly context: EnemyHealthContext;
}

export interface EnemyHealthRefreshInput {
  readonly hp: number;
  readonly maxHp: number;
  readonly defeated: boolean;
}

/**
 * Returns the number of non-critical baseline primary hits an enemy's damage
 * floor must sustain. The authored durability floor can still require more.
 */
export const enemyHitMultiplierForLevel = (level: number): number => {
  const normalizedLevel = Math.max(0, Math.floor(level));
  if (normalizedLevel <= 1) return 1;
  if (normalizedLevel <= 10) return 2 + (normalizedLevel - 2) / 8;
  return Math.min(5, 3 + ((normalizedLevel - 10) * 2) / 15);
};

/**
 * Keeps authored durability and its spawn multiplier intact while applying the
 * damage-relative hit floor. The damage floor intentionally stays fractional:
 * rounding it upward would turn an exact two-hit floor into three hits.
 */
export const maxEnemyHpFor = ({
  authoredMaxHp,
  spawnHealthMultiplier = 1,
  context,
}: EnemyHealthScalingInput): number =>
  Math.max(
    Math.ceil(authoredMaxHp * spawnHealthMultiplier),
    context.normalPrimaryDamage *
      enemyHitMultiplierForLevel(context.level) *
      spawnHealthMultiplier,
  );

/** Rebalances a live enemy without healing or reviving it. */
export const hpWithPreservedFraction = (
  { hp, maxHp, defeated }: EnemyHealthRefreshInput,
  nextMaxHp: number,
): number => {
  if (defeated) return Math.max(0, Math.min(hp, nextMaxHp));
  const currentFraction = maxHp <= 0 ? 0 : hp / maxHp;
  return Math.max(0, Math.min(nextMaxHp, currentFraction * nextMaxHp));
};
