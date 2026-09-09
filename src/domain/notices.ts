import type {
  BuildingKind,
  BuildingState,
  ClassProgression,
  ClassSkillId,
  ChunkRecipe,
  EnemyKind,
  EnemyState,
  FloorDropState,
  InputSource,
  PlayerState,
  ProjectileState,
  ReadonlyResourceBag,
  UpgradeId,
  PlayerClass,
  WorldIdentity,
} from "./types";

/** Structured reasons for a rejected building command. Presentation owns wording. */
export type PlacementRejection =
  | { readonly kind: "invalid-coordinates" }
  | { readonly kind: "blocked-terrain" }
  | { readonly kind: "overlaps-existing-building" }
  | { readonly kind: "outside-settlement-radius"; readonly radius: number }
  | { readonly kind: "insufficient-resources" }
  | { readonly kind: "unknown-building" }
  | { readonly kind: "already-level-3" };

/** A typed command result; UI code must not infer it from display text. */
export type PlacementResult =
  | {
      readonly ok: true;
      readonly outcome: "placed" | "relocated" | "upgraded" | "demolished";
      readonly building: BuildingState;
    }
  | {
      readonly ok: false;
      readonly rejection: PlacementRejection;
      /** Compatibility shape for callers that previously checked this field. */
      readonly building?: undefined;
    };

/**
 * Instance-owned domain outcome state. It carries facts rather than wording so
 * presentation can evolve without changing gameplay behaviour.
 */
export type GameNotice =
  | { readonly kind: "session.ready" }
  | { readonly kind: "world.reset"; readonly seed: string }
  | { readonly kind: "tap-to-move.rejected.invalid-destination" }
  | {
      readonly kind: "building.placed";
      readonly buildingId: string;
      readonly buildingKind: BuildingKind;
    }
  | {
      readonly kind: "building.relocated";
      readonly buildingId: string;
      readonly buildingKind: BuildingKind;
    }
  | {
      readonly kind: "building.upgraded";
      readonly buildingId: string;
      readonly buildingKind: BuildingKind;
      readonly level: 2 | 3;
    }
  | {
      readonly kind: "building.demolished";
      readonly buildingId: string;
      readonly buildingKind: BuildingKind;
      readonly refundRate: number;
    }
  | {
      readonly kind: "building.rejected";
      readonly rejection: PlacementRejection;
    }
  | { readonly kind: "upgrade.rejected.invalid-choice" }
  | { readonly kind: "upgrade.applied"; readonly upgradeId: UpgradeId }
  | { readonly kind: "class.rejected.invalid-choice" }
  | { readonly kind: "class.selected"; readonly playerClass: PlayerClass }
  | { readonly kind: "class-skill.rejected.invalid-choice" }
  | { readonly kind: "class-skill.selected"; readonly skillId: ClassSkillId }
  | { readonly kind: "save.rejected.not-near-campfire" }
  | { readonly kind: "save.committed"; readonly savePointId: string }
  | {
      readonly kind: "player.died";
      readonly savePointLabel: string;
      readonly resourceLossRate: number;
    }
  | {
      readonly kind: "enemy.defeated";
      readonly enemyKind: EnemyKind;
      readonly respawns: boolean;
    }
  | { readonly kind: "boss.defeated"; readonly hasUpgradeChoices: boolean }
  | { readonly kind: "drop.collected" }
  | { readonly kind: "farm.harvested" };

/** The DOM UI receives only the fields it presents and the latest typed outcome. */
export interface GameUiSnapshot {
  readonly world: WorldIdentity;
  readonly player: PlayerState;
  readonly resources: ReadonlyResourceBag;
  readonly materialCapacity: number;
  readonly buildRadius: number;
  readonly inputSource: InputSource;
  readonly combatStatus: string;
  readonly projectileCount: number;
  readonly buildings: readonly BuildingState[];
  readonly effects: readonly string[];
  readonly pendingUpgradeChoices: readonly UpgradeId[];
  readonly classProgression: ClassProgression;
  readonly pendingClassChoices: readonly PlayerClass[];
  readonly pendingClassSkillChoices: readonly ClassSkillId[];
  readonly canSave: boolean;
  readonly savePointLabel: string | null;
  readonly notice: GameNotice;
}

/** A transient, renderer-only projection of the player's post-hit state. */
export interface PlayerHitRecoveryPresentation {
  readonly active: boolean;
  readonly flashOn: boolean;
}

/** The disposable Three renderer receives only world-projection fields. */
export interface GameRendererSnapshot {
  readonly player: PlayerState;
  readonly playerHitRecovery: PlayerHitRecoveryPresentation;
  readonly enemies: readonly EnemyState[];
  readonly projectiles: readonly ProjectileState[];
  readonly floorDrops: readonly FloorDropState[];
  readonly visibleBuildings: readonly BuildingState[];
  readonly visibleChunks: readonly ChunkRecipe[];
}

/** One immutable-shaped frame result with only the two narrow presentation views. */
export interface GamePresentation {
  readonly ui: GameUiSnapshot;
  readonly renderer: GameRendererSnapshot;
}

/** Snapshot consumers receive a copy, never the session's retained notice object. */
export const copyGameNotice = (notice: GameNotice): GameNotice =>
  notice.kind === "building.rejected"
    ? { ...notice, rejection: { ...notice.rejection } }
    : { ...notice };
