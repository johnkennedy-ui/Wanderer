import type {
  BuildingKind,
  ResourceBag,
  Vector2,
  WorldIdentity,
} from "../types";
import { enemyTerrainClearanceFor } from "../world/terrainCollision";
import { snapBuildingPosition } from "./buildingGeometry";
import type { RuntimeEnemy, SettlementCampfire } from "./sessionState";
import {
  SettlementRuntime,
  type SettlementCommandOutcome,
} from "./settlementRuntime";

export type SettlementCommand =
  | {
      readonly kind: "place";
      readonly buildingKind: BuildingKind;
      readonly position: Vector2;
    }
  | {
      readonly kind: "relocate";
      readonly id: string;
      readonly position: Vector2;
    }
  | { readonly kind: "upgrade"; readonly id: string }
  | { readonly kind: "demolish"; readonly id: string };

export const placementInputsFor = ({
  settlement,
  world,
  position,
  playerPosition,
  committedSavePoint,
  enemies,
}: {
  readonly settlement: SettlementRuntime;
  readonly world: WorldIdentity;
  readonly position: Vector2;
  readonly playerPosition: Vector2;
  readonly committedSavePoint: SettlementCampfire;
  readonly enemies: ReadonlyMap<string, RuntimeEnemy>;
}) => {
  const inputs = settlement.inputsFor(world, position);
  return {
    ...inputs,
    occupiedActors: [
      { position: playerPosition, clearance: 0.28 },
      { position: committedSavePoint.position, clearance: 0.28 },
      // A later explicit save may select any nearby campfire. Keep those
      // return positions clear too, without moving or committing the player.
      ...inputs.campfires.map((campfire) => ({
        position: campfire.position,
        clearance: 0.28,
      })),
      ...[...enemies.values()]
        .filter((enemy) => !enemy.defeated)
        .map((enemy) => ({
          position: enemy.position,
          clearance: enemyTerrainClearanceFor(enemy.kind),
        })),
    ],
  };
};

/**
 * Runs one explicit settlement command through the session-owned settlement
 * runtime. Resource and notice application remains at the GameSession facade.
 */
export const settlementCommandOutcomeFor = ({
  command,
  settlement,
  resources,
  world,
  playerPosition,
  committedSavePoint,
  enemies,
}: {
  readonly command: SettlementCommand;
  readonly settlement: SettlementRuntime;
  readonly resources: ResourceBag;
  readonly world: WorldIdentity;
  readonly playerPosition: Vector2;
  readonly committedSavePoint: SettlementCampfire;
  readonly enemies: ReadonlyMap<string, RuntimeEnemy>;
}): SettlementCommandOutcome => {
  switch (command.kind) {
    case "place": {
      const position = snapBuildingPosition(command.position);
      return settlement.place(
        command.buildingKind,
        position,
        resources,
        world.seed,
        placementInputsFor({
          settlement,
          world,
          position,
          playerPosition,
          committedSavePoint,
          enemies,
        }),
      );
    }
    case "relocate": {
      const position = snapBuildingPosition(command.position);
      return settlement.relocate(
        command.id,
        position,
        resources,
        placementInputsFor({
          settlement,
          world,
          position,
          playerPosition,
          committedSavePoint,
          enemies,
        }),
      );
    }
    case "upgrade":
      return settlement.upgrade(command.id, resources);
    case "demolish":
      return settlement.demolish(command.id, resources);
  }
};
