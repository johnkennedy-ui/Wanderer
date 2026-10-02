import { gameplayTuning } from "../data/definitions";
import { add, roundVector, scale } from "./math";
import { isMeaningfulMovement } from "./inputPolicy";
import type { GamePresentation, GameNotice, PlacementResult } from "./notices";
import type {
  BuildingKind,
  AllocatablePlayerStatKind,
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
  WeaponRelicDropState,
  WorldIdentity,
} from "./types";
import {
  createFreshSessionState,
  DEFAULT_WORLD,
  hydrateSessionState,
} from "./session/sessionState";
import { floorDropCollectionPolicy } from "./session/floorDropCollectionPolicy";
import { collectNearbyWeaponRelics } from "./session/weaponRelicPolicy";
import type {
  RuntimeEnemy,
  RuntimeAttackPresentation,
  RuntimeCrescentAttack,
  RuntimeProjectile,
  SessionState,
  SettlementCampfire,
} from "./session/sessionState";
import { projectGamePresentation } from "./session/readModels";
import { projectRuntimeDiagnostics } from "./session/runtimeDiagnostics";
import { visibleChunksFor } from "./session/worldRuntime";
import {
  ChunkRecipeCache,
  type ChunkRecipeSource,
} from "./session/chunkRecipeCache";
import {
  SettlementRuntime,
  type SettlementCommandOutcome,
} from "./session/settlementRuntime";
import {
  combatStatsFor,
  describeProgressionEffects,
  movingAttackSpeedMultiplierFor,
  pendingClassSkillChoicesFor,
  playerStatsFor,
  statPointsAvailableFor,
} from "./session/progressionRules";
import { playerHitRecoveryPresentationFor } from "./session/hitRecoveryPolicy";
import { EnemyNavigationCache } from "./session/enemyNavigation";
import { isWallKind } from "./session/buildingGeometry";
import {
  advanceDestinationMovement,
  constrainMovement,
  destinationStateFor,
  moveStateFor,
  playerMoveDistanceFor,
} from "./session/movementRuntime";
import {
  classChoiceFor,
  classSkillChoiceFor,
  enemyHealthAdjustmentsFor,
  enemyHealthContextFor,
  experienceResultFor,
  statAllocationFor,
  upgradeChoiceFor,
} from "./session/progressionRuntime";
import {
  visibleEnemyInsertionsFor,
  waveLifecyclePlanFor,
  waveStatusFor,
  worldResetStateFor,
} from "./session/worldLifecycleRuntime";
import {
  settlementCommandOutcomeFor,
  type SettlementCommand,
} from "./session/settlementCommandRuntime";
import {
  campfireSaveRequestFor,
  saveCommitResultFor,
} from "./session/persistenceRuntime";
import {
  autoCombatPhaseFor,
  enemyCombatPhaseFor,
  meleeCombatPhaseFor,
  projectileCombatPhaseFor,
  towerCombatPhaseFor,
} from "./session/combatSessionRuntime";

export { selectBossUpgradeChoices } from "./session/bossUpgradeChoices";

interface SessionOptions {
  readonly world?: WorldIdentity;
  readonly saved?: CurrentSave;
  /** Test-only recipe source; production sessions retain the released generator. */
  readonly chunkRecipeSource?: ChunkRecipeSource;
}
export class GameSession {
  private readonly chunkRecipes: ChunkRecipeCache;
  private world!: WorldIdentity;
  private player!: { position: Vector2; hp: number; maxHp: number };
  private resources!: ResourceBag;
  private settlement!: SettlementRuntime;
  private enemies!: Map<string, RuntimeEnemy>;
  private attackPresentation!: RuntimeAttackPresentation[];
  private projectiles!: RuntimeProjectile[];
  private crescentAttacks!: RuntimeCrescentAttack[];
  private floorDrops!: FloorDropState[];
  private weaponRelicDrops!: WeaponRelicDropState[];
  private defeatedBossIds!: Set<string>;
  private upgrades!: Set<UpgradeId>;
  private classProgression!: import("./types").ClassProgression;
  private pendingUpgradeChoices!: UpgradeId[];
  private nextProjectileSerial!: number;
  private nextCrescentSerial!: number;
  private nextFloorDropSerial!: number;
  private nextAttackEventSerial!: number;
  private towerAttackElapsedById = new Map<string, number>();
  private nextTowerAttackSequence = 1;
  private committedSavePoint!: SettlementCampfire;
  private input!: MoveCommand;
  private destination!: Vector2 | null;
  private elapsed!: number;
  private presentationResetId = 0;
  private attackElapsed!: number;
  private playerHitRecoveryEndsAt = 0;
  private startedWaveIndices = new Set<number>();
  private pendingWaveIndices = new Set<number>();
  private notice!: GameNotice;
  private combatStatus!: string;
  private enemyNavigation = new EnemyNavigationCache();
  constructor(options: SessionOptions = {}) {
    this.chunkRecipes = new ChunkRecipeCache(
      undefined,
      options.chunkRecipeSource,
    );
    this.replaceState(
      options.saved === undefined
        ? createFreshSessionState({ world: options.world ?? DEFAULT_WORLD })
        : hydrateSessionState(options.saved),
    );
    this.ensureNeighborhoodEnemies();
  }
  private replaceState(state: SessionState): void {
    this.presentationResetId += 1;
    this.chunkRecipes.clear();
    this.enemyNavigation.clear();
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
    this.attackPresentation = state.attackPresentation;
    this.projectiles = state.projectiles;
    this.crescentAttacks = state.crescentAttacks;
    this.floorDrops = state.floorDrops;
    this.weaponRelicDrops = state.weaponRelicDrops;
    this.defeatedBossIds = state.defeatedBossIds;
    this.upgrades = state.upgrades;
    this.classProgression = state.classProgression;
    this.pendingUpgradeChoices = state.pendingUpgradeChoices;
    this.nextProjectileSerial = state.nextProjectileSerial;
    this.nextCrescentSerial = state.nextCrescentSerial;
    this.nextFloorDropSerial = state.nextFloorDropSerial;
    this.nextAttackEventSerial = state.nextAttackEventSerial;
    this.towerAttackElapsedById = new Map();
    this.nextTowerAttackSequence = 1;
    this.committedSavePoint = state.committedSavePoint;
    this.input = state.input;
    this.destination = state.destination;
    this.elapsed = state.elapsed;
    this.attackElapsed = state.attackElapsed;
    this.playerHitRecoveryEndsAt = 0;
    this.startedWaveIndices = new Set();
    this.pendingWaveIndices = new Set();
    this.notice = state.notice;
    this.combatStatus = state.combatStatus;
  }
  move(command: MoveCommand): void {
    const next = moveStateFor(command);
    this.destination = next.destination;
    this.input = next.input;
  }
  setDestination(command: DestinationCommand): void {
    const next = destinationStateFor(command);
    if (!next.ok) {
      this.notice = next.notice;
      return;
    }
    this.destination = next.destination;
    this.input = next.input;
  }
  tick(deltaSeconds: number): void {
    const delta = Math.max(0, Math.min(deltaSeconds, 0.1));
    this.elapsed += delta;
    this.attackPresentation = this.attackPresentation.filter(
      (attack) =>
        attack.committedAt >= this.elapsed - (attack.durationSeconds ?? 0.45),
    );
    this.updateWaveLifecycle();
    // Preserve the established contract: a projectile created later in this
    // tick first appears at progress zero and advances on the next tick.
    this.updateProjectiles(delta);
    const movementDistance = playerMoveDistanceFor({
      baseMoveSpeed: combatStatsFor(
        this.settlement.buildingState,
        this.upgrades,
        this.classProgression,
      ).moveSpeed,
      frameStartElapsed: this.elapsed - delta,
      delta,
      recoveryEndsAt: this.playerHitRecoveryEndsAt,
    });
    const destination = advanceDestinationMovement({
      playerPosition: this.player.position,
      input: this.input,
      destination: this.destination,
      elapsed: this.elapsed,
      maximumTravel: movementDistance,
      world: this.world,
      chunkRecipeSource: this.chunkRecipes.get,
      buildings: this.settlement.buildingState,
    });
    this.player.position = destination.playerPosition;
    this.input = destination.input;
    this.destination = destination.destination;
    const destinationMoving = destination.moving;
    const moving = destinationMoving || isMeaningfulMovement(this.input.intent);

    if (moving) {
      if (!destinationMoving)
        this.player.position = roundVector(
          constrainMovement({
            world: this.world,
            from: this.player.position,
            desired: add(
              this.player.position,
              scale(this.input.intent, movementDistance),
            ),
            chunkRecipeSource: this.chunkRecipes.get,
            buildings: this.settlement.buildingState,
          }),
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

    this.updateTowerCombat(delta);
    this.collectNearbyFloorDrops();
    this.collectNearbyWeaponRelics();
    this.updateEnemyCombat(delta);
    this.ensureNeighborhoodEnemies();
    this.clampPlayerState();
  }

  placeBuilding(kind: BuildingKind, position: Vector2): PlacementResult {
    return this.runSettlementCommand({
      kind: "place",
      buildingKind: kind,
      position,
    });
  }
  relocateBuilding(id: string, position: Vector2): PlacementResult {
    return this.runSettlementCommand({ kind: "relocate", id, position });
  }
  upgradeBuilding(id: string): PlacementResult {
    return this.runSettlementCommand({ kind: "upgrade", id });
  }
  demolishBuilding(id: string): PlacementResult {
    return this.runSettlementCommand({ kind: "demolish", id });
  }
  chooseUpgrade(id: UpgradeId): boolean {
    const result = upgradeChoiceFor({
      id,
      pendingUpgradeChoices: this.pendingUpgradeChoices,
      upgrades: this.upgrades,
      player: this.player,
    });
    if (!result.ok) {
      this.notice = result.notice;
      return false;
    }
    this.upgrades.add(result.upgradeId);
    this.player = result.player;
    this.pendingUpgradeChoices = [];
    this.notice = result.notice;
    return true;
  }
  chooseClass(playerClass: PlayerClass): boolean {
    const result = classChoiceFor({
      playerClass,
      progression: this.classProgression,
      player: this.player,
    });
    if (!result.ok) {
      this.notice = result.notice;
      return false;
    }
    this.classProgression = result.progression;
    this.player = result.player;
    this.refreshEnemyHealthForCurrentContext();
    this.notice = result.notice;
    return true;
  }
  /** Allocates one earned point without implying persistence or UI wording. */
  allocateStat(stat: AllocatablePlayerStatKind): boolean {
    const result = statAllocationFor({
      stat,
      progression: this.classProgression,
      player: this.player,
    });
    if (!result.ok) {
      this.notice = result.notice;
      return false;
    }
    this.classProgression = result.progression;
    this.player = result.player;
    this.notice = result.notice;
    return true;
  }
  chooseClassSkill(skillId: ClassSkillId): boolean {
    const result = classSkillChoiceFor({
      skillId,
      progression: this.classProgression,
      player: this.player,
    });
    if (!result.ok) {
      this.notice = result.notice;
      return false;
    }
    this.classProgression = result.progression;
    this.player = result.player;
    this.notice = result.notice;
    return true;
  }

  resetWorld(seed: string): void {
    this.replaceState(
      worldResetStateFor({
        seed,
        elapsed: this.elapsed,
        combatStatus: this.combatStatus,
      }),
    );
    this.ensureNeighborhoodEnemies();
  }

  createValidCampfireSaveRequest(
    committedAt: number,
  ): ValidCampfireSaveRequest | null {
    const result = campfireSaveRequestFor({
      committedAt,
      settlement: this.settlement,
      world: this.world,
      player: this.player,
      resources: this.resources,
      defeatedBossIds: this.defeatedBossIds,
      upgrades: this.upgrades,
      classProgression: this.classProgression,
    });
    if (!result.ok) {
      this.notice = result.notice;
      return null;
    }
    return result.request;
  }

  recordSaveCommitted(document: CurrentSave): void {
    const result = saveCommitResultFor(document);
    this.committedSavePoint = result.committedSavePoint;
    this.notice = result.notice;
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
    const buildRadius = this.settlement.buildRadiusAt(
      this.world,
      this.player.position,
    );
    const effects = describeProgressionEffects(
      this.settlement.buildingState,
      this.upgrades,
      this.classProgression,
    ).filter((effect) => !effect.startsWith("Storage"));
    return projectGamePresentation({
      presentationElapsed: this.elapsed,
      presentationResetId: this.presentationResetId,
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
      buildRadius,
      destination: this.destination,
      enemies: this.enemies,
      attackPresentation: this.attackPresentation,
      projectiles: this.projectiles,
      crescentAttacks: this.crescentAttacks,
      floorDrops: this.floorDrops,
      weaponRelicDrops: this.weaponRelicDrops,
      buildings: this.settlement.buildingState,
      visibleChunks,
      inputSource: this.input.source,
      combatStatus: this.combatStatus,
      wave: this.waveStatus(),
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
      statPointsAvailable: statPointsAvailableFor(this.classProgression),
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
      weaponRelicDrops: this.weaponRelicDrops,
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
    const additions = visibleEnemyInsertionsFor({
      world: this.world,
      playerPosition: this.player.position,
      chunkRecipeSource: this.chunkRecipes.get,
      enemies: this.enemies,
      defeatedBossIds: this.defeatedBossIds,
      enemyHealthContext: enemyHealthContextFor(this.classProgression),
      buildings: this.settlement.buildingState,
    });
    for (const enemy of additions) this.enemies.set(enemy.id, enemy);
  }
  /** Owns the transient timed encounter lifecycle; it is never serialized. */
  private updateWaveLifecycle(): void {
    const plan = waveLifecyclePlanFor({
      world: this.world,
      playerPosition: this.player.position,
      elapsed: this.elapsed,
      enemies: this.enemies,
      startedWaveIndices: this.startedWaveIndices,
      pendingWaveIndices: this.pendingWaveIndices,
      enemyHealthContext: enemyHealthContextFor(this.classProgression),
      chunkRecipeSource: this.chunkRecipes.get,
      buildings: this.settlement.buildingState,
    });
    for (const id of plan.expiredEnemyIds) this.enemies.delete(id);
    if (plan.pendingWaveIndex !== null)
      this.pendingWaveIndices.add(plan.pendingWaveIndex);
    if (plan.startedWave === null) return;
    for (const enemy of plan.startedWave.enemies)
      this.enemies.set(enemy.id, enemy);
    this.pendingWaveIndices.delete(plan.startedWave.waveIndex);
    this.startedWaveIndices.add(plan.startedWave.waveIndex);
    if (plan.startedWave.notice !== null) this.notice = plan.startedWave.notice;
  }
  private waveStatus() {
    return waveStatusFor({ elapsed: this.elapsed, enemies: this.enemies });
  }
  private updateAutoCombat(delta: number, attackSpeedMultiplier = 1): void {
    const result = autoCombatPhaseFor({
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
      nextAttackEventSerial: this.nextAttackEventSerial,
      worldSeed: this.world.seed,
    });
    this.projectiles = result.projectiles;
    this.crescentAttacks = result.crescentAttacks;
    this.attackElapsed = result.attackElapsed;
    this.nextProjectileSerial = result.nextProjectileSerial;
    this.nextCrescentSerial = result.nextCrescentSerial;
    this.nextAttackEventSerial = result.nextAttackEventSerial;
    this.combatStatus = result.combatStatus;
    if (result.presentationAttack !== null)
      this.recordPresentationAttacks([result.presentationAttack]);
    if (result.meleeImpacts.length > 0)
      this.updateMeleeCombat(result.meleeImpacts);
  }
  private updateMeleeCombat(
    impacts: readonly import("./session/combatTickRuntime").MeleeImpact[],
  ): void {
    const result = meleeCombatPhaseFor({
      impacts,
      elapsed: this.elapsed,
      enemies: this.enemies,
      floorDrops: this.floorDrops,
      weaponRelicDrops: this.weaponRelicDrops,
      defeatedBossIds: this.defeatedBossIds,
      pendingUpgradeChoices: this.pendingUpgradeChoices,
      nextFloorDropSerial: this.nextFloorDropSerial,
      worldSeed: this.world.seed,
      upgrades: this.upgrades,
    });
    this.enemies = result.enemies;
    this.floorDrops = result.floorDrops;
    this.weaponRelicDrops = result.weaponRelicDrops;
    this.defeatedBossIds = result.defeatedBossIds;
    this.pendingUpgradeChoices = result.pendingUpgradeChoices;
    this.nextFloorDropSerial = result.nextFloorDropSerial;
    if (result.experienceEarned > 0)
      this.grantExperience(result.experienceEarned);
    if (result.notice !== null) this.notice = result.notice;
  }
  private updateProjectiles(delta: number): void {
    const result = projectileCombatPhaseFor({
      delta,
      elapsed: this.elapsed,
      player: this.player,
      enemies: this.enemies,
      projectiles: this.projectiles,
      floorDrops: this.floorDrops,
      weaponRelicDrops: this.weaponRelicDrops,
      defeatedBossIds: this.defeatedBossIds,
      pendingUpgradeChoices: this.pendingUpgradeChoices,
      nextFloorDropSerial: this.nextFloorDropSerial,
      world: this.world,
      upgrades: this.upgrades,
      buildings: this.settlement.buildingState,
      chunkRecipeSource: this.chunkRecipes.get,
    });
    this.player.hp = result.playerHp;
    this.enemies = result.enemies;
    this.projectiles = result.projectiles;
    this.floorDrops = result.floorDrops;
    this.weaponRelicDrops = result.weaponRelicDrops;
    this.defeatedBossIds = result.defeatedBossIds;
    this.pendingUpgradeChoices = result.pendingUpgradeChoices;
    if (result.experienceEarned > 0)
      this.grantExperience(result.experienceEarned);
    this.nextFloorDropSerial = result.nextFloorDropSerial;
    if (result.notice !== null) this.notice = result.notice;
  }
  private updateTowerCombat(delta: number): void {
    const result = towerCombatPhaseFor({
      delta,
      buildings: this.settlement.buildingState,
      enemies: this.enemies,
      projectiles: this.projectiles,
      elapsedByTowerId: this.towerAttackElapsedById,
      nextProjectileSerial: this.nextProjectileSerial,
      nextAttackSequence: this.nextTowerAttackSequence,
      world: this.world,
      chunkRecipeSource: this.chunkRecipes.get,
    });
    this.projectiles = result.projectiles;
    this.towerAttackElapsedById = result.elapsedByTowerId;
    this.nextProjectileSerial = result.nextProjectileSerial;
    this.nextTowerAttackSequence = result.nextAttackSequence;
    this.crescentAttacks = [...this.crescentAttacks, ...result.sweepAttacks];
    this.recordPresentationAttacks(result.presentationAttacks);
    if (result.meleeImpacts.length > 0)
      this.updateMeleeCombat(result.meleeImpacts);
  }
  private updateEnemyCombat(delta: number): void {
    const result = enemyCombatPhaseFor({
      delta,
      elapsed: this.elapsed,
      player: this.player,
      resources: this.resources,
      enemies: this.enemies,
      committedSavePoint: this.committedSavePoint,
      input: this.input,
      destination: this.destination,
      attackElapsed: this.attackElapsed,
      playerHitRecoveryEndsAt: this.playerHitRecoveryEndsAt,
      world: this.world,
      buildings: this.settlement.buildingState,
      classProgression: this.classProgression,
      upgrades: this.upgrades,
      chunkRecipeSource: this.chunkRecipes.get,
      enemyNavigation: this.enemyNavigation,
    });
    this.player = result.player;
    this.resources = result.resources;
    this.enemies = result.enemies;
    this.input = result.input;
    this.destination = result.destination;
    this.attackElapsed = result.attackElapsed;
    this.playerHitRecoveryEndsAt = result.playerHitRecoveryEndsAt;
    this.recordPresentationAttacks(result.presentationAttacks);
    if (result.notice !== null) this.notice = result.notice;
    if (result.resetHarvest) {
      this.presentationResetId += 1;
      this.attackPresentation = [];
      this.settlement.resetHarvest();
    }
  }
  /** Keeps only a short, renderer-only recovery window for each committed attack. */
  private recordPresentationAttacks(
    attacks: readonly RuntimeAttackPresentation[],
  ): void {
    if (attacks.length === 0) return;
    this.attackPresentation = [
      ...this.attackPresentation,
      ...attacks.map((attack) => ({ ...attack, committedAt: this.elapsed })),
    ].slice(-32);
  }
  private collectNearbyFloorDrops(): void {
    if (this.floorDrops.length === 0) return;
    const result = floorDropCollectionPolicy({
      playerPosition: this.player.position,
      floorDrops: this.floorDrops,
      resources: this.resources,
      collectDistance: gameplayTuning.floorDropCollectDistance,
    });
    this.floorDrops = [...result.floorDrops];
    this.resources = result.resources;
    if (result.collectedAny) this.notice = { kind: "drop.collected" };
  }
  private collectNearbyWeaponRelics(): void {
    if (this.weaponRelicDrops.length === 0) return;
    const result = collectNearbyWeaponRelics({
      playerPosition: this.player.position,
      drops: this.weaponRelicDrops,
      progression: this.classProgression,
      collectDistance: gameplayTuning.floorDropCollectDistance,
    });
    this.weaponRelicDrops = [...result.drops];
    this.classProgression = result.progression;
    if (result.collectedRank !== null && result.playerClass !== null)
      this.notice = {
        kind: "weapon-relic.collected",
        playerClass: result.playerClass,
        weaponRank: result.collectedRank,
      };
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
    if (outcome.result.ok && isWallKind(outcome.result.building.kind))
      this.enemyNavigation.clear();
    return outcome.result;
  }
  private runSettlementCommand(command: SettlementCommand): PlacementResult {
    return this.applySettlementOutcome(
      settlementCommandOutcomeFor({
        command,
        settlement: this.settlement,
        resources: this.resources,
        world: this.world,
        playerPosition: this.player.position,
        committedSavePoint: this.committedSavePoint,
        enemies: this.enemies,
      }),
    );
  }
  /** Applies XP and the identical next-level base-stat grant exactly once. */
  private grantExperience(amount: number): void {
    const result = experienceResultFor({
      amount,
      progression: this.classProgression,
      player: this.player,
    });
    this.classProgression = result.progression;
    this.player = result.player;
    if (result.gainedLevel) this.refreshEnemyHealthForCurrentContext();
  }
  private refreshEnemyHealthForCurrentContext(): void {
    for (const adjustment of enemyHealthAdjustmentsFor(
      this.enemies,
      enemyHealthContextFor(this.classProgression),
    )) {
      const enemy = this.enemies.get(adjustment.id);
      if (enemy === undefined) continue;
      enemy.hp = adjustment.hp;
      enemy.maxHp = adjustment.maxHp;
      enemy.spawnHealthMultiplier = adjustment.spawnHealthMultiplier;
    }
  }
  private clampPlayerState(): void {
    this.player.hp = Math.max(0, Math.min(this.player.hp, this.player.maxHp));
  }
}
