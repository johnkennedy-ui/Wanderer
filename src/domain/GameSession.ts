import {
  buildingDefinitions,
  enemyDefinitions,
  gameplayTuning,
  resourceDefinitions,
  upgradeDefinitionFor,
  upgradeDefinitions,
} from "../data/definitions";
import {
  add,
  distance,
  magnitude,
  normalize,
  roundVector,
  scale,
} from "./math";
import { commonResourceKinds, emptyResources, resourceKinds } from "./types";
import type {
  BuildingKind,
  BuildingState,
  CombatStats,
  EnemyKind,
  EnemyState,
  GameSnapshot,
  InputSource,
  MoveCommand,
  PlacementResult,
  ResourceBag,
  SaveDocument,
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

const DEFAULT_WORLD: WorldIdentity = {
  seed: "wanderer-known-seed",
  generatorVersion: "wanderer-web-v1",
};
const MOVEMENT_THRESHOLD = 0.15;

interface RuntimeEnemy {
  id: string;
  kind: EnemyKind;
  position: Vector2;
  spawnPosition: Vector2;
  hp: number;
  maxHp: number;
  damage: number;
  dangerTier: number;
  dropMultiplier: number;
  attackEverySeconds: number;
  respawnAt: number | null;
  defeated: boolean;
  attackElapsed: number;
}

interface SessionOptions {
  readonly world?: WorldIdentity;
  readonly saved?: SaveDocument;
}

interface SettlementCampfire {
  readonly id: string;
  readonly label: string;
  readonly position: Vector2;
  readonly level: 1 | 2 | 3;
}

const cloneResources = (resources: ResourceBag): ResourceBag => ({
  ...resources,
});
const copyVector = (position: Vector2): Vector2 => ({
  x: position.x,
  y: position.y,
});
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

const amountForLevel = (resources: ResourceBag, level: number): ResourceBag => {
  const scaled = emptyResources();
  for (const kind of resourceKinds) scaled[kind] = resources[kind] * level;
  return scaled;
};

const addResources = (left: ResourceBag, right: ResourceBag): ResourceBag => {
  const total = emptyResources();
  for (const kind of resourceKinds) total[kind] = left[kind] + right[kind];
  return total;
};

const subtractResources = (
  left: ResourceBag,
  right: ResourceBag,
): ResourceBag => {
  const total = emptyResources();
  for (const kind of resourceKinds) total[kind] = left[kind] - right[kind];
  return total;
};

const scaleResources = (
  resources: ResourceBag,
  multiplier: number,
): ResourceBag => {
  const scaled = emptyResources();
  for (const kind of resourceKinds)
    scaled[kind] = Math.floor(resources[kind] * multiplier);
  return scaled;
};

const canAfford = (have: ResourceBag, cost: ResourceBag): boolean =>
  resourceKinds.every((kind) => have[kind] >= cost[kind]);

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
  private world: WorldIdentity;
  private player: { position: Vector2; hp: number; maxHp: number };
  private resources: ResourceBag;
  private buildings: BuildingState[];
  private enemies = new Map<string, RuntimeEnemy>();
  private defeatedBossIds = new Set<string>();
  private upgrades = new Set<UpgradeId>();
  private pendingUpgradeChoices: UpgradeId[] = [];
  private nextBuildingSerial: number;
  private committedSavePoint: SettlementCampfire;
  private input: MoveCommand = {
    intent: { x: 0, y: 0 },
    source: "system",
    at: 0,
  };
  private elapsed = 0;
  private attackElapsed = 0;
  private farmHarvestElapsed = 0;
  private message =
    "Reach the nearby scout, then travel east to challenge the Ember Wyrm.";
  private combatStatus = "Stationary: seeking a target";

  constructor(options: SessionOptions = {}) {
    const saved = options.saved;
    this.world = saved?.world ?? options.world ?? DEFAULT_WORLD;
    this.player = saved
      ? {
          position: copyVector(saved.player.position),
          hp: saved.player.hp,
          maxHp: saved.player.maxHp,
        }
      : { position: { x: 0, y: 0 }, hp: 100, maxHp: 100 };
    this.resources = saved
      ? cloneResources(saved.resources)
      : { wood: 120, stone: 120, scrap: 120, essence: 20, bossCore: 0 };
    this.buildings = saved
      ? saved.buildings.map((building) => ({
          ...building,
          position: copyVector(building.position),
        }))
      : [];
    this.defeatedBossIds = new Set(saved?.defeatedBossIds ?? []);
    this.upgrades = new Set(saved?.upgrades ?? []);
    this.nextBuildingSerial = saved?.nextBuildingSerial ?? 1;
    this.committedSavePoint = saved
      ? {
          id: saved.savePointId,
          label: "committed campfire",
          position: copyVector(saved.savePointPosition),
          level: 1,
        }
      : {
          id: "campfire:home",
          label: "home campfire",
          position: { x: 0, y: 0 },
          level: 1,
        };
    this.resources = this.clampResourcesToCapacity(this.resources);
    this.ensureNeighborhoodEnemies();
  }

  move(command: MoveCommand): void {
    const normalized = normalize(command.intent);
    this.input = { intent: normalized, source: command.source, at: command.at };
  }

  tick(deltaSeconds: number): void {
    const delta = Math.max(0, Math.min(deltaSeconds, 0.1));
    this.elapsed += delta;
    const movement = magnitude(this.input.intent);
    const moving = movement >= MOVEMENT_THRESHOLD;

    if (moving) {
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
    const maxHealthIncrease =
      upgradeDefinitionFor(id)?.modifier.maxHealthAdd ?? 0;
    if (maxHealthIncrease > 0) {
      this.player.maxHp += maxHealthIncrease;
      this.player.hp = Math.min(
        this.player.maxHp,
        this.player.hp + maxHealthIncrease,
      );
    }
    this.pendingUpgradeChoices = [];
    this.message = `${upgradeDefinitionFor(id)?.label ?? id} applied in runtime. Campfire-save it to keep it.`;
    return true;
  }

  resetWorld(seed: string): void {
    const cleanSeed = seed.trim() || DEFAULT_WORLD.seed;
    this.world = {
      seed: cleanSeed,
      generatorVersion: DEFAULT_WORLD.generatorVersion,
    };
    this.player = { position: { x: 0, y: 0 }, hp: 100, maxHp: 100 };
    this.resources = {
      wood: 120,
      stone: 120,
      scrap: 120,
      essence: 20,
      bossCore: 0,
    };
    this.buildings = [];
    this.enemies = new Map();
    this.defeatedBossIds = new Set();
    this.upgrades = new Set();
    this.pendingUpgradeChoices = [];
    this.nextBuildingSerial = 1;
    this.committedSavePoint = {
      id: "campfire:home",
      label: "home campfire",
      position: { x: 0, y: 0 },
      level: 1,
    };
    this.input = { intent: { x: 0, y: 0 }, source: "system", at: this.elapsed };
    this.attackElapsed = 0;
    this.farmHarvestElapsed = 0;
    this.message = `New deterministic world started with seed “${cleanSeed}”. Nothing has been saved.`;
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
    const save: SaveDocument = {
      schemaVersion: 2,
      world: { ...this.world },
      player: {
        position: copyVector(this.player.position),
        hp: this.player.hp,
        maxHp: this.player.maxHp,
      },
      resources: cloneResources(this.resources),
      buildings: this.buildings.map((building) => ({
        ...building,
        position: copyVector(building.position),
      })),
      defeatedBossIds: [...this.defeatedBossIds].sort(),
      upgrades: [...this.upgrades].sort(),
      nextBuildingSerial: this.nextBuildingSerial,
      committedAt,
      savePointId: savePoint.id,
      savePointPosition: copyVector(savePoint.position),
    };
    return { document: save, savePointLabel: savePoint.label };
  }

  /** Called by the composition root only after the storage adapter reports success. */
  recordSaveCommitted(document: SaveDocument): void {
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
    const moving = magnitude(this.input.intent) >= MOVEMENT_THRESHOLD;
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
      buildings,
      visibleBuildings: buildings.filter((building) =>
        visibleChunkKeys.has(chunkKey(chunkCoordinateFor(building.position))),
      ),
      visibleChunks,
      moving,
      inputSource: this.input.source,
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

    let landedHits = this.resolveBasicHit(target, stats.attackDamage) ? 1 : 0;
    const chainDamageMultiplier = this.upgradeModifierTotal(
      "chainDamageMultiplier",
    );
    if (stats.chainTargets > 0 && chainDamageMultiplier > 0) {
      for (const secondary of targets.slice(1, 1 + stats.chainTargets)) {
        if (
          this.resolveBasicHit(
            secondary,
            stats.attackDamage * chainDamageMultiplier,
          )
        )
          landedHits += 1;
      }
    }
    const hitHeal = this.upgradeModifierTotal("hitHeal");
    if (landedHits > 0 && hitHeal > 0)
      this.player.hp = Math.min(
        this.player.maxHp,
        this.player.hp + landedHits * hitHeal,
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

  private updateEnemyAttacks(delta: number): void {
    for (const enemy of this.enemies.values()) {
      if (
        enemy.defeated ||
        distance(this.player.position, enemy.position) > 1.8
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
    this.attackElapsed = 0;
    this.farmHarvestElapsed = 0;
    this.message = `You fell and returned to ${this.committedSavePoint.label}. ${(gameplayTuning.deathResourceLossRate * 100).toFixed(0)}% of carried resources was lost; no save was made.`;
  }

  private defeatEnemy(enemy: RuntimeEnemy): void {
    const definition = enemyDefinitions[enemy.kind];
    this.resources = this.collectResources(
      scaleResources(definition.drops, enemy.dropMultiplier),
    );
    enemy.defeated = true;
    if (enemy.kind === "boss") {
      this.defeatedBossIds.add(enemy.id);
      this.pendingUpgradeChoices = selectBossUpgradeChoices(
        this.world.seed,
        this.upgrades,
      );
      this.message =
        this.pendingUpgradeChoices.length === 3
          ? "The Ember Wyrm is defeated: Boss Core gained. Choose one unowned upgrade, then campfire-save it."
          : "The Ember Wyrm is defeated: Boss Core gained. No complete unowned upgrade trio remains.";
    } else {
      enemy.respawnAt = this.elapsed + (definition.respawnSeconds ?? 0);
      this.message = `${enemy.kind} defeated: data-defined resources collected. It will respawn later; no save was made.`;
    }
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

  private collectResources(delta: ResourceBag): ResourceBag {
    return this.clampResourcesToCapacity(addResources(this.resources, delta));
  }

  private clampResourcesToCapacity(resources: ResourceBag): ResourceBag {
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
      const modifier = upgradeDefinitionFor(id)?.modifier;
      if (modifier === undefined) continue;
      attackDamage += modifier.attackDamageAdd ?? 0;
      attackIntervalSeconds *= modifier.attackIntervalMultiplier ?? 1;
      attackRange *= modifier.attackRangeMultiplier ?? 1;
      moveSpeed *= modifier.moveSpeedMultiplier ?? 1;
      chainTargets += modifier.chainTargets ?? 0;
    }
    return {
      attackDamage,
      attackIntervalSeconds,
      attackRange,
      moveSpeed,
      chainTargets,
    };
  }

  private upgradeModifierTotal(
    field: "chainDamageMultiplier" | "hitHeal",
  ): number {
    return [...this.upgrades].reduce(
      (total, id) => total + (upgradeDefinitionFor(id)?.modifier[field] ?? 0),
      0,
    );
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
      if (upgrade !== undefined)
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
