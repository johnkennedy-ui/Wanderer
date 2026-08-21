export const resourceKinds = [
  "wood",
  "stone",
  "scrap",
  "essence",
  "bossCore",
] as const;

export type ResourceKind = (typeof resourceKinds)[number];
export type CommonResourceKind = Exclude<ResourceKind, "bossCore">;
export const commonResourceKinds: readonly CommonResourceKind[] = [
  "wood",
  "stone",
  "scrap",
  "essence",
];

export type ResourceBag = Record<ResourceKind, number>;

export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

export type InputSource = "keyboard" | "virtual-stick" | "system";

export interface MoveCommand {
  readonly intent: Vector2;
  readonly source: InputSource;
  readonly at: number;
}

export type EnemyKind = "scout" | "brute" | "spitter" | "elite" | "boss";

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
}

export type BuildingKind =
  "Campfire" | "Workshop" | "Farm" | "Storage" | "Healer";

export interface BuildingState {
  readonly id: string;
  readonly kind: BuildingKind;
  readonly position: Vector2;
  readonly level: 1 | 2 | 3;
}

export const upgradeIds = [
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
] as const;

export type UpgradeId = (typeof upgradeIds)[number];

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

export interface PlacementResult {
  readonly ok: boolean;
  readonly reason: string;
  readonly building?: BuildingState;
}

export interface CombatStats {
  readonly attackDamage: number;
  readonly attackIntervalSeconds: number;
  readonly attackRange: number;
  readonly moveSpeed: number;
  readonly chainTargets: number;
}

export interface GameSnapshot {
  readonly world: WorldIdentity;
  readonly player: PlayerState;
  readonly resources: ResourceBag;
  readonly materialCapacity: number;
  readonly buildRadius: number;
  readonly deathResourceLossRate: number;
  readonly combatStats: CombatStats;
  readonly enemies: readonly EnemyState[];
  readonly projectiles: readonly ProjectileState[];
  readonly buildings: readonly BuildingState[];
  readonly visibleBuildings: readonly BuildingState[];
  readonly visibleChunks: readonly ChunkRecipe[];
  readonly moving: boolean;
  readonly inputSource: InputSource;
  readonly combatStatus: string;
  readonly effects: readonly string[];
  readonly defeatedBossIds: readonly string[];
  readonly upgrades: readonly UpgradeId[];
  readonly pendingUpgradeChoices: readonly UpgradeId[];
  readonly canSave: boolean;
  readonly savePointLabel: string | null;
  readonly message: string;
}

export interface SaveDocument {
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
}

export interface ValidCampfireSaveRequest {
  readonly document: SaveDocument;
  readonly savePointLabel: string;
}

export const emptyResources = (): ResourceBag => ({
  wood: 0,
  stone: 0,
  scrap: 0,
  essence: 0,
  bossCore: 0,
});
