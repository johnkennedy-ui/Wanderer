import {
  buildingDefinitions,
  enemyDefinitions,
  gameplayTuning,
  resourceDefinitions,
  upgradeDefinitionFor,
  upgradeDefinitions,
  type UpgradeEffect,
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
import { commonResourceKinds, emptyResources, resourceKinds } from "./types";
import type {
  BuildingKind,
  BuildingState,
  CombatStats,
  DestinationCommand,
  EnemyKind,
  EnemyState,
  FloorDropState,
  GameSnapshot,
  InputSource,
  MoveCommand,
  PlacementResult,
  ProjectileState,
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
import type {
  RuntimeEnemy,
  RuntimeProjectile,
  SessionState,
  SettlementCampfire,
} from "./session/sessionState";
import { projectCurrentSave } from "./session/saveProjection";

/** Compatibility export for callers that have not yet moved to inputPolicy. */
export { MOVEMENT_THRESHOLD } from "./inputPolicy";

interface SessionOptions {
  readonly world?: WorldIdentity;
  readonly saved?: CurrentSave;
}
const isFinitePosition = (position: Vector2): boolean =>
  Number.isFinite(position.x) && Number.isFinite(position.y);

const exhaustUpgradeEffect = (effect: never): never => {
  throw new Error(`Unhandled upgrade effect: ${JSON.stringify(effect)}`);
};

const hashText = (text: string): number => {
  let hash = 2_166_136_261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

const amountForLevel = (
  resources: ReadonlyResourceBag,
  level: number,
): ResourceBag => {
  const scaled = emptyResources();
  for (const kind of resourceKinds) scaled[kind] = resources[kind] * level;
  return scaled;
};

const addResources = (
  left: ReadonlyResourceBag,
  right: ReadonlyResourceBag,
): ResourceBag => {
  const total = emptyResources();
  for (const kind of resourceKinds) total[kind] = left[kind] + right[kind];
  return total;
};

const subtractResources = (
  left: ReadonlyResourceBag,
  right: ReadonlyResourceBag,
): ResourceBag => {
  const total = emptyResources();
  for (const kind of resourceKinds) total[kind] = left[kind] - right[kind];
  return total;
};

const scaleResources = (
  resources: ReadonlyResourceBag,
  multiplier: number,
): ResourceBag => {
  const scaled = emptyResources();
  for (const kind of resourceKinds)
    scaled[kind] = Math.floor(resources[kind] * multiplier);
  return scaled;
};

const canAfford = (
  have: ReadonlyResourceBag,
  cost: ReadonlyResourceBag,
): boolean => resourceKinds.every((kind) => have[kind] >= cost[kind]);

/**
 * Returns exactly three deterministic, distinct, currently unowned choices.
 * It deliberately offers no fallback when fewer than three upgrades remain.
 */
export const selectBossUpgradeChoices = (
  seed: string,
  owned: Iterable<UpgradeId>,
): UpgradeId[] => {
  const ownedIds = new Set(owned);
  const available = upgradeDefinitions
    .map((upgrade) => upgrade.id)
    .filter((id) => !ownedIds.has(id));
  if (available.length < 3) return [];
  const start = hashText(`${seed}|boss:ember-wyrm`) % available.length;
  return [0, 1, 2].map(
    (offset) => available[(start + offset) % available.length],
  );
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
  private message!: string;
  private combatStatus!: string;

  constructor(options: SessionOptions = {}) {
    this.replaceState(
      options.saved === undefined
        ? createFreshSessionState({ world: options.world ?? DEFAULT_WORLD })
        : hydrateSessionState(options.saved),
    );
    this.resources = this.clampResourcesToCapacity(this.resources);
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
    this.message = state.message;
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
      this.message = "Tap-to-move ignored an invalid destination.";
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
            scale(this.input.intent, this.combatStats().moveSpeed * delta),
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
    const cost = amountForLevel(buildingDefinitions[kind].baseCost, 1);
    if (!canAfford(this.resources, cost))
      return this.rejectPlacement("insufficient resources");

    const building: BuildingState = {
      id: `building:${hashText(this.world.seed).toString(16)}:${this.nextBuildingSerial.toString().padStart(4, "0")}`,
      kind,
      position: roundVector(position),
      level: 1,
    };
    this.nextBuildingSerial += 1;
    this.resources = subtractResources(this.resources, cost);
    this.buildings = [...this.buildings, building];
    this.message = `${kind} placed. It is runtime-only until an explicit campfire save.`;
    return { ok: true, reason: "placed", building };
  }

  relocateBuilding(id: string, position: Vector2): PlacementResult {
    const building = this.buildings.find((candidate) => candidate.id === id);
    if (building === undefined) return this.rejectPlacement("unknown building");
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
    this.message = `${building.kind} relocated atomically. Save at a campfire to commit it.`;
    return { ok: true, reason: "relocated", building: moved };
  }

  upgradeBuilding(id: string): PlacementResult {
    const building = this.buildings.find((candidate) => candidate.id === id);
    if (building === undefined) return this.rejectPlacement("unknown building");
    if (building.level === 3) return this.rejectPlacement("already level 3");
    const nextLevel = (building.level + 1) as 2 | 3;
    const cost = amountForLevel(
      buildingDefinitions[building.kind].baseCost,
      nextLevel,
    );
    if (!canAfford(this.resources, cost))
      return this.rejectPlacement("insufficient resources");

    const upgraded: BuildingState = { ...building, level: nextLevel };
    this.resources = subtractResources(this.resources, cost);
    this.buildings = this.buildings.map((candidate) =>
      candidate.id === id ? upgraded : candidate,
    );
    this.resources = this.clampResourcesToCapacity(this.resources);
    this.message = `${building.kind} upgraded to level ${nextLevel}; ${buildingDefinitions[building.kind].levelEffects[nextLevel - 1]} The change remains unsaved.`;
    return { ok: true, reason: "upgraded", building: upgraded };
  }

  demolishBuilding(id: string): PlacementResult {
    const building = this.buildings.find((candidate) => candidate.id === id);
    if (building === undefined) return this.rejectPlacement("unknown building");
    const cumulativeCost = [1, 2, 3]
      .filter((level) => level <= building.level)
      .map((level) =>
        amountForLevel(buildingDefinitions[building.kind].baseCost, level),
      )
      .reduce(addResources, emptyResources());
    const refund = scaleResources(
      cumulativeCost,
      gameplayTuning.buildingRefundRate,
    );
    this.buildings = this.buildings.filter((candidate) => candidate.id !== id);
    this.resources = this.collectResources(refund);
    this.message = `${building.kind} demolished safely; ${(gameplayTuning.buildingRefundRate * 100).toFixed(0)}% of its invested resources were refunded.`;
    return { ok: true, reason: "demolished", building };
  }

  chooseUpgrade(id: UpgradeId): boolean {
    if (
      this.pendingUpgradeChoices.length !== 3 ||
      !this.pendingUpgradeChoices.includes(id) ||
      this.upgrades.has(id)
    ) {
      this.message =
        "Choose exactly one unowned upgrade from the current boss reward options.";
      return false;
    }
    this.upgrades.add(id);
    const upgrade = upgradeDefinitionFor(id);
    this.applyUpgradeEffect(upgrade.effect);
    this.pendingUpgradeChoices = [];
    this.message = `${upgrade.label} applied in runtime. Campfire-save it to keep it.`;
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
        message: `New deterministic world started with seed “${cleanSeed}”. Nothing has been saved.`,
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
      this.message =
        "Save rejected: stand within 2m of a home, wild, or player Campfire.";
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
    this.message = `Campfire save committed at ${document.savePointId}. Death now returns to this save point; no death save is made.`;
  }

  snapshot(): GameSnapshot {
    const visibleChunks = visibleChunkCoordinates(this.player.position).map(
      (coordinate) => generateChunk(this.world, coordinate),
    );
    const visibleChunkKeys = new Set(visibleChunks.map((chunk) => chunk.key));
    const buildings = this.buildings.map((building) => ({
      ...building,
      position: copyVector(building.position),
    }));
    const moving =
      this.destination !== null || isMeaningfulMovement(this.input.intent);
    const savePoint = this.nearbyCampfire();
    return {
      world: { ...this.world },
      player: {
        position: copyVector(this.player.position),
        hp: this.player.hp,
        maxHp: this.player.maxHp,
      },
      resources: cloneResources(this.resources),
      materialCapacity: this.materialCapacity(),
      buildRadius: this.currentSettlementBuildRadius(),
      deathResourceLossRate: gameplayTuning.deathResourceLossRate,
      combatStats: this.combatStats(),
      enemies: [...this.enemies.values()]
        .filter(
          (enemy) =>
            !enemy.defeated &&
            visibleChunkKeys.has(chunkKey(chunkCoordinateFor(enemy.position))),
        )
        .map((enemy) => ({
          id: enemy.id,
          kind: enemy.kind,
          position: copyVector(enemy.position),
          hp: enemy.hp,
          maxHp: enemy.maxHp,
          damage: enemy.damage,
          dangerTier: enemy.dangerTier,
          respawnAt: enemy.respawnAt,
          defeated: enemy.defeated,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      projectiles: this.projectiles.map((projectile): ProjectileState => {
        const target = this.enemies.get(projectile.targetId);
        return {
          id: projectile.id,
          origin: copyVector(projectile.origin),
          targetId: projectile.targetId,
          targetPosition: copyVector(
            target !== undefined && !target.defeated
              ? target.position
              : projectile.targetPosition,
          ),
          progress: Math.min(
            1,
            projectile.elapsed / gameplayTuning.basicProjectileTravelSeconds,
          ),
        };
      }),
      floorDrops: this.floorDrops
        .filter((drop) =>
          visibleChunkKeys.has(chunkKey(chunkCoordinateFor(drop.position))),
        )
        .map((drop): FloorDropState => ({
          ...drop,
          position: copyVector(drop.position),
        })),
      buildings,
      visibleBuildings: buildings.filter((building) =>
        visibleChunkKeys.has(chunkKey(chunkCoordinateFor(building.position))),
      ),
      visibleChunks,
      moving,
      inputSource: this.input.source,
      destination:
        this.destination === null ? null : copyVector(this.destination),
      combatStatus: this.combatStatus,
      effects: this.describeEffects(),
      defeatedBossIds: [...this.defeatedBossIds].sort(),
      upgrades: [...this.upgrades].sort(),
      pendingUpgradeChoices: [...this.pendingUpgradeChoices],
      canSave: savePoint !== null,
      savePointLabel: savePoint?.label ?? null,
      message: this.message,
    };
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
    const stats = this.combatStats();
    const targets = this.targetsInRange(stats.attackRange);
    const target = targets[0];
    if (target === undefined) {
      this.combatStatus = "Stationary: seeking a target";
      this.attackElapsed = 0;
      return;
    }
    this.attackElapsed += delta;
    this.combatStatus = `Auto-attacking ${target.kind} (${Math.ceil(target.hp)}/${target.maxHp})`;
    if (this.attackElapsed < stats.attackIntervalSeconds) return;
    this.attackElapsed = 0;

    const projectileEffects = this.projectileUpgradeEffects();
    this.projectiles.push({
      id: "projectile:" + this.nextProjectileSerial.toString().padStart(4, "0"),
      origin: copyVector(this.player.position),
      targetId: target.id,
      targetPosition: copyVector(target.position),
      damage: stats.attackDamage,
      chainTargetIds:
        stats.chainTargets > 0 && projectileEffects.chainDamageMultiplier > 0
          ? targets
              .slice(1, 1 + stats.chainTargets)
              .map((secondary) => secondary.id)
          : [],
      chainDamage: stats.attackDamage * projectileEffects.chainDamageMultiplier,
      hitHeal: projectileEffects.hitHeal,
      elapsed: 0,
    });
    this.nextProjectileSerial += 1;
  }

  private updateProjectiles(delta: number): void {
    const completed: RuntimeProjectile[] = [];
    this.projectiles = this.projectiles.filter((projectile) => {
      projectile.elapsed += delta;
      if (projectile.elapsed < gameplayTuning.basicProjectileTravelSeconds)
        return true;
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

  private targetsInRange(range: number): RuntimeEnemy[] {
    return [...this.enemies.values()]
      .filter(
        (enemy) =>
          !enemy.defeated &&
          distance(this.player.position, enemy.position) <= range,
      )
      .sort((left, right) => {
        const difference =
          distance(this.player.position, left.position) -
          distance(this.player.position, right.position);
        return difference === 0 ? left.id.localeCompare(right.id) : difference;
      });
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
    const maximumTravel = this.combatStats().moveSpeed * delta;
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
      const separation = {
        x: this.player.position.x - enemy.position.x,
        y: this.player.position.y - enemy.position.y,
      };
      const playerDistance = magnitude(separation);
      const remainingDistance =
        playerDistance - gameplayTuning.enemyAttackStandoff;
      if (remainingDistance <= 0) continue;

      const travel = Math.min(enemy.moveSpeed * delta, remainingDistance);
      const nextPosition = add(
        enemy.position,
        scale(normalize(separation), travel),
      );
      enemy.position =
        distance(nextPosition, this.player.position) <
        gameplayTuning.enemyAttackStandoff
          ? add(
              this.player.position,
              scale(
                normalize({
                  x: enemy.position.x - this.player.position.x,
                  y: enemy.position.y - this.player.position.y,
                }),
                gameplayTuning.enemyAttackStandoff,
              ),
            )
          : nextPosition;
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
    const carriedLoss = scaleResources(
      this.resources,
      gameplayTuning.deathResourceLossRate,
    );
    this.resources = subtractResources(this.resources, carriedLoss);
    this.player.position = copyVector(this.committedSavePoint.position);
    this.player.hp = this.player.maxHp;
    this.input = { intent: { x: 0, y: 0 }, source: "system", at: this.elapsed };
    this.destination = null;
    this.attackElapsed = 0;
    this.farmHarvestElapsed = 0;
    this.message = `You fell and returned to ${this.committedSavePoint.label}. ${(gameplayTuning.deathResourceLossRate * 100).toFixed(0)}% of carried resources was lost; no save was made.`;
  }

  private defeatEnemy(enemy: RuntimeEnemy): void {
    const definition = enemyDefinitions[enemy.kind];
    this.floorDrops = [
      ...this.floorDrops,
      ...this.createFloorDrops(
        enemy,
        scaleResources(definition.drops, enemy.dropMultiplier),
      ),
    ];
    enemy.defeated = true;
    if (enemy.kind === "boss") {
      this.defeatedBossIds.add(enemy.id);
      this.pendingUpgradeChoices = selectBossUpgradeChoices(
        this.world.seed,
        this.upgrades,
      );
      this.message =
        this.pendingUpgradeChoices.length === 3
          ? "The Ember Wyrm is defeated: a Boss Core drop remains on the ground. Choose one unowned upgrade, then campfire-save it."
          : "The Ember Wyrm is defeated: a Boss Core drop remains on the ground. No complete unowned upgrade trio remains.";
    } else {
      enemy.respawnAt = this.elapsed + (definition.respawnSeconds ?? 0);
      this.message = `${enemy.kind} defeated: data-defined resource drops remain on the ground. It will respawn later; no save was made.`;
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
        ? Math.max(0, this.materialCapacity() - this.resources[drop.resource])
        : Number.POSITIVE_INFINITY;
      const collectedAmount = Math.min(drop.amount, capacityRemaining);
      if (collectedAmount <= 0) {
        remaining.push(drop);
        continue;
      }
      const resources = cloneResources(this.resources);
      resources[drop.resource] += collectedAmount;
      this.resources = this.clampResourcesToCapacity(resources);
      collectedAny = true;
      if (collectedAmount < drop.amount)
        remaining.push({ ...drop, amount: drop.amount - collectedAmount });
    }
    this.floorDrops = remaining;
    if (collectedAny)
      this.message = "Collected floor drops on contact; no save was made.";
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
      .reduce(addResources, emptyResources());
    this.resources = this.collectResources(harvest);
    this.message =
      "Farm harvest collected while stationary; storage capacity was enforced.";
  }

  private validateBuildingPosition(
    kind: BuildingKind,
    position: Vector2,
    ignoredId?: string,
  ): string | null {
    if (!isFinitePosition(position)) return "invalid coordinates";
    if (this.isTerrainBlocked(position)) return "blocked terrain";
    if (
      this.buildings.some(
        (building) =>
          building.id !== ignoredId &&
          distance(building.position, position) < 1.25,
      )
    ) {
      return "overlaps an existing building";
    }
    if (kind !== "Campfire") {
      const campfire = this.settlementCampfiresAround(position).find(
        (candidate) =>
          distance(candidate.position, position) <=
          this.campfireBuildRadius(candidate.level),
      );
      if (campfire === undefined) {
        const nearestRadius = this.currentSettlementBuildRadius();
        return `outside the ${nearestRadius}m campfire settlement radius`;
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
    return (
      this.settlementCampfiresAround(this.player.position).find(
        (campfire) => distance(this.player.position, campfire.position) <= 2,
      ) ?? null
    );
  }

  private campfireBuildRadius(level: 1 | 2 | 3): number {
    return gameplayTuning.campfireBuildRadiusByLevel[level - 1];
  }

  private currentSettlementBuildRadius(): number {
    const campfires = this.settlementCampfiresAround(this.player.position);
    return Math.max(
      gameplayTuning.campfireBuildRadiusByLevel[0],
      ...campfires.map((campfire) => this.campfireBuildRadius(campfire.level)),
    );
  }

  private materialCapacity(): number {
    return (
      gameplayTuning.baseMaterialCapacity +
      this.buildings
        .filter((building) => building.kind === "Storage")
        .reduce(
          (total, building) =>
            total +
            gameplayTuning.storageCapacityBonusByLevel[building.level - 1],
          0,
        )
    );
  }

  private collectResources(delta: ReadonlyResourceBag): ResourceBag {
    return this.clampResourcesToCapacity(addResources(this.resources, delta));
  }

  private clampResourcesToCapacity(
    resources: ReadonlyResourceBag,
  ): ResourceBag {
    const clamped = cloneResources(resources);
    const capacity = this.materialCapacity();
    for (const kind of commonResourceKinds)
      if (resourceDefinitions[kind].storageLimited)
        clamped[kind] = Math.min(capacity, Math.max(0, clamped[kind]));
    clamped.bossCore = Math.max(0, clamped.bossCore);
    return clamped;
  }

  private combatStats(): CombatStats {
    let attackDamage =
      gameplayTuning.baseAttackDamage +
      this.buildings
        .filter((building) => building.kind === "Workshop")
        .reduce(
          (total, building) =>
            total +
            gameplayTuning.workshopDamageBonusByLevel[building.level - 1],
          0,
        );
    let attackIntervalSeconds = gameplayTuning.baseAttackIntervalSeconds;
    let attackRange = gameplayTuning.baseAttackRange;
    let moveSpeed = gameplayTuning.baseMoveSpeed;
    let chainTargets = 0;

    for (const id of this.upgrades) {
      const effect = upgradeDefinitionFor(id).effect;
      switch (effect.kind) {
        case "attack-damage":
          attackDamage += effect.amount;
          break;
        case "attack-interval":
          attackIntervalSeconds *= effect.multiplier;
          break;
        case "attack-range":
          attackRange *= effect.multiplier;
          break;
        case "move-speed":
          moveSpeed *= effect.multiplier;
          break;
        case "chain-strike":
          chainTargets += effect.targetCount;
          break;
        case "maximum-health":
        case "hit-heal":
          break;
        default:
          exhaustUpgradeEffect(effect);
      }
    }
    return {
      attackDamage,
      attackIntervalSeconds,
      attackRange,
      moveSpeed,
      chainTargets,
    };
  }

  private projectileUpgradeEffects(): {
    readonly chainDamageMultiplier: number;
    readonly hitHeal: number;
  } {
    let chainDamageMultiplier = 0;
    let hitHeal = 0;
    for (const id of this.upgrades) {
      const effect = upgradeDefinitionFor(id).effect;
      switch (effect.kind) {
        case "chain-strike":
          chainDamageMultiplier += effect.damageMultiplier;
          break;
        case "hit-heal":
          hitHeal += effect.amount;
          break;
        case "attack-damage":
        case "attack-interval":
        case "attack-range":
        case "move-speed":
        case "maximum-health":
          break;
        default:
          exhaustUpgradeEffect(effect);
      }
    }
    return { chainDamageMultiplier, hitHeal };
  }

  private applyUpgradeEffect(effect: UpgradeEffect): void {
    switch (effect.kind) {
      case "maximum-health":
        this.player.maxHp += effect.amount;
        this.player.hp = Math.min(
          this.player.maxHp,
          this.player.hp + effect.amount,
        );
        return;
      case "attack-damage":
      case "attack-interval":
      case "attack-range":
      case "move-speed":
      case "chain-strike":
      case "hit-heal":
        return;
      default:
        return exhaustUpgradeEffect(effect);
    }
  }

  private describeEffects(): string[] {
    const effects = [
      `Storage: ${this.materialCapacity()} each for Wood, Stone, Metal / Scrap, and Essence; Boss Core is exempt.`,
      `Hearth Ward: ${gameplayTuning.baseCampfireHealingPerSecond} health/s while stationary near a campfire.`,
      `Death: ${(gameplayTuning.deathResourceLossRate * 100).toFixed(0)}% carried-resource loss; no death save.`,
    ];
    for (const building of this.buildings)
      effects.push(
        `${buildingDefinitions[building.kind].label} L${building.level}: ${buildingDefinitions[building.kind].levelEffects[building.level - 1]}`,
      );
    for (const id of this.upgrades) {
      const upgrade = upgradeDefinitionFor(id);
      effects.push(`${upgrade.label}: ${upgrade.description}`);
    }
    return effects;
  }

  private rejectPlacement(reason: string): PlacementResult {
    this.message = `Building action rejected: ${reason}. No resources or records changed.`;
    return { ok: false, reason };
  }

  private clampPlayerState(): void {
    this.player.hp = Math.max(0, Math.min(this.player.hp, this.player.maxHp));
  }
}
