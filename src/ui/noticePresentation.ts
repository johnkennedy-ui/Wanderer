import { buildingDefinitions, upgradeDefinitionFor } from "../data/definitions";
import type { GameNotice, PlacementRejection } from "../domain/notices";

const exhaustNotice = (notice: never): never => {
  throw new Error(`Unhandled game notice: ${JSON.stringify(notice)}`);
};

export const presentPlacementRejection = (
  rejection: PlacementRejection,
): string => {
  switch (rejection.kind) {
    case "invalid-coordinates":
      return "invalid coordinates";
    case "blocked-terrain":
      return "blocked terrain";
    case "overlaps-existing-building":
      return "overlaps an existing building";
    case "outside-settlement-radius":
      return `outside the ${rejection.radius}m campfire settlement radius`;
    case "insufficient-resources":
      return "insufficient resources";
    case "unknown-building":
      return "unknown building";
    case "already-level-3":
      return "already level 3";
    default:
      return exhaustNotice(rejection);
  }
};

/** Maps typed domain outcomes to the established user-facing wording. */
export const presentGameNotice = (notice: GameNotice): string => {
  switch (notice.kind) {
    case "session.ready":
      return "Reach the nearby scout, then travel east to challenge the Ember Wyrm.";
    case "world.reset":
      return `New deterministic world started with seed “${notice.seed}”. Nothing has been saved.`;
    case "tap-to-move.rejected.invalid-destination":
      return "Tap-to-move ignored an invalid destination.";
    case "building.placed":
      return `${notice.buildingKind} placed. It is runtime-only until an explicit campfire save.`;
    case "building.relocated":
      return `${notice.buildingKind} relocated atomically. Save at a campfire to commit it.`;
    case "building.upgraded":
      return `${notice.buildingKind} upgraded to level ${notice.level}; ${buildingDefinitions[notice.buildingKind].levelEffects[notice.level - 1]} The change remains unsaved.`;
    case "building.demolished":
      return `${notice.buildingKind} demolished safely; ${(notice.refundRate * 100).toFixed(0)}% of its invested resources were refunded.`;
    case "building.rejected":
      return `Building action rejected: ${presentPlacementRejection(notice.rejection)}. No resources or records changed.`;
    case "upgrade.rejected.invalid-choice":
      return "Choose exactly one unowned upgrade from the current boss reward options.";
    case "upgrade.applied":
      return `${upgradeDefinitionFor(notice.upgradeId).label} applied in runtime. Campfire-save it to keep it.`;
    case "save.rejected.not-near-campfire":
      return "Save rejected: stand within 2m of a home, wild, or player Campfire.";
    case "save.committed":
      return `Campfire save committed at ${notice.savePointId}. Death now returns to this save point; no death save is made.`;
    case "player.died":
      return `You fell and returned to ${notice.savePointLabel}. ${(notice.resourceLossRate * 100).toFixed(0)}% of carried resources was lost; no save was made.`;
    case "enemy.defeated":
      return notice.respawns
        ? `${notice.enemyKind} defeated: data-defined resource drops remain on the ground. It will respawn later; no save was made.`
        : `${notice.enemyKind} defeated: data-defined resource drops remain on the ground. No save was made.`;
    case "boss.defeated":
      return notice.hasUpgradeChoices
        ? "The Ember Wyrm is defeated: a Boss Core drop remains on the ground. Choose one unowned upgrade, then campfire-save it."
        : "The Ember Wyrm is defeated: a Boss Core drop remains on the ground. No complete unowned upgrade trio remains.";
    case "drop.collected":
      return "Collected floor drops on contact; no save was made.";
    case "farm.harvested":
      return "Farm harvest collected while stationary; storage capacity was enforced.";
    default:
      return exhaustNotice(notice);
  }
};

/** Placement-panel visibility is a typed decision, not a display-text heuristic. */
export const presentPlacementNotice = (notice: GameNotice): string => {
  switch (notice.kind) {
    case "building.placed":
    case "building.relocated":
    case "building.upgraded":
    case "building.demolished":
    case "building.rejected":
      return presentGameNotice(notice);
    case "session.ready":
    case "world.reset":
    case "tap-to-move.rejected.invalid-destination":
    case "upgrade.rejected.invalid-choice":
    case "upgrade.applied":
    case "save.rejected.not-near-campfire":
    case "save.committed":
    case "player.died":
    case "enemy.defeated":
    case "boss.defeated":
    case "drop.collected":
    case "farm.harvested":
      return "";
    default:
      return exhaustNotice(notice);
  }
};
