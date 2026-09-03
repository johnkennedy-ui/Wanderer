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
  GamePresentation,
  GameNotice,
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
  enemyAttackResolutionFor,
  enemyRespawnResolutionFor,
  floorDropDraftFor,
  projectileImpactResolutionFor,
} from "./session/combatResolutionPolicy";
import type {
  RuntimeEnemy,
  RuntimeProjectile,
  SessionState,
  SettlementCampfire,
} from "./session/sessionState";
import {
  missingVisibleRuntimeEnemyDraftsFor,
  visibleChunksFor,
} from "./session/worldRuntime";
import { projectGamePresentation } from "./session/readModels";
import { projectCurrentSave } from "./session/saveProjection";
import { SettlementRuntime } from "./session/settlementRuntime";
import {
  clampResourcesToCapacity,
  materialCapacityFor,
  scaleResourceBag,
  subtractResourceBags,
} from "./session/economy";
import { selectBossUpgradeChoices } from "./session/bossUpgradeChoices";
import {
  applyUpgradeEffectToPlayer,
  combatStatsFor,
  describeProgressionEffects,
  projectileUpgradeEffectsFor,
} from "./session/progressionRules";

/** Compatibility export for callers that have not yet moved to bossUpgradeChoices. */
export { selectBossUpgradeChoices } from "./session/bossUpgradeChoices";

interface SessionOptions {
  readonly world?: WorldIdentity;
  readonly saved?: CurrentSave;
}
const isFinitePosition = (position: Vector2): boolean =>
  Number.isFinite(position.x) && Number.isFinite(position.y);
/**
 * The sole mutable gameplay authority. It knows no browser, renderer, storage,
 * event listener, or Capacitor API; callers issue explicit commands and read
 * immutable-shaped presentation results.
 */
export class GameSession {
  private world!: WorldIdentity;
  private player!: { position: Vector2; hp: number; maxHp: number };
  private resources!: ResourceBag;
  private settlement!: SettlementRuntime;
  private enemies!: Map<string, RuntimeEnemy>;
  private projectiles!: RuntimeProjectile[];
  private floorDrops!: FloorDropState[];
  private defeatedBossIds!: Set<string>;
  private upgrades!: Set<UpgradeId>;
  private pendingUpgradeChoices!: UpgradeId[];
  private nextProjectileSerial!: number;
  private nextFloorDropSerial!: number;
  private committedSavePoint!: SettlementCampfire;
  private input!: MoveCommand;
  private destination!: Vector2 | null;
  private elapsed!: number;
  private attackElapsed!: number;
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
      materialCapacityFor(this.settlement.buildingState),
    );
    this.ensureNeighborhoodEnemies();
  }
  /** The sole lifecycle boundary that replaces instance-owned session state. */
  private replaceState(state: SessionState): void {
    this.world = state.world;
    this.player = state.player;
    this.resources = state.resources;
    this.settlement = new SettlementRuntime({
      buildings: state.buildings,
      nextBuildingSerial: state.nextBuildingSerial,
      farmHarvestElapsed: state.farmHarvestElapsed,
    });
    this.enemies = state.enemies;
    this.projectiles = state.projectiles;
    this.floorDrops = state.floorDrops;
    this.defeatedBossIds = state.defeatedBossIds;
    this.upgrades = state.upgrades;
    this.pendingUpgradeChoices = state.pendingUpgradeChoices;
    this.nextProjectileSerial = state.nextProjectileSerial;
    this.nextFloorDropSerial = state.nextFloorDropSerial;
    this.committedSavePoint = state.committedSavePoint;
    this.input = state.input;
    this.destination = state.destination;
    this.elapsed = state.elapsed;
    this.attackElapsed = state.attackElapsed;
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
              combatStatsFor(this.settlement.buildingState, this.upgrades)
                .moveSpeed * delta,
            ),
          ),
        );
      this.combatStatus = "Moving: basic auto-attack suppressed";
      this.attackElapsed = 0;
      this.settlement.resetHarvest();
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

  // prettier-ignore
  placeBuilding(kind: BuildingKind, position: Vector2): PlacementResult { const outcome = this.settlement.place(kind, position, this.resources, this.world.seed, this.settlementInputs(position)); this.resources = outcome.resources; this.publishPlacement(outcome.result); return outcome.result; }
  // prettier-ignore
  relocateBuilding(id: string, position: Vector2): PlacementResult { const outcome = this.settlement.relocate(id, position, this.resources, this.settlementInputs(position)); this.resources = outcome.resources; this.publishPlacement(outcome.result); return outcome.result; }
  // prettier-ignore
  upgradeBuilding(id: string): PlacementResult { const outcome = this.settlement.upgrade(id, this.resources); this.resources = outcome.resources; this.publishPlacement(outcome.result); return outcome.result; }
  // prettier-ignore
  demolishBuilding(id: string): PlacementResult { const outcome = this.settlement.demolish(id, this.resources); this.resources = outcome.resources; this.publishPlacement(outcome.result); return outcome.result; }
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
        buildings: this.settlement.buildingState,
        defeatedBossIds: this.defeatedBossIds,
        upgrades: this.upgrades,
        nextBuildingSerial: this.settlement.serial,
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

  presentation(): GamePresentation {
    const visibleChunks = visibleChunksFor(this.world, this.player.position);
    const savePoint = this.nearbyCampfire();
    const materialCapacity = materialCapacityFor(this.settlement.buildingState);
    const buildRadius = this.currentSettlementBuildRadius();
    const effects = describeProgressionEffects(
      this.settlement.buildingState,
      this.upgrades,
    );
    const pendingUpgradeChoices = [...this.pendingUpgradeChoices];
    const canSave = savePoint !== null;
    const savePointLabel = savePoint?.label ?? null;
    return projectGamePresentation({
      world: this.world,
      player: this.player,
      resources: this.resources,
      materialCapacity,
      buildRadius,
      enemies: this.enemies,
      projectiles: this.projectiles,
      floorDrops: this.floorDrops,
      buildings: this.settlement.buildingState,
      visibleChunks,
      inputSource: this.input.source,
      combatStatus: this.combatStatus,
      effects,
      pendingUpgradeChoices,
      canSave,
      savePointLabel,
      notice: this.notice,
      projectileTravelSeconds: gameplayTuning.basicProjectileTravelSeconds,
    });
  }
  private ensureNeighborhoodEnemies(): void {
    const visibleChunks = visibleChunksFor(this.world, this.player.position);
    const drafts = missingVisibleRuntimeEnemyDraftsFor({
      visibleChunks,
      existingEnemies: this.enemies,
      defeatedBossIds: this.defeatedBossIds,
    });
    for (const draft of drafts) this.enemies.set(draft.id, draft);
  }
  private updateAutoCombat(delta: number): void {
    const stats = combatStatsFor(this.settlement.buildingState, this.upgrades);
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
    const resolution = projectileImpactResolutionFor({
      targets: this.enemies,
      primaryTargetId: projectile.targetId,
      primaryDamage: projectile.damage,
      chainTargetIds: projectile.chainTargetIds,
      chainDamage: projectile.chainDamage,
    });
    for (const impact of resolution.impacts) {
      const enemy = this.enemies.get(impact.targetId);
      if (enemy === undefined || enemy.defeated) continue;
      enemy.hp = impact.nextHp;
      if (impact.lethal) this.defeatEnemy(enemy);
    }
    if (resolution.landedHitCount > 0 && projectile.hitHeal > 0)
      this.player.hp = Math.min(
        this.player.maxHp,
        this.player.hp + resolution.landedHitCount * projectile.hitHeal,
      );
  }
  private updateEnemyRespawns(): void {
    for (const enemy of this.enemies.values()) {
      const resolution = enemyRespawnResolutionFor({
        defeated: enemy.defeated,
        respawnAt: enemy.respawnAt,
        elapsed: this.elapsed,
        maxHp: enemy.maxHp,
        spawnPosition: enemy.spawnPosition,
      });
      if (resolution.kind !== "ready") continue;
      enemy.defeated = resolution.defeated;
      enemy.hp = resolution.hp;
      enemy.position = resolution.position;
      enemy.respawnAt = resolution.respawnAt;
      enemy.attackElapsed = resolution.attackElapsed;
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
      combatStatsFor(this.settlement.buildingState, this.upgrades).moveSpeed *
      delta;
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
      const resolution = enemyAttackResolutionFor({
        defeated: enemy.defeated,
        inAttackRange:
          distance(this.player.position, enemy.position) <=
          gameplayTuning.enemyAttackStandoff,
        attackElapsed: enemy.attackElapsed,
        attackEverySeconds: enemy.attackEverySeconds,
        damage: enemy.damage,
        playerHp: this.player.hp,
        delta,
      });
      if (resolution.kind === "inactive") continue;
      enemy.attackElapsed = resolution.attackElapsed;
      if (resolution.kind === "waiting") continue;
      this.player.hp = resolution.nextPlayerHp;
      if (resolution.playerDefeated) {
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
    this.settlement.resetHarvest();
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
  ): readonly FloorDropState[] {
    const serial = this.nextFloorDropSerial;
    this.nextFloorDropSerial += 1;
    return floorDropDraftFor({
      enemyId: enemy.id,
      enemyPosition: enemy.position,
      serial,
      resources,
      resourceOrder: resourceKinds,
      rules: { offsetDistance: gameplayTuning.floorDropOffsetDistance },
    });
  }
  private collectNearbyFloorDrops(): void {
    if (this.floorDrops.length === 0) return;
    const remaining: FloorDropState[] = [];
    let collectedAny = false;
    const materialCapacity = materialCapacityFor(this.settlement.buildingState);
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
    const result = this.settlement.passive(
      delta,
      this.player.hp,
      this.player.maxHp,
      this.resources,
      this.nearbyCampfire() !== null,
    );
    this.player.hp = result.hp;
    this.resources = result.resources;
    if (result.harvested) this.notice = { kind: "farm.harvested" };
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
    const playerBuilt = this.settlement.buildingState
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
    return this.settlement.nearby(
      this.player.position,
      this.settlementCampfiresAround(this.player.position),
    );
  }
  private currentSettlementBuildRadius(): number {
    return this.settlement.buildRadius(
      this.settlementCampfiresAround(this.player.position),
    );
  }
  private rejectPlacement(rejection: PlacementRejection): PlacementResult {
    this.notice = { kind: "building.rejected", rejection };
    return { ok: false, rejection };
  }
  private settlementInputs(position: Vector2) {
    return {
      position,
      campfires: this.settlementCampfiresAround(position),
      terrainBlocked: this.isTerrainBlocked(position),
    };
  }
  // prettier-ignore
  private publishPlacement(result: PlacementResult): void { if (!result.ok) { this.notice = { kind: "building.rejected", rejection: result.rejection }; return; } const b = result.building; if (result.outcome === "placed") this.notice = { kind: "building.placed", buildingId: b.id, buildingKind: b.kind }; else if (result.outcome === "relocated") this.notice = { kind: "building.relocated", buildingId: b.id, buildingKind: b.kind }; else if (result.outcome === "upgraded") this.notice = { kind: "building.upgraded", buildingId: b.id, buildingKind: b.kind, level: b.level as 2 | 3 }; else this.notice = { kind: "building.demolished", buildingId: b.id, buildingKind: b.kind, refundRate: gameplayTuning.buildingRefundRate }; }
  private clampPlayerState(): void {
    this.player.hp = Math.max(0, Math.min(this.player.hp, this.player.maxHp));
  }
}
