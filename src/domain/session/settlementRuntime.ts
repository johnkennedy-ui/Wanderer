import { buildingDefinitions, gameplayTuning } from "../../data/definitions";
import { distance, roundVector } from "../math";
import type {
  BuildingKind,
  BuildingState,
  ReadonlyResourceBag,
  ResourceBag,
  Vector2,
  WorldIdentity,
} from "../types";
import type {
  GameNotice,
  PlacementRejection,
  PlacementResult,
} from "../notices";
import {
  chunkCoordinateFor,
  generateChunk,
  visibleChunkCoordinates,
} from "../world";
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

export interface SettlementCommandOutcome {
  readonly result: PlacementResult;
  readonly resources: ResourceBag;
  readonly noticeDraft: GameNotice;
}

const placementNoticeFor = (result: PlacementResult): GameNotice => {
  if (!result.ok)
    return { kind: "building.rejected", rejection: result.rejection };
  if (result.outcome === "placed")
    return {
      kind: "building.placed",
      buildingId: result.building.id,
      buildingKind: result.building.kind,
    };
  if (result.outcome === "relocated")
    return {
      kind: "building.relocated",
      buildingId: result.building.id,
      buildingKind: result.building.kind,
    };
  if (result.outcome === "upgraded")
    return {
      kind: "building.upgraded",
      buildingId: result.building.id,
      buildingKind: result.building.kind,
      level: result.building.level as 2 | 3,
    };
  return {
    kind: "building.demolished",
    buildingId: result.building.id,
    buildingKind: result.building.kind,
    refundRate: gameplayTuning.buildingRefundRate,
  };
};

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

  get buildingState(): readonly BuildingState[] {
    return this.buildings.map((building) => ({
      ...building,
      position: { ...building.position },
    }));
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
  ): SettlementCommandOutcome {
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
    return this.outcome(
      { ok: true, outcome: "placed", building },
      subtractResourceBags(resources, cost),
    );
  }

  relocate(
    id: string,
    position: Vector2,
    resources: ResourceBag,
    input: SettlementInputs,
  ): SettlementCommandOutcome {
    const building = this.buildings.find((candidate) => candidate.id === id);
    if (!building)
      return this.rejected({ kind: "unknown-building" }, resources);
    const rejection = this.validate(building.kind, position, input, id);
    if (rejection) return this.rejected(rejection, resources);
    const moved = { ...building, position: roundVector(position) };
    this.buildings = this.buildings.map((candidate) =>
      candidate.id === id ? moved : candidate,
    );
    return this.outcome(
      { ok: true, outcome: "relocated", building: moved },
      resources,
    );
  }

  upgrade(id: string, resources: ResourceBag): SettlementCommandOutcome {
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
    return this.outcome(
      { ok: true, outcome: "upgraded", building: upgraded },
      nextResources,
    );
  }

  demolish(id: string, resources: ResourceBag): SettlementCommandOutcome {
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
    return this.outcome(
      { ok: true, outcome: "demolished", building },
      collectResourcesWithinCapacity(
        resources,
        refund,
        materialCapacityFor(this.buildings),
      ),
    );
  }

  passive(
    delta: number,
    hp: number,
    maxHp: number,
    resources: ResourceBag,
    playerPosition: Vector2,
    nearCampfire: boolean,
  ): SettlementPassiveResult {
    const campfireHealing = nearCampfire
      ? gameplayTuning.baseCampfireHealingPerSecond
      : 0;
    const healingHutHealing = this.buildings
      .filter(
        (building) =>
          building.kind === "Healer" &&
          distance(playerPosition, building.position) <=
            gameplayTuning.healingHutRadiusByLevel[building.level - 1],
      )
      .reduce(
        (total, building) =>
          total + gameplayTuning.healerHealingBonusByLevel[building.level - 1],
        0,
      );
    const nextHp = Math.min(
      maxHp,
      hp + delta * (campfireHealing + healingHutHealing),
    );
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

  nearbyCampfireAt(
    world: WorldIdentity,
    position: Vector2,
  ): SettlementCampfire | null {
    return findNearbyCampfire(position, this.campfiresAround(world, position));
  }
  buildRadiusAt(world: WorldIdentity, position: Vector2): number {
    return settlementBuildRadius(
      this.campfiresAround(world, position),
      gameplayTuning.campfireBuildRadiusByLevel,
    );
  }
  inputsFor(world: WorldIdentity, position: Vector2): SettlementInputs {
    return {
      position,
      campfires: this.campfiresAround(world, position),
      terrainBlocked: this.isTerrainBlocked(world, position),
    };
  }
  private campfiresAround(
    world: WorldIdentity,
    position: Vector2,
  ): SettlementCampfire[] {
    const generated = visibleChunkCoordinates(position).flatMap((coordinate) =>
      generateChunk(world, coordinate).campfires.map((campfire) => ({
        id: campfire.id,
        label: campfire.kind === "home" ? "home campfire" : "wild campfire",
        position: campfire.position,
        level: 1 as const,
      })),
    );
    const playerBuilt = this.buildings
      .filter((building) => building.kind === "Campfire")
      .map((building) => ({
        id: building.id,
        label: "player campfire",
        position: building.position,
        level: building.level,
      }));
    return [...generated, ...playerBuilt];
  }
  private isTerrainBlocked(world: WorldIdentity, position: Vector2): boolean {
    const coordinate = chunkCoordinateFor(position);
    return generateChunk(world, coordinate).obstacles.some(
      (obstacle) => distance(obstacle.position, position) < 0.9,
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
        radius: settlementBuildRadius(
          input.campfires,
          gameplayTuning.campfireBuildRadiusByLevel,
        ),
      };
    return null;
  }
  private outcome(
    result: PlacementResult,
    resources: ResourceBag,
  ): SettlementCommandOutcome {
    return { result, resources, noticeDraft: placementNoticeFor(result) };
  }
  private rejected(
    rejection: PlacementRejection,
    resources: ResourceBag,
  ): SettlementCommandOutcome {
    return this.outcome({ ok: false, rejection }, resources);
  }
}
