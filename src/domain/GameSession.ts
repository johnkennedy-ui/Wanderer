import { gameplayTuning, upgradeDefinitionFor } from "../data/definitions";
import { add, magnitude, normalize, roundVector, scale } from "./math";
import { isMeaningfulMovement, normalizeMovementIntent } from "./inputPolicy";
import type { GamePresentation, GameNotice, PlacementResult } from "./notices";
import type {
  BuildingKind,
  ClassSkillId,
  DestinationCommand,
  FloorDropState,
  MoveCommand,
  PlayerClass,
  ResourceBag,
  CurrentSave,
  UpgradeId,
  ValidCampfireSaveRequest,
  Vector2,
  WorldIdentity,
} from "./types";
import {
  copyVector,
  createFreshSessionState,
  DEFAULT_WORLD,
  hydrateSessionState,
} from "./session/sessionState";
import { floorDropCollectionPolicy } from "./session/floorDropCollectionPolicy";
import {
  advanceAutoCombatPhase,
  advanceEnemyCombatPhase,
} from "./session/combatTickRuntime";
import { advanceProjectileCombatPhase } from "./session/projectileCombatRuntime";
import { resolveMeleeCombatPhase } from "./session/meleeCombatRuntime";
import type {
  RuntimeEnemy,
  RuntimeCrescentAttack,
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
import { projectRuntimeDiagnostics } from "./session/runtimeDiagnostics";
import { ChunkRecipeCache } from "./session/chunkRecipeCache";
import {
  SettlementRuntime,
  type SettlementCommandOutcome,
} from "./session/settlementRuntime";
import {
  clampResourcesToCapacity,
  materialCapacityFor,
} from "./session/economy";
import {
  applyUpgradeEffectToPlayer,
  combatStatsFor,
  describeProgressionEffects,
  applyClassSkillToPlayer,
  applyClassPassiveToPlayer,
  isValidClassSkillChoice,
  movingAttackSpeedMultiplierFor,
  pendingClassSkillChoicesFor,
  playerLevelForExperience,
  playerStatsFor,
} from "./session/progressionRules";
import {
  playerHitRecoveryPresentationFor,
  playerMoveDistanceWithHitRecoveryFor,
} from "./session/hitRecoveryPolicy";

export { selectBossUpgradeChoices } from "./session/bossUpgradeChoices";

interface SessionOptions {
  readonly world?: WorldIdentity;
  readonly saved?: CurrentSave;
}
const isFinitePosition = (position: Vector2): boolean =>
  Number.isFinite(position.x) && Number.isFinite(position.y);
export class GameSession {
  private readonly chunkRecipes = new ChunkRecipeCache();
  private world!: WorldIdentity;
  private player!: { position: Vector2; hp: number; maxHp: number };
  private resources!: ResourceBag;
  private settlement!: SettlementRuntime;
  private enemies!: Map<string, RuntimeEnemy>;
  private projectiles!: RuntimeProjectile[];
  private crescentAttacks!: RuntimeCrescentAttack[];
  private floorDrops!: FloorDropState[];
  private defeatedBossIds!: Set<string>;
  private upgrades!: Set<UpgradeId>;
  private classProgression!: import("./types").ClassProgression;
  private pendingUpgradeChoices!: UpgradeId[];
  private nextProjectileSerial!: number;
  private nextCrescentSerial!: number;
  private nextFloorDropSerial!: number;
  private committedSavePoint!: SettlementCampfire;
  private input!: MoveCommand;
  private destination!: Vector2 | null;
  private elapsed!: number;
  private attackElapsed!: number;
  private playerHitRecoveryEndsAt = 0;
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
  private replaceState(state: SessionState): void {
    this.chunkRecipes.clear();
    this.world = state.world;
    this.player = state.player;
    this.resources = state.resources;
    this.settlement = new SettlementRuntime(
      {
        buildings: state.buildings,
        nextBuildingSerial: state.nextBuildingSerial,
        farmHarvestElapsed: state.farmHarvestElapsed,
      },
      this.chunkRecipes.get,
    );
    this.enemies = state.enemies;
    this.projectiles = state.projectiles;
    this.crescentAttacks = state.crescentAttacks;
    this.floorDrops = state.floorDrops;
    this.defeatedBossIds = state.defeatedBossIds;
    this.upgrades = state.upgrades;
    this.classProgression = state.classProgression;
    this.pendingUpgradeChoices = state.pendingUpgradeChoices;
    this.nextProjectileSerial = state.nextProjectileSerial;
    this.nextCrescentSerial = state.nextCrescentSerial;
    this.nextFloorDropSerial = state.nextFloorDropSerial;
    this.committedSavePoint = state.committedSavePoint;
    this.input = state.input;
    this.destination = state.destination;
    this.elapsed = state.elapsed;
    this.attackElapsed = state.attackElapsed;
    this.playerHitRecoveryEndsAt = 0;
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
    const movementDistance = this.playerMoveDistanceFor(delta);
    const destinationMoving = this.moveTowardDestination(movementDistance);
    const moving = destinationMoving || isMeaningfulMovement(this.input.intent);

    if (moving) {
      if (!destinationMoving)
        this.player.position = roundVector(
          add(this.player.position, scale(this.input.intent, movementDistance)),
        );
      const attackSpeedMultiplier = movingAttackSpeedMultiplierFor(
        this.classProgression,
      );
      if (attackSpeedMultiplier === 0) {
        this.combatStatus = "Moving: basic auto-attack suppressed";
        this.attackElapsed = 0;
      } else {
        this.updateAutoCombat(delta, attackSpeedMultiplier);
        this.combatStatus = this.combatStatus.replace(
          /^(Stationary:|Auto-attacking)/,
          "Moving (50% attack speed):",
        );
      }
      this.settlement.resetHarvest();
    } else {
      this.applyPassiveEffects(delta);
      this.updateAutoCombat(delta);
    }

    this.collectNearbyFloorDrops();
    this.updateEnemyCombat(delta);
    this.ensureNeighborhoodEnemies();
    this.clampPlayerState();
  }

  placeBuilding(kind: BuildingKind, position: Vector2): PlacementResult {
    return this.applySettlementOutcome(
      this.settlement.place(
        kind,
        position,
        this.resources,
        this.world.seed,
        this.settlement.inputsFor(this.world, position),
      ),
    );
  }
  relocateBuilding(id: string, position: Vector2): PlacementResult {
    return this.applySettlementOutcome(
      this.settlement.relocate(
        id,
        position,
        this.resources,
        this.settlement.inputsFor(this.world, position),
      ),
    );
  }
  upgradeBuilding(id: string): PlacementResult {
    return this.applySettlementOutcome(
      this.settlement.upgrade(id, this.resources),
    );
  }
  demolishBuilding(id: string): PlacementResult {
    return this.applySettlementOutcome(
      this.settlement.demolish(id, this.resources),
    );
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
  chooseClass(playerClass: PlayerClass): boolean {
    if (
      this.classProgression.level < 1 ||
      this.classProgression.playerClass !== null
    ) {
      this.notice = { kind: "class.rejected.invalid-choice" };
      return false;
    }
    this.classProgression = { ...this.classProgression, playerClass };
    this.player = applyClassPassiveToPlayer(this.player, playerClass);
    this.notice = { kind: "class.selected", playerClass };
    return true;
  }
  chooseClassSkill(skillId: ClassSkillId): boolean {
    if (!isValidClassSkillChoice(this.classProgression, skillId)) {
      this.notice = { kind: "class-skill.rejected.invalid-choice" };
      return false;
    }
    this.classProgression = {
      ...this.classProgression,
      skillIds: [...this.classProgression.skillIds, skillId],
    };
    this.player = applyClassSkillToPlayer(this.player, skillId);
    this.notice = { kind: "class-skill.selected", skillId };
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
    const savePoint = this.settlement.nearbyCampfireAt(
      this.world,
      this.player.position,
    );
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
        classProgression: this.classProgression,
        nextBuildingSerial: this.settlement.serial,
      },
      committedAt,
      savePoint,
    );
    return { document: save, savePointLabel: savePoint.label };
  }

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
    const visibleChunks = visibleChunksFor(
      this.world,
      this.player.position,
      this.chunkRecipes.get,
    );
    const savePoint = this.settlement.nearbyCampfireAt(
      this.world,
      this.player.position,
    );
    const materialCapacity = materialCapacityFor(this.settlement.buildingState);
    const buildRadius = this.settlement.buildRadiusAt(
      this.world,
      this.player.position,
    );
    const effects = describeProgressionEffects(
      this.settlement.buildingState,
      this.upgrades,
      this.classProgression,
    );
    return projectGamePresentation({
      world: this.world,
      player: this.player,
      playerStats: playerStatsFor(this.classProgression),
      playerHitRecovery: playerHitRecoveryPresentationFor({
        elapsed: this.elapsed,
        recoveryEndsAt: this.playerHitRecoveryEndsAt,
        recoverySeconds: gameplayTuning.playerHitRecoverySeconds,
        flashIntervalSeconds:
          gameplayTuning.playerHitRecoveryFlashIntervalSeconds,
      }),
      resources: this.resources,
      materialCapacity,
      buildRadius,
      enemies: this.enemies,
      projectiles: this.projectiles,
      crescentAttacks: this.crescentAttacks,
      floorDrops: this.floorDrops,
      buildings: this.settlement.buildingState,
      visibleChunks,
      inputSource: this.input.source,
      combatStatus: this.combatStatus,
      effects,
      pendingUpgradeChoices: [...this.pendingUpgradeChoices],
      classProgression: this.classProgression,
      pendingClassChoices:
        this.classProgression.playerClass === null &&
        this.classProgression.level >= 1
          ? ["knight", "wizard", "archer"]
          : [],
      pendingClassSkillChoices: pendingClassSkillChoicesFor(
        this.classProgression,
      ),
      canSave: savePoint !== null,
      savePointLabel: savePoint?.label ?? null,
      notice: this.notice,
      projectileTravelSeconds: gameplayTuning.basicProjectileTravelSeconds,
    });
  }
  /** Immutable diagnostic copy-out; not part of ordinary presentation ports. */
  diagnostics() {
    return projectRuntimeDiagnostics({
      world: this.world,
      player: this.player,
      resources: this.resources,
      buildings: this.settlement.buildingState,
      enemies: this.enemies,
      projectiles: this.projectiles,
      crescentAttacks: this.crescentAttacks,
      floorDrops: this.floorDrops,
      defeatedBossIds: this.defeatedBossIds,
      upgrades: this.upgrades,
      pendingUpgradeChoices: this.pendingUpgradeChoices,
      nextBuildingSerial: this.settlement.serial,
      nextProjectileSerial: this.nextProjectileSerial,
      nextFloorDropSerial: this.nextFloorDropSerial,
      committedSavePoint: this.committedSavePoint,
      input: this.input,
      destination: this.destination,
      elapsed: this.elapsed,
      attackElapsed: this.attackElapsed,
      farmHarvestElapsed: this.settlement.harvestElapsed,
      chunkCache: this.chunkRecipes.diagnostics(),
    });
  }
  private ensureNeighborhoodEnemies(): void {
    const visibleChunks = visibleChunksFor(
      this.world,
      this.player.position,
      this.chunkRecipes.get,
    );
    const drafts = missingVisibleRuntimeEnemyDraftsFor({
      visibleChunks,
      existingEnemies: this.enemies,
      defeatedBossIds: this.defeatedBossIds,
    });
    for (const draft of drafts) this.enemies.set(draft.id, draft);
  }
  private updateAutoCombat(delta: number, attackSpeedMultiplier = 1): void {
    const result = advanceAutoCombatPhase({
      delta,
      attackSpeedMultiplier,
      playerPosition: this.player.position,
      enemies: this.enemies,
      buildings: this.settlement.buildingState,
      upgrades: this.upgrades,
      classProgression: this.classProgression,
      projectiles: this.projectiles,
      crescentAttacks: this.crescentAttacks,
      attackElapsed: this.attackElapsed,
      nextProjectileSerial: this.nextProjectileSerial,
      nextCrescentSerial: this.nextCrescentSerial,
    });
    this.projectiles = result.projectiles;
    this.crescentAttacks = result.crescentAttacks;
    this.attackElapsed = result.attackElapsed;
    this.nextProjectileSerial = result.nextProjectileSerial;
    this.nextCrescentSerial = result.nextCrescentSerial;
    this.combatStatus = result.combatStatus;
    if (result.meleeImpacts.length > 0)
      this.updateMeleeCombat(result.meleeImpacts);
  }
  private updateMeleeCombat(
    impacts: readonly import("./session/combatTickRuntime").MeleeImpact[],
  ): void {
    const result = resolveMeleeCombatPhase({
      impacts,
      elapsed: this.elapsed,
      enemies: this.enemies,
      floorDrops: this.floorDrops,
      defeatedBossIds: this.defeatedBossIds,
      pendingUpgradeChoices: this.pendingUpgradeChoices,
      nextFloorDropSerial: this.nextFloorDropSerial,
      worldSeed: this.world.seed,
      upgrades: this.upgrades,
      floorDropOffsetDistance: gameplayTuning.floorDropOffsetDistance,
    });
    this.enemies = result.enemies;
    this.floorDrops = result.floorDrops;
    this.defeatedBossIds = result.defeatedBossIds;
    this.pendingUpgradeChoices = result.pendingUpgradeChoices;
    this.nextFloorDropSerial = result.nextFloorDropSerial;
    if (result.experienceEarned > 0) {
      const experience =
        this.classProgression.experience + result.experienceEarned;
      this.classProgression = {
        ...this.classProgression,
        experience,
        level: playerLevelForExperience(experience),
      };
    }
    if (result.notice !== null) this.notice = result.notice;
  }
  private updateProjectiles(delta: number): void {
    const result = advanceProjectileCombatPhase({
      delta,
      elapsed: this.elapsed,
      playerHp: this.player.hp,
      playerMaxHp: this.player.maxHp,
      enemies: this.enemies,
      projectiles: this.projectiles,
      floorDrops: this.floorDrops,
      defeatedBossIds: this.defeatedBossIds,
      pendingUpgradeChoices: this.pendingUpgradeChoices,
      nextFloorDropSerial: this.nextFloorDropSerial,
      worldSeed: this.world.seed,
      upgrades: this.upgrades,
      projectileTravelSeconds: gameplayTuning.basicProjectileTravelSeconds,
      floorDropOffsetDistance: gameplayTuning.floorDropOffsetDistance,
    });
    this.player.hp = result.playerHp;
    this.enemies = result.enemies;
    this.projectiles = result.projectiles;
    this.floorDrops = result.floorDrops;
    this.defeatedBossIds = result.defeatedBossIds;
    this.pendingUpgradeChoices = result.pendingUpgradeChoices;
    if (result.experienceEarned > 0) {
      const experience =
        this.classProgression.experience + result.experienceEarned;
      this.classProgression = {
        ...this.classProgression,
        experience,
        level: playerLevelForExperience(experience),
      };
    }
    this.nextFloorDropSerial = result.nextFloorDropSerial;
    if (result.notice !== null) this.notice = result.notice;
  }
  private playerMoveDistanceFor(delta: number): number {
    return playerMoveDistanceWithHitRecoveryFor({
      baseMoveSpeed: combatStatsFor(
        this.settlement.buildingState,
        this.upgrades,
        this.classProgression,
      ).moveSpeed,
      frameStartElapsed: this.elapsed - delta,
      delta,
      recoveryEndsAt: this.playerHitRecoveryEndsAt,
      recoverySeconds: gameplayTuning.playerHitRecoverySeconds,
      speedMultiplier: gameplayTuning.playerHitRecoverySpeedMultiplier,
    });
  }
  private moveTowardDestination(maximumTravel: number): boolean {
    if (this.destination === null) return false;
    const offset = {
      x: this.destination.x - this.player.position.x,
      y: this.destination.y - this.player.position.y,
    };
    const remainingDistance = magnitude(offset);
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
  private updateEnemyCombat(delta: number): void {
    const result = advanceEnemyCombatPhase({
      delta,
      elapsed: this.elapsed,
      player: this.player,
      resources: this.resources,
      enemies: this.enemies,
      committedSavePoint: this.committedSavePoint,
      input: this.input,
      destination: this.destination,
      attackElapsed: this.attackElapsed,
      enemyAttackStandoff: gameplayTuning.enemyAttackStandoff,
      deathResourceLossRate: gameplayTuning.deathResourceLossRate,
      playerHitRecoveryEndsAt: this.playerHitRecoveryEndsAt,
      playerHitRecoverySeconds: gameplayTuning.playerHitRecoverySeconds,
    });
    this.player = result.player;
    this.resources = result.resources;
    this.enemies = result.enemies;
    this.input = result.input;
    this.destination = result.destination;
    this.attackElapsed = result.attackElapsed;
    this.playerHitRecoveryEndsAt = result.playerHitRecoveryEndsAt;
    if (result.notice !== null) this.notice = result.notice;
    if (result.resetHarvest) this.settlement.resetHarvest();
  }
  private collectNearbyFloorDrops(): void {
    if (this.floorDrops.length === 0) return;
    const materialCapacity = materialCapacityFor(this.settlement.buildingState);
    const result = floorDropCollectionPolicy({
      playerPosition: this.player.position,
      floorDrops: this.floorDrops,
      resources: this.resources,
      materialCapacity,
      collectDistance: gameplayTuning.floorDropCollectDistance,
    });
    this.floorDrops = [...result.floorDrops];
    this.resources = result.resources;
    if (result.collectedAny) this.notice = { kind: "drop.collected" };
  }
  private applyPassiveEffects(delta: number): void {
    const result = this.settlement.passive(
      delta,
      this.player.hp,
      this.player.maxHp,
      this.resources,
      this.player.position,
      this.settlement.nearbyCampfireAt(this.world, this.player.position) !==
        null,
    );
    this.player.hp = result.hp;
    this.resources = result.resources;
    if (result.harvested) this.notice = { kind: "farm.harvested" };
  }
  private applySettlementOutcome(
    outcome: SettlementCommandOutcome,
  ): PlacementResult {
    this.resources = outcome.resources;
    this.notice = outcome.noticeDraft;
    return outcome.result;
  }
  private clampPlayerState(): void {
    this.player.hp = Math.max(0, Math.min(this.player.hp, this.player.maxHp));
  }
}
