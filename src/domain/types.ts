export type ResourceKind = "wood" | "ore" | "food" | "bossCore";

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
  readonly respawnAt: number | null;
  readonly defeated: boolean;
}

export type BuildingKind =
  "Campfire" | "Workshop" | "Farm" | "Storage" | "Healer";

export interface BuildingState {
  readonly id: string;
  readonly kind: BuildingKind;
  readonly position: Vector2;
  readonly level: 1 | 2 | 3;
}

export type UpgradeId =
  "sharpened-blade" | "quick-hands" | "iron-skin" | "ember-aura";

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

export interface ChunkSpawn {
  readonly id: string;
  readonly kind: EnemyKind;
  readonly position: Vector2;
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

export interface GameSnapshot {
  readonly world: WorldIdentity;
  readonly player: PlayerState;
  readonly resources: ResourceBag;
  readonly enemies: readonly EnemyState[];
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
  readonly schemaVersion: 1;
  readonly world: WorldIdentity;
  readonly player: PlayerState;
  readonly resources: ResourceBag;
  readonly buildings: readonly BuildingState[];
  readonly defeatedBossIds: readonly string[];
  readonly upgrades: readonly UpgradeId[];
  readonly nextBuildingSerial: number;
  readonly committedAt: number;
  readonly savePointId: string;
}

export interface ValidCampfireSaveRequest {
  readonly document: SaveDocument;
  readonly savePointLabel: string;
}

export const emptyResources = (): ResourceBag => ({
  wood: 0,
  ore: 0,
  food: 0,
  bossCore: 0,
});
