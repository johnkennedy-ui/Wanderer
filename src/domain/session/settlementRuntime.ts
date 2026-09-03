import { buildingDefinitions, gameplayTuning } from "../../data/definitions";
import { distance, roundVector } from "../math";
import type {
  BuildingKind,
  BuildingState,
  ReadonlyResourceBag,
  ResourceBag,
  Vector2,
} from "../types";
import type { PlacementRejection, PlacementResult } from "../notices";
import { emptyResources } from "../types";
import type { SettlementCampfire } from "./sessionState";
import {
  addResourceBags,
  canAffordResources,
  clampResourcesToCapacity,
  collectResourcesWithinCapacity,
  materialCapacityFor,
  resourcesForLevel,
  scaleResourceBag,
  subtractResourceBags,
} from "./economy";
import {
  findCampfireCoveringPosition,
  findNearbyCampfire,
  settlementBuildRadius,
} from "./settlementPolicy";

export interface SettlementInputs {
  readonly position: Vector2;
  readonly campfires: readonly SettlementCampfire[];
  readonly terrainBlocked: boolean;
}

export interface SettlementPassiveResult {
  readonly hp: number;
  readonly resources: ResourceBag;
  readonly harvested: boolean;
}

const hashText = (text: string): number => {
  let hash = 2_166_136_261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

export class SettlementRuntime {
  private buildings: BuildingState[];
  private nextBuildingSerial: number;
  private farmHarvestElapsed: number;

  constructor(state: {
    readonly buildings: BuildingState[];
    readonly nextBuildingSerial: number;
    readonly farmHarvestElapsed: number;
  }) {
    this.buildings = state.buildings;
    this.nextBuildingSerial = state.nextBuildingSerial;
    this.farmHarvestElapsed = state.farmHarvestElapsed;
  }

  get buildingState(): BuildingState[] {
    return this.buildings;
  }
  get serial(): number {
    return this.nextBuildingSerial;
  }
  get harvestElapsed(): number {
    return this.farmHarvestElapsed;
  }
  resetHarvest(): void {
    this.farmHarvestElapsed = 0;
  }

  place(
    kind: BuildingKind,
    position: Vector2,
    resources: ResourceBag,
    seed: string,
    input: SettlementInputs,
  ): { result: PlacementResult; resources: ResourceBag } {
    const rejection = this.validate(kind, position, input);
    if (rejection) return this.rejected(rejection, resources);
    const cost = resourcesForLevel(buildingDefinitions[kind].baseCost, 1);
    if (!canAffordResources(resources, cost))
      return this.rejected({ kind: "insufficient-resources" }, resources);
    const building: BuildingState = {
      id: `building:${hashText(seed).toString(16)}:${this.nextBuildingSerial.toString().padStart(4, "0")}`,
      kind,
      position: roundVector(position),
      level: 1,
    };
    this.nextBuildingSerial += 1;
    this.buildings = [...this.buildings, building];
    return {
      result: { ok: true, outcome: "placed", building },
      resources: subtractResourceBags(resources, cost),
    };
  }

  relocate(
    id: string,
    position: Vector2,
    resources: ResourceBag,
    input: SettlementInputs,
  ): { result: PlacementResult; resources: ResourceBag } {
    const building = this.buildings.find((candidate) => candidate.id === id);
    if (!building)
      return this.rejected({ kind: "unknown-building" }, resources);
    const rejection = this.validate(building.kind, position, input, id);
    if (rejection) return this.rejected(rejection, resources);
    const moved = { ...building, position: roundVector(position) };
    this.buildings = this.buildings.map((candidate) =>
      candidate.id === id ? moved : candidate,
    );
    return {
      result: { ok: true, outcome: "relocated", building: moved },
      resources,
    };
  }

  upgrade(
    id: string,
    resources: ResourceBag,
  ): { result: PlacementResult; resources: ResourceBag } {
    const building = this.buildings.find((candidate) => candidate.id === id);
    if (!building)
      return this.rejected({ kind: "unknown-building" }, resources);
    if (building.level === 3)
      return this.rejected({ kind: "already-level-3" }, resources);
    const nextLevel = (building.level + 1) as 2 | 3;
    const cost = resourcesForLevel(
      buildingDefinitions[building.kind].baseCost,
      nextLevel,
    );
    if (!canAffordResources(resources, cost))
      return this.rejected({ kind: "insufficient-resources" }, resources);
    const upgraded = { ...building, level: nextLevel };
    this.buildings = this.buildings.map((candidate) =>
      candidate.id === id ? upgraded : candidate,
    );
    const nextResources = clampResourcesToCapacity(
      subtractResourceBags(resources, cost),
      materialCapacityFor(this.buildings),
    );
    return {
      result: { ok: true, outcome: "upgraded", building: upgraded },
      resources: nextResources,
    };
  }

  demolish(
    id: string,
    resources: ResourceBag,
  ): { result: PlacementResult; resources: ResourceBag } {
    const building = this.buildings.find((candidate) => candidate.id === id);
    if (!building)
      return this.rejected({ kind: "unknown-building" }, resources);
    const cumulativeCost = [1, 2, 3]
      .filter((level) => level <= building.level)
      .map((level) =>
        resourcesForLevel(buildingDefinitions[building.kind].baseCost, level),
      )
      .reduce(addResourceBags, emptyResources());
    this.buildings = this.buildings.filter((candidate) => candidate.id !== id);
    const refund = scaleResourceBag(
      cumulativeCost,
      gameplayTuning.buildingRefundRate,
    );
    return {
      result: { ok: true, outcome: "demolished", building },
      resources: collectResourcesWithinCapacity(
        resources,
        refund,
        materialCapacityFor(this.buildings),
      ),
    };
  }

  passive(
    delta: number,
    hp: number,
    maxHp: number,
    resources: ResourceBag,
    nearCampfire: boolean,
  ): SettlementPassiveResult {
    let nextHp = hp;
    if (nearCampfire) {
      const healing =
        gameplayTuning.baseCampfireHealingPerSecond +
        this.buildings
          .filter((b) => b.kind === "Healer")
          .reduce(
            (total, b) =>
              total + gameplayTuning.healerHealingBonusByLevel[b.level - 1],
            0,
          );
      nextHp = Math.min(maxHp, hp + delta * healing);
    }
    const farms = this.buildings.filter((b) => b.kind === "Farm");
    if (!farms.length) {
      this.farmHarvestElapsed = 0;
      return { hp: nextHp, resources, harvested: false };
    }
    this.farmHarvestElapsed += delta;
    if (this.farmHarvestElapsed < gameplayTuning.farmHarvestEverySeconds)
      return { hp: nextHp, resources, harvested: false };
    this.farmHarvestElapsed = 0;
    const harvest = farms
      .map((farm) => gameplayTuning.farmHarvestByLevel[farm.level - 1])
      .reduce(addResourceBags, emptyResources());
    return {
      hp: nextHp,
      resources: collectResourcesWithinCapacity(
        resources,
        harvest,
        materialCapacityFor(this.buildings),
      ),
      harvested: true,
    };
  }

  nearby(
    position: Vector2,
    campfires: readonly SettlementCampfire[],
  ): SettlementCampfire | null {
    return findNearbyCampfire(position, campfires);
  }
  buildRadius(campfires: readonly SettlementCampfire[]): number {
    return settlementBuildRadius(
      campfires,
      gameplayTuning.campfireBuildRadiusByLevel,
    );
  }
  private validate(
    kind: BuildingKind,
    position: Vector2,
    input: SettlementInputs,
    ignoredId?: string,
  ): PlacementRejection | null {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y))
      return { kind: "invalid-coordinates" };
    if (input.terrainBlocked) return { kind: "blocked-terrain" };
    if (
      this.buildings.some(
        (building) =>
          building.id !== ignoredId &&
          distance(building.position, position) < 1.25,
      )
    )
      return { kind: "overlaps-existing-building" };
    if (
      kind !== "Campfire" &&
      !findCampfireCoveringPosition(
        position,
        input.campfires,
        gameplayTuning.campfireBuildRadiusByLevel,
      )
    )
      return {
        kind: "outside-settlement-radius",
        radius: this.buildRadius(input.campfires),
      };
    return null;
  }
  private rejected(
    rejection: PlacementRejection,
    resources: ResourceBag,
  ): { result: PlacementResult; resources: ResourceBag } {
    return { result: { ok: false, rejection }, resources };
  }
}
