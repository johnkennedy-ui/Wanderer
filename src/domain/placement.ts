import type { PlacementRejection } from "./notices";
import type { BuildingKind, ReadonlyResourceBag, Vector2 } from "./types";

/** Ephemeral placement intent; never part of a committed save. */
export type PlacementRequest =
  | {
      readonly kind: "place";
      readonly buildingKind: BuildingKind;
      readonly position: Vector2;
      readonly endPosition?: Vector2;
    }
  | {
      readonly kind: "relocate";
      readonly buildingId: string;
      readonly position: Vector2;
    };

/** Domain-owned validation projected into disposable UI/render previews. */
export interface PlacementPreview {
  readonly buildingKind: BuildingKind;
  readonly level: 1 | 2 | 3;
  readonly tiles: readonly {
    readonly position: Vector2;
    readonly valid: boolean;
    readonly rejection: PlacementRejection | null;
  }[];
  readonly valid: boolean;
  readonly rejection: PlacementRejection | null;
  readonly cost: ReadonlyResourceBag;
}
