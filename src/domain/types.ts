export const resourceKinds = Object.freeze([
  "wood",
  "stone",
  "scrap",
  "essence",
  "bossCore",
] as const);

export type ResourceKind = (typeof resourceKinds)[number];
export type CommonResourceKind = Exclude<ResourceKind, "bossCore">;
export const commonResourceKinds: readonly CommonResourceKind[] = Object.freeze(
  ["wood", "stone", "scrap", "essence"] as const,
);

export type ResourceBag = Record<ResourceKind, number>;
/** Immutable authored resource quantities such as costs, drops, and harvests. */
export type ReadonlyResourceBag = Readonly<ResourceBag>;

export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

export type InputSource =
  "keyboard" | "virtual-stick" | "tap-to-move" | "system";

export interface MoveCommand {
  readonly intent: Vector2;
  readonly source: InputSource;
  readonly at: number;
}

/** An explicit runtime-only destination issued by an enabled tap-to-move adapter. */
export interface DestinationCommand {
  readonly destination: Vector2;
  readonly source: "tap-to-move";
  readonly at: number;
}

export const enemyKinds = Object.freeze([
  "scout",
  "brute",
  "spitter",
  "elite",
  "boss",
] as const);

export type EnemyKind = (typeof enemyKinds)[number];

export interface EnemyState {
  readonly id: string;
  readonly kind: EnemyKind;
  readonly position: Vector2;
  readonly hp: number;
  readonly maxHp: number;
  readonly damage: number;
  readonly dangerTier: number;
  readonly respawnAt: number | null;
  readonly defeated: boolean;
}

/** A disposable visual/combat flight snapshot. It is never part of a save. */
export interface ProjectileState {
  readonly id: string;
  readonly origin: Vector2;
  readonly targetId: string;
  readonly targetPosition: Vector2;
  readonly progress: number;
  readonly style: AttackStyle;
}

/** A runtime-only resource bundle left by a completed lethal projectile impact. */
export interface FloorDropState {
  readonly id: string;
  readonly resource: ResourceKind;
  readonly amount: number;
  readonly position: Vector2;
}

export const buildingKinds = Object.freeze([
  "Campfire",
  "Workshop",
  "Farm",
  "Storage",
  "Healer",
] as const);

export type BuildingKind = (typeof buildingKinds)[number];

export interface BuildingState {
  readonly id: string;
  readonly kind: BuildingKind;
  readonly position: Vector2;
  readonly level: 1 | 2 | 3;
}

export const upgradeIds = Object.freeze([
  "sharpened-blade",
  "quick-hands",
  "iron-skin",
  "ember-aura",
  "long-reach",
  "chain-strike",
  "invigorating-edge",
  "trailblazer",
  "fortified-heart",
  "keen-focus",
] as const);

export type UpgradeId = (typeof upgradeIds)[number];

export const playerClasses = Object.freeze([
  "knight",
  "wizard",
  "archer",
] as const);

export type PlayerClass = (typeof playerClasses)[number];

export const classSkillIds = Object.freeze([
  "knight-iron-guard",
  "knight-wide-slash",
  "knight-heavy-blade",
  "knight-rapid-cuts",
  "knight-execution-arc",
  "knight-crescent-sweep",
  "knight-bulwark",
  "knight-whirlwind",
  "wizard-flame-orb",
  "wizard-wide-blast",
  "wizard-arcane-haste",
  "wizard-mana-siphon",
  "wizard-nova",
  "wizard-aether-ward",
  "wizard-meteor",
  "wizard-spellweave",
  "archer-longbow",
  "archer-barbed-arrow",
  "archer-quickdraw",
  "archer-volley",
  "archer-piercing-arrow",
  "archer-trailstep",
  "archer-eagle-eye",
  "archer-multishot",
] as const);

export type ClassSkillId = (typeof classSkillIds)[number];
export type AttackStyle = "basic" | "slash" | "magic" | "arrow";

export interface ClassProgression {
  readonly experience: number;
  readonly level: 0 | 1 | 2 | 3 | 4 | 5;
  readonly playerClass: PlayerClass | null;
  readonly skillIds: readonly ClassSkillId[];
}

export interface PlayerState {
  readonly position: Vector2;
  readonly hp: number;
  readonly maxHp: number;
}

export interface WorldIdentity {
  readonly seed: string;
  readonly generatorVersion: string;
}

export interface ChunkObstacle {
  readonly id: string;
  readonly position: Vector2;
}

export interface ChunkCampfire {
  readonly id: string;
  readonly position: Vector2;
  readonly kind: "home" | "wild";
}

export interface DangerProfile {
  readonly tier: number;
  readonly label: string;
  readonly distance: number;
  readonly healthMultiplier: number;
  readonly damageMultiplier: number;
  readonly dropMultiplier: number;
}

export interface ChunkSpawn {
  readonly id: string;
  readonly kind: EnemyKind;
  readonly position: Vector2;
  readonly danger: DangerProfile;
}

export interface ChunkRecipe {
  readonly coordinate: Vector2;
  readonly key: string;
  readonly domainSeeds: Readonly<Record<string, number>>;
  readonly obstacles: readonly ChunkObstacle[];
  readonly campfires: readonly ChunkCampfire[];
  readonly spawns: readonly ChunkSpawn[];
}

export interface CombatStats {
  readonly attackDamage: number;
  readonly attackIntervalSeconds: number;
  readonly attackRange: number;
  readonly moveSpeed: number;
  readonly chainTargets: number;
  readonly attackStyle: AttackStyle;
  readonly classSecondaryDamageMultiplier: number;
  readonly classAreaRadius: number;
  readonly classArcCosine: number;
}

/**
 * Current in-memory state used to hydrate a GameSession. The frozen released
 * schema-2 wire DTO lives independently in persistence/saveV2.ts.
 */
export interface CurrentSave {
  readonly schemaVersion: 2;
  readonly world: WorldIdentity;
  readonly player: PlayerState;
  readonly resources: ResourceBag;
  readonly buildings: readonly BuildingState[];
  readonly defeatedBossIds: readonly string[];
  readonly upgrades: readonly UpgradeId[];
  readonly nextBuildingSerial: number;
  readonly committedAt: number;
  readonly savePointId: string;
  readonly savePointPosition: Vector2;
  /** Optional extension: historical schema-2 documents omit this safely. */
  readonly classProgression?: ClassProgression;
}

/** Compatibility alias for callers that still use the historical name. */
export type SaveDocument = CurrentSave;

export interface ValidCampfireSaveRequest {
  readonly document: CurrentSave;
  readonly savePointLabel: string;
}

export const emptyResources = (): ResourceBag => ({
  wood: 0,
  stone: 0,
  scrap: 0,
  essence: 0,
  bossCore: 0,
});
