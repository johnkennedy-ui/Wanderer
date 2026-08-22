import {
  buildingDefinitions,
  enemyDefinitions,
  gameplayTuning,
  resourceDefinitions,
  upgradeDefinitionFor,
} from "../data/definitions";
import {
  add,
  distance,
  magnitude,
  normalize,
  roundVector,
  scale,
} from "./math";
import { isMeaningfulMovement, normalizeMovementIntent } from "./inputPolicy";
import { emptyResources, resourceKinds } from "./types";
import type {
  GameNotice,
  GameSnapshot,
  PlacementRejection,
  PlacementResult,
} from "./notices";
import type {
  BuildingKind,
  BuildingState,
  DestinationCommand,
  EnemyKind,
  EnemyState,
  FloorDropState,
  InputSource,
  MoveCommand,
  ResourceBag,
  ReadonlyResourceBag,
  CurrentSave,
  UpgradeId,
  ValidCampfireSaveRequest,
  Vector2,
  WorldIdentity,
} from "./types";
import {
  chunkCoordinateFor,
  chunkKey,
  generateChunk,
  visibleChunkCoordinates,
} from "./world";
import {
  cloneResources,
  copyVector,
  createFreshSessionState,
  DEFAULT_WORLD,
  hydrateSessionState,
} from "./session/sessionState";
import {
  advanceProjectileFlight,
  enemyPursuitPosition,
  liveTargetsInRange,
  projectileDraftFor,
  projectileLaunchDecision,
} from "./session/combatPolicy";
import {
  addResourceBags,
  canAffordResources,
  clampResourcesToCapacity,
  collectResourcesWithinCapacity,
  materialCapacityFor,
  resourcesForLevel,
  scaleResourceBag,
  subtractResourceBags,
} from "./session/economy";
import type {
  RuntimeEnemy,
  RuntimeProjectile,
  SessionState,
  SettlementCampfire,
} from "./session/sessionState";
import { projectGameSnapshot } from "./session/readModels";
import { projectCurrentSave } from "./session/saveProjection";
import {
  findCampfireCoveringPosition,
  findNearbyCampfire,
  settlementBuildRadius,
} from "./session/settlementPolicy";
import { selectBossUpgradeChoices } from "./session/bossUpgradeChoices";
import {
  applyUpgradeEffectToPlayer,
  combatStatsFor,
  describeProgressionEffects,
  projectileUpgradeEffectsFor,
} from "./session/progressionRules";

/** Compatibility export for callers that have not yet moved to inputPolicy. */
export { MOVEMENT_THRESHOLD } from "./inputPolicy";
/** Compatibility export for callers that have not yet moved to bossUpgradeChoices. */
export { selectBossUpgradeChoices } from "./session/bossUpgradeChoices";

interface SessionOptions {
  readonly world?: WorldIdentity;
  readonly saved?: CurrentSave;
}
const isFinitePosition = (position: Vector2): boolean =>
  Number.isFinite(position.x) && Number.isFinite(position.y);

const hashText = (text: string): number => {
  let hash = 2_166_136_261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

/**
 * The sole mutable gameplay authority. It knows no browser, renderer, storage,
 * event listener, or Capacitor API; callers issue explicit commands and read
 * immutable-shaped snapshots.
 */
export class GameSession {
  private world!: WorldIdentity;
  private player!: { position: Vector2; hp: number; maxHp: number };
  private resources!: ResourceBag;
  private buildings!: BuildingState[];
  private enemies!: Map<string, RuntimeEnemy>;
  private projectiles!: RuntimeProjectile[];
  private floorDrops!: FloorDropState[];
  private defeatedBossIds!: Set<string>;
  private upgrades!: Set<UpgradeId>;
  private pendingUpgradeChoices!: UpgradeId[];
  private nextBuildingSerial!: number;
  private nextProjectileSerial!: number;
  private nextFloorDropSerial!: number;
  private committedSavePoint!: SettlementCampfire;
  private input!: MoveCommand;
  private destination!: Vector2 | null;
  private elapsed!: number;
  private attackElapsed!: number;
  private farmHarvestElapsed!: number;
  private notice!: GameNotice;
  private combatStatus!: string;

  constructor(options: SessionOptions = {}) {
    this.replaceState(
      options.saved === undefined
        ? createFreshSessionState({ world: options.world ?? DEFAULT_WORLD })
        : hydrateSessionState(options.saved),
    );
    this.resources = clampResourcesToCapacity(
      this.resources,
      materialCapacityFor(this.buildings),
    );
    this.ensureNeighborhoodEnemies();
  }

  /** The sole lifecycle boundary that replaces instance-owned session state. */
  private replaceState(state: SessionState): void {
    this.world = state.world;
    this.player = state.player;
    this.resources = state.resources;
    this.buildings = state.buildings;
    this.enemies = state.enemies;
    this.projectiles = state.projectiles;
    this.floorDrops = state.floorDrops;
    this.defeatedBossIds = state.defeatedBossIds;
    this.upgrades = state.upgrades;
    this.pendingUpgradeChoices = state.pendingUpgradeChoices;
    this.nextBuildingSerial = state.nextBuildingSerial;
    this.nextProjectileSerial = state.nextProjectileSerial;
    this.nextFloorDropSerial = state.nextFloorDropSerial;
    this.committedSavePoint = state.committedSavePoint;
    this.input = state.input;
    this.destination = state.destination;
    this.elapsed = state.elapsed;
    this.attackElapsed = state.attackElapsed;
    this.farmHarvestElapsed = state.farmHarvestElapsed;
    this.notice = state.notice;
    this.combatStatus = state.combatStatus;
  }

  move(command: MoveCommand): void {
    this.destination = null;
    this.input = {
      intent: normalizeMovementIntent(command.intent),
      source: command.source,
      at: command.at,
    };
  }

  setDestination(command: DestinationCommand): void {
    if (!isFinitePosition(command.destination)) {
      this.notice = { kind: "tap-to-move.rejected.invalid-destination" };
      return;
    }
    this.destination = roundVector(command.destination);
    this.input = {
      intent: { x: 0, y: 0 },
      source: command.source,
      at: command.at,
    };
  }

  tick(deltaSeconds: number): void {
    const delta = Math.max(0, Math.min(deltaSeconds, 0.1));
    this.elapsed += delta;
    this.updateProjectiles(delta);
    const destinationMoving = this.moveTowardDestination(delta);
    const moving = destinationMoving || isMeaningfulMovement(this.input.intent);

    if (moving) {
      if (!destinationMoving)
        this.player.position = roundVector(
          add(
            this.player.position,
            scale(
              this.input.intent,
              combatStatsFor(this.buildings, this.upgrades).moveSpeed * delta,
            ),
          ),
        );
      this.combatStatus = "Moving: basic auto-attack suppressed";
      this.attackElapsed = 0;
      this.farmHarvestElapsed = 0;
    } else {
      this.applyPassiveEffects(delta);
      this.updateAutoCombat(delta);
    }

    this.collectNearbyFloorDrops();
    this.updateEnemyPursuit(delta);
    this.updateEnemyRespawns();
    this.updateEnemyAttacks(delta);
    this.ensureNeighborhoodEnemies();
    this.clampPlayerState();
  }

  placeBuilding(kind: BuildingKind, position: Vector2): PlacementResult {
    const validation = this.validateBuildingPosition(kind, position);
    if (validation !== null) return this.rejectPlacement(validation);
    const cost = resourcesForLevel(buildingDefinitions[kind].baseCost, 1);
    if (!canAffordResources(this.resources, cost))
      return this.rejectPlacement({ kind: "insufficient-resources" });

    const building: BuildingState = {
      id: `building:${hashText(this.world.seed).toString(16)}:${this.nextBuildingSerial.toString().padStart(4, "0")}`,
      kind,
      position: roundVector(position),
      level: 1,
    };
    this.nextBuildingSerial += 1;
    this.resources = subtractResourceBags(this.resources, cost);
    this.buildings = [...this.buildings, building];
    this.notice = {
      kind: "building.placed",
      buildingId: building.id,
      buildingKind: building.kind,
    };
    return { ok: true, outcome: "placed", building };
  }

  relocateBuilding(id: string, position: Vector2): PlacementResult {
    const building = this.buildings.find((candidate) => candidate.id === id);
    if (building === undefined)
      return this.rejectPlacement({ kind: "unknown-building" });
    const validation = this.validateBuildingPosition(
      building.kind,
      position,
      id,
    );
    if (validation !== null) return this.rejectPlacement(validation);
    const moved = { ...building, position: roundVector(position) };
    this.buildings = this.buildings.map((candidate) =>
      candidate.id === id ? moved : candidate,
    );
    this.notice = {
      kind: "building.relocated",
      buildingId: moved.id,
      buildingKind: moved.kind,
    };
    return { ok: true, outcome: "relocated", building: moved };
  }

  upgradeBuilding(id: string): PlacementResult {
    const building = this.buildings.find((candidate) => candidate.id === id);
    if (building === undefined)
      return this.rejectPlacement({ kind: "unknown-building" });
    if (building.level === 3)
      return this.rejectPlacement({ kind: "already-level-3" });
    const nextLevel = (building.level + 1) as 2 | 3;
    const cost = resourcesForLevel(
      buildingDefinitions[building.kind].baseCost,
      nextLevel,
    );
    if (!canAffordResources(this.resources, cost))
      return this.rejectPlacement({ kind: "insufficient-resources" });

    const upgraded: BuildingState = { ...building, level: nextLevel };
    this.resources = subtractResourceBags(this.resources, cost);
    this.buildings = this.buildings.map((candidate) =>
      candidate.id === id ? upgraded : candidate,
    );
    this.resources = clampResourcesToCapacity(
      this.resources,
      materialCapacityFor(this.buildings),
    );
    this.notice = {
      kind: "building.upgraded",
      buildingId: upgraded.id,
      buildingKind: upgraded.kind,
      level: nextLevel,
    };
    return { ok: true, outcome: "upgraded", building: upgraded };
  }

  demolishBuilding(id: string): PlacementResult {
    const building = this.buildings.find((candidate) => candidate.id === id);
    if (building === undefined)
      return this.rejectPlacement({ kind: "unknown-building" });
    const cumulativeCost = [1, 2, 3]
      .filter((level) => level <= building.level)
      .map((level) =>
        resourcesForLevel(buildingDefinitions[building.kind].baseCost, level),
      )
      .reduce(addResourceBags, emptyResources());
    const refund = scaleResourceBag(
      cumulativeCost,
      gameplayTuning.buildingRefundRate,
    );
    this.buildings = this.buildings.filter((candidate) => candidate.id !== id);
    this.resources = collectResourcesWithinCapacity(
      this.resources,
      refund,
      materialCapacityFor(this.buildings),
    );
    this.notice = {
      kind: "building.demolished",
      buildingId: building.id,
      buildingKind: building.kind,
      refundRate: gameplayTuning.buildingRefundRate,
    };
    return { ok: true, outcome: "demolished", building };
  }

  chooseUpgrade(id: UpgradeId): boolean {
    if (
      this.pendingUpgradeChoices.length !== 3 ||
      !this.pendingUpgradeChoices.includes(id) ||
      this.upgrades.has(id)
    ) {
      this.notice = { kind: "upgrade.rejected.invalid-choice" };
      return false;
    }
    this.upgrades.add(id);
    const upgrade = upgradeDefinitionFor(id);
    this.player = applyUpgradeEffectToPlayer(this.player, upgrade.effect);
    this.pendingUpgradeChoices = [];
    this.notice = { kind: "upgrade.applied", upgradeId: id };
    return true;
  }

  resetWorld(seed: string): void {
    const cleanSeed = seed.trim() || DEFAULT_WORLD.seed;
    this.replaceState(
      createFreshSessionState({
        world: {
          seed: cleanSeed,
          generatorVersion: DEFAULT_WORLD.generatorVersion,
        },
        elapsed: this.elapsed,
        notice: { kind: "world.reset", seed: cleanSeed },
        combatStatus: this.combatStatus,
      }),
    );
    this.ensureNeighborhoodEnemies();
  }

  createValidCampfireSaveRequest(
    committedAt: number,
  ): ValidCampfireSaveRequest | null {
    const savePoint = this.nearbyCampfire();
    if (savePoint === null) {
      this.notice = { kind: "save.rejected.not-near-campfire" };
      return null;
    }
    const save = projectCurrentSave(
      {
        world: this.world,
        player: this.player,
        resources: this.resources,
        buildings: this.buildings,
        defeatedBossIds: this.defeatedBossIds,
        upgrades: this.upgrades,
        nextBuildingSerial: this.nextBuildingSerial,
      },
      committedAt,
      savePoint,
    );
    return { document: save, savePointLabel: savePoint.label };
  }

  /** Called by the composition root only after the storage adapter reports success. */
  recordSaveCommitted(document: CurrentSave): void {
    this.committedSavePoint = {
      id: document.savePointId,
      label: "committed campfire",
      position: copyVector(document.savePointPosition),
      level: 1,
    };
    this.notice = {
      kind: "save.committed",
      savePointId: document.savePointId,
    };
  }

  snapshot(): GameSnapshot {
    const visibleChunks = visibleChunkCoordinates(this.player.position).map(
      (coordinate) => generateChunk(this.world, coordinate),
    );
    const moving =
      this.destination !== null || isMeaningfulMovement(this.input.intent);
    const savePoint = this.nearbyCampfire();
    const materialCapacity = materialCapacityFor(this.buildings);
    const buildRadius = this.currentSettlementBuildRadius();
    const combatStats = combatStatsFor(this.buildings, this.upgrades);
    const effects = describeProgressionEffects(this.buildings, this.upgrades);
    const pendingUpgradeChoices = [...this.pendingUpgradeChoices];
    const canSave = savePoint !== null;
    const savePointLabel = savePoint?.label ?? null;
    return projectGameSnapshot({
      world: this.world,
      player: this.player,
      resources: this.resources,
      materialCapacity,
      buildRadius,
      deathResourceLossRate: gameplayTuning.deathResourceLossRate,
      combatStats,
      enemies: this.enemies,
      projectiles: this.projectiles,
      floorDrops: this.floorDrops,
      buildings: this.buildings,
      visibleChunks,
      moving,
      inputSource: this.input.source,
      destination: this.destination,
      combatStatus: this.combatStatus,
      effects,
      defeatedBossIds: this.defeatedBossIds,
      upgrades: this.upgrades,
      pendingUpgradeChoices,
      canSave,
      savePointLabel,
      notice: this.notice,
      projectileTravelSeconds: gameplayTuning.basicProjectileTravelSeconds,
    });
  }

  private ensureNeighborhoodEnemies(): void {
    for (const coordinate of visibleChunkCoordinates(this.player.position)) {
      for (const spawn of generateChunk(this.world, coordinate).spawns) {
        if (spawn.kind === "boss" && this.defeatedBossIds.has(spawn.id))
          continue;
        if (this.enemies.has(spawn.id)) continue;
        const definition = enemyDefinitions[spawn.kind];
        this.enemies.set(spawn.id, {
          id: spawn.id,
          kind: spawn.kind,
          position: copyVector(spawn.position),
          spawnPosition: copyVector(spawn.position),
          hp: Math.ceil(definition.maxHp * spawn.danger.healthMultiplier),
          maxHp: Math.ceil(definition.maxHp * spawn.danger.healthMultiplier),
          damage: Math.max(
            1,
            Math.ceil(definition.damage * spawn.danger.damageMultiplier),
          ),
          dangerTier: spawn.danger.tier,
          dropMultiplier: spawn.danger.dropMultiplier,
          moveSpeed: definition.moveSpeed,
          attackEverySeconds: definition.attackEverySeconds,
          respawnAt: null,
          defeated: false,
          attackElapsed: 0,
        });
      }
    }
  }

  private updateAutoCombat(delta: number): void {
    const stats = combatStatsFor(this.buildings, this.upgrades);
    const targets = liveTargetsInRange({
      playerPosition: this.player.position,
      targets: this.enemies.values(),
      range: stats.attackRange,
    });
    const decision = projectileLaunchDecision({
      targets,
      attackElapsed: this.attackElapsed,
      delta,
      attackIntervalSeconds: stats.attackIntervalSeconds,
    });
    if (decision.kind === "no-target") {
      this.combatStatus = "Stationary: seeking a target";
      this.attackElapsed = decision.attackElapsed;
      return;
    }
    this.attackElapsed = decision.attackElapsed;
    this.combatStatus = `Auto-attacking ${decision.target.kind} (${Math.ceil(decision.target.hp)}/${decision.target.maxHp})`;
    if (decision.kind === "waiting") return;

    const projectileEffects = projectileUpgradeEffectsFor(this.upgrades);
    const draft = projectileDraftFor({
      playerPosition: this.player.position,
      target: decision.target,
      targets,
      attackDamage: stats.attackDamage,
      chainTargets: stats.chainTargets,
      chainDamageMultiplier: projectileEffects.chainDamageMultiplier,
      hitHeal: projectileEffects.hitHeal,
    });
    this.projectiles.push({
      id: "projectile:" + this.nextProjectileSerial.toString().padStart(4, "0"),
      origin: draft.origin,
      targetId: draft.targetId,
      targetPosition: draft.targetPosition,
      damage: draft.damage,
      chainTargetIds: draft.chainTargetIds,
      chainDamage: draft.chainDamage,
      hitHeal: draft.hitHeal,
      elapsed: 0,
    });
    this.nextProjectileSerial += 1;
  }

  private updateProjectiles(delta: number): void {
    const completed: RuntimeProjectile[] = [];
    this.projectiles = this.projectiles.filter((projectile) => {
      const flight = advanceProjectileFlight({
        elapsed: projectile.elapsed,
        delta,
        travelSeconds: gameplayTuning.basicProjectileTravelSeconds,
      });
      projectile.elapsed = flight.elapsed;
      if (!flight.completed) return true;
      completed.push(projectile);
      return false;
    });
    for (const projectile of completed) this.resolveProjectileHit(projectile);
  }

  private resolveProjectileHit(projectile: RuntimeProjectile): void {
    const primary = this.enemies.get(projectile.targetId);
    let landedHits =
      primary !== undefined && this.resolveBasicHit(primary, projectile.damage)
        ? 1
        : 0;
    for (const targetId of projectile.chainTargetIds) {
      const secondary = this.enemies.get(targetId);
      if (
        secondary !== undefined &&
        this.resolveBasicHit(secondary, projectile.chainDamage)
      )
        landedHits += 1;
    }
    if (landedHits > 0 && projectile.hitHeal > 0)
      this.player.hp = Math.min(
        this.player.maxHp,
        this.player.hp + landedHits * projectile.hitHeal,
      );
  }

  private resolveBasicHit(enemy: RuntimeEnemy, amount: number): boolean {
    if (enemy.defeated) return false;
    enemy.hp -= amount;
    if (enemy.hp <= 0) this.defeatEnemy(enemy);
    return true;
  }

  private updateEnemyRespawns(): void {
    for (const enemy of this.enemies.values()) {
      if (
        !enemy.defeated ||
        enemy.respawnAt === null ||
        this.elapsed < enemy.respawnAt
      )
        continue;
      enemy.defeated = false;
      enemy.hp = enemy.maxHp;
      enemy.position = copyVector(enemy.spawnPosition);
      enemy.respawnAt = null;
      enemy.attackElapsed = 0;
    }
  }

  private moveTowardDestination(delta: number): boolean {
    if (this.destination === null) return false;
    const offset = {
      x: this.destination.x - this.player.position.x,
      y: this.destination.y - this.player.position.y,
    };
    const remainingDistance = magnitude(offset);
    const maximumTravel =
      combatStatsFor(this.buildings, this.upgrades).moveSpeed * delta;
    if (
      remainingDistance <= gameplayTuning.tapToMoveArrivalDistance ||
      maximumTravel >= remainingDistance
    ) {
      this.player.position = copyVector(this.destination);
      this.destination = null;
      this.input = {
        intent: { x: 0, y: 0 },
        source: "system",
        at: this.elapsed,
      };
      return false;
    }
    this.player.position = roundVector(
      add(this.player.position, scale(normalize(offset), maximumTravel)),
    );
    return true;
  }

  private updateEnemyPursuit(delta: number): void {
    for (const enemy of this.enemies.values()) {
      if (enemy.defeated) continue;
      enemy.position = enemyPursuitPosition({
        enemyPosition: enemy.position,
        playerPosition: this.player.position,
        moveSpeed: enemy.moveSpeed,
        delta,
        attackStandoff: gameplayTuning.enemyAttackStandoff,
      });
    }
  }

  private updateEnemyAttacks(delta: number): void {
    for (const enemy of this.enemies.values()) {
      if (
        enemy.defeated ||
        distance(this.player.position, enemy.position) >
          gameplayTuning.enemyAttackStandoff
      )
        continue;
      enemy.attackElapsed += delta;
      if (enemy.attackElapsed < enemy.attackEverySeconds) continue;
      enemy.attackElapsed = 0;
      this.player.hp -= enemy.damage;
      if (this.player.hp <= 0) {
        this.handleDeath();
        return;
      }
    }
  }

  private handleDeath(): void {
    const carriedLoss = scaleResourceBag(
      this.resources,
      gameplayTuning.deathResourceLossRate,
    );
    this.resources = subtractResourceBags(this.resources, carriedLoss);
    this.player.position = copyVector(this.committedSavePoint.position);
    this.player.hp = this.player.maxHp;
    this.input = { intent: { x: 0, y: 0 }, source: "system", at: this.elapsed };
    this.destination = null;
    this.attackElapsed = 0;
    this.farmHarvestElapsed = 0;
    this.notice = {
      kind: "player.died",
      savePointLabel: this.committedSavePoint.label,
      resourceLossRate: gameplayTuning.deathResourceLossRate,
    };
  }

  private defeatEnemy(enemy: RuntimeEnemy): void {
    const definition = enemyDefinitions[enemy.kind];
    this.floorDrops = [
      ...this.floorDrops,
      ...this.createFloorDrops(
        enemy,
        scaleResourceBag(definition.drops, enemy.dropMultiplier),
      ),
    ];
    enemy.defeated = true;
    if (enemy.kind === "boss") {
      this.defeatedBossIds.add(enemy.id);
      this.pendingUpgradeChoices = selectBossUpgradeChoices(
        this.world.seed,
        this.upgrades,
      );
      this.notice = {
        kind: "boss.defeated",
        hasUpgradeChoices: this.pendingUpgradeChoices.length === 3,
      };
    } else {
      enemy.respawnAt = this.elapsed + (definition.respawnSeconds ?? 0);
      this.notice = {
        kind: "enemy.defeated",
        enemyKind: enemy.kind,
        respawns: true,
      };
    }
  }

  private createFloorDrops(
    enemy: RuntimeEnemy,
    resources: ReadonlyResourceBag,
  ): FloorDropState[] {
    const droppedResources = resourceKinds.filter(
      (resource) => resources[resource] > 0,
    );
    const serial = this.nextFloorDropSerial;
    this.nextFloorDropSerial += 1;
    const startAngle = ((hashText(enemy.id) % 360) * Math.PI) / 180;
    return droppedResources.map((resource, index) => {
      const angle =
        startAngle + (index * Math.PI * 2) / droppedResources.length;
      return {
        id: `drop:${enemy.id}:${serial}:${resource}`,
        resource,
        amount: resources[resource],
        position: roundVector(
          add(enemy.position, {
            x: Math.cos(angle) * gameplayTuning.floorDropOffsetDistance,
            y: Math.sin(angle) * gameplayTuning.floorDropOffsetDistance,
          }),
        ),
      };
    });
  }

  private collectNearbyFloorDrops(): void {
    if (this.floorDrops.length === 0) return;
    const remaining: FloorDropState[] = [];
    let collectedAny = false;
    const materialCapacity = materialCapacityFor(this.buildings);
    for (const drop of this.floorDrops) {
      if (
        distance(this.player.position, drop.position) >
        gameplayTuning.floorDropCollectDistance
      ) {
        remaining.push(drop);
        continue;
      }
      const capacityRemaining = resourceDefinitions[drop.resource]
        .storageLimited
        ? Math.max(0, materialCapacity - this.resources[drop.resource])
        : Number.POSITIVE_INFINITY;
      const collectedAmount = Math.min(drop.amount, capacityRemaining);
      if (collectedAmount <= 0) {
        remaining.push(drop);
        continue;
      }
      const resources = cloneResources(this.resources);
      resources[drop.resource] += collectedAmount;
      this.resources = clampResourcesToCapacity(resources, materialCapacity);
      collectedAny = true;
      if (collectedAmount < drop.amount)
        remaining.push({ ...drop, amount: drop.amount - collectedAmount });
    }
    this.floorDrops = remaining;
    if (collectedAny) this.notice = { kind: "drop.collected" };
  }

  private applyPassiveEffects(delta: number): void {
    const nearby = this.nearbyCampfire();
    if (nearby !== null) {
      const healing =
        gameplayTuning.baseCampfireHealingPerSecond +
        this.buildings
          .filter((building) => building.kind === "Healer")
          .reduce(
            (total, building) =>
              total +
              gameplayTuning.healerHealingBonusByLevel[building.level - 1],
            0,
          );
      this.player.hp = Math.min(
        this.player.maxHp,
        this.player.hp + delta * healing,
      );
    }

    const farms = this.buildings.filter((building) => building.kind === "Farm");
    if (farms.length === 0) {
      this.farmHarvestElapsed = 0;
      return;
    }
    this.farmHarvestElapsed += delta;
    if (this.farmHarvestElapsed < gameplayTuning.farmHarvestEverySeconds)
      return;
    this.farmHarvestElapsed = 0;
    const harvest = farms
      .map((farm) => gameplayTuning.farmHarvestByLevel[farm.level - 1])
      .reduce(addResourceBags, emptyResources());
    this.resources = collectResourcesWithinCapacity(
      this.resources,
      harvest,
      materialCapacityFor(this.buildings),
    );
    this.notice = { kind: "farm.harvested" };
  }

  private validateBuildingPosition(
    kind: BuildingKind,
    position: Vector2,
    ignoredId?: string,
  ): PlacementRejection | null {
    if (!isFinitePosition(position)) return { kind: "invalid-coordinates" };
    if (this.isTerrainBlocked(position)) return { kind: "blocked-terrain" };
    if (
      this.buildings.some(
        (building) =>
          building.id !== ignoredId &&
          distance(building.position, position) < 1.25,
      )
    ) {
      return { kind: "overlaps-existing-building" };
    }
    if (kind !== "Campfire") {
      const campfire = findCampfireCoveringPosition(
        position,
        this.settlementCampfiresAround(position),
        gameplayTuning.campfireBuildRadiusByLevel,
      );
      if (campfire === undefined) {
        const nearestRadius = this.currentSettlementBuildRadius();
        return { kind: "outside-settlement-radius", radius: nearestRadius };
      }
    }
    return null;
  }

  private isTerrainBlocked(position: Vector2): boolean {
    const coordinate = chunkCoordinateFor(position);
    return generateChunk(this.world, coordinate).obstacles.some(
      (obstacle) => distance(obstacle.position, position) < 0.9,
    );
  }

  private settlementCampfiresAround(position: Vector2): SettlementCampfire[] {
    const base = visibleChunkCoordinates(position).flatMap((coordinate) =>
      generateChunk(this.world, coordinate).campfires.map((campfire) => ({
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
    return [...base, ...playerBuilt];
  }

  private nearbyCampfire(): SettlementCampfire | null {
    return findNearbyCampfire(
      this.player.position,
      this.settlementCampfiresAround(this.player.position),
    );
  }

  private currentSettlementBuildRadius(): number {
    return settlementBuildRadius(
      this.settlementCampfiresAround(this.player.position),
      gameplayTuning.campfireBuildRadiusByLevel,
    );
  }

  private rejectPlacement(rejection: PlacementRejection): PlacementResult {
    this.notice = { kind: "building.rejected", rejection };
    return { ok: false, rejection };
  }

  private clampPlayerState(): void {
    this.player.hp = Math.max(0, Math.min(this.player.hp, this.player.maxHp));
  }
}
