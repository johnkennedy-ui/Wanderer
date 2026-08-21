import {
  buildingDefinitions,
  enemyDefinitions,
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
import type {
  BuildingKind,
  BuildingState,
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
import { emptyResources } from "./types";
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
const PLAYER_SPEED = 3;
const ATTACK_RANGE = 3.2;
const SETTLEMENT_RADIUS = 6;

interface RuntimeEnemy {
  id: string;
  kind: EnemyKind;
  position: Vector2;
  spawnPosition: Vector2;
  hp: number;
  maxHp: number;
  respawnAt: number | null;
  defeated: boolean;
  attackElapsed: number;
}

interface SessionOptions {
  readonly world?: WorldIdentity;
  readonly saved?: SaveDocument;
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

const amountForLevel = (
  resources: ResourceBag,
  level: number,
): ResourceBag => ({
  wood: resources.wood * level,
  ore: resources.ore * level,
  food: resources.food * level,
  bossCore: resources.bossCore * level,
});

const addResources = (left: ResourceBag, right: ResourceBag): ResourceBag => ({
  wood: left.wood + right.wood,
  ore: left.ore + right.ore,
  food: left.food + right.food,
  bossCore: left.bossCore + right.bossCore,
});

const subtractResources = (
  left: ResourceBag,
  right: ResourceBag,
): ResourceBag => ({
  wood: left.wood - right.wood,
  ore: left.ore - right.ore,
  food: left.food - right.food,
  bossCore: left.bossCore - right.bossCore,
});

const canAfford = (have: ResourceBag, cost: ResourceBag): boolean =>
  have.wood >= cost.wood &&
  have.ore >= cost.ore &&
  have.food >= cost.food &&
  have.bossCore >= cost.bossCore;

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
  private input: MoveCommand = {
    intent: { x: 0, y: 0 },
    source: "system",
    at: 0,
  };
  private elapsed = 0;
  private attackElapsed = 0;
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
      : { wood: 120, ore: 75, food: 60, bossCore: 0 };
    this.buildings = saved
      ? saved.buildings.map((building) => ({
          ...building,
          position: copyVector(building.position),
        }))
      : [];
    this.defeatedBossIds = new Set(saved?.defeatedBossIds ?? []);
    this.upgrades = new Set(saved?.upgrades ?? []);
    this.nextBuildingSerial = saved?.nextBuildingSerial ?? 1;
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
          scale(this.input.intent, PLAYER_SPEED * delta),
        ),
      );
      this.combatStatus = "Moving: basic auto-attack suppressed";
      this.attackElapsed = 0;
    } else {
      this.applyPassiveHealing(delta);
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
    this.message = `${building.kind} upgraded to level ${nextLevel}; the change remains unsaved.`;
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
    const refund: ResourceBag = {
      wood: Math.floor(cumulativeCost.wood / 2),
      ore: Math.floor(cumulativeCost.ore / 2),
      food: Math.floor(cumulativeCost.food / 2),
      bossCore: 0,
    };
    this.resources = addResources(this.resources, refund);
    this.buildings = this.buildings.filter((candidate) => candidate.id !== id);
    this.message = `${building.kind} demolished safely; 50% of its invested resources were refunded.`;
    return { ok: true, reason: "demolished", building };
  }

  chooseUpgrade(id: UpgradeId): boolean {
    if (
      this.pendingUpgradeChoices.length !== 3 ||
      !this.pendingUpgradeChoices.includes(id)
    ) {
      this.message = "Choose exactly one of the current boss reward options.";
      return false;
    }
    this.upgrades.add(id);
    if (id === "iron-skin") {
      this.player.maxHp += 25;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 25);
    }
    this.pendingUpgradeChoices = [];
    this.message = `${upgradeDefinitions.find((upgrade) => upgrade.id === id)?.label ?? id} applied in runtime. Campfire-save it to keep it.`;
    return true;
  }

  resetWorld(seed: string): void {
    const cleanSeed = seed.trim() || DEFAULT_WORLD.seed;
    this.world = {
      seed: cleanSeed,
      generatorVersion: DEFAULT_WORLD.generatorVersion,
    };
    this.player = { position: { x: 0, y: 0 }, hp: 100, maxHp: 100 };
    this.resources = { wood: 120, ore: 75, food: 60, bossCore: 0 };
    this.buildings = [];
    this.enemies = new Map();
    this.defeatedBossIds = new Set();
    this.upgrades = new Set();
    this.pendingUpgradeChoices = [];
    this.nextBuildingSerial = 1;
    this.input = { intent: { x: 0, y: 0 }, source: "system", at: this.elapsed };
    this.attackElapsed = 0;
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
      schemaVersion: 1,
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
    };
    return { document: save, savePointLabel: savePoint.label };
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
          hp: definition.maxHp,
          maxHp: definition.maxHp,
          respawnAt: null,
          defeated: false,
          attackElapsed: 0,
        });
      }
    }
  }

  private updateAutoCombat(delta: number): void {
    const target = [...this.enemies.values()]
      .filter(
        (enemy) =>
          !enemy.defeated &&
          distance(this.player.position, enemy.position) <= ATTACK_RANGE,
      )
      .sort((left, right) => {
        const difference =
          distance(this.player.position, left.position) -
          distance(this.player.position, right.position);
        return difference === 0 ? left.id.localeCompare(right.id) : difference;
      })[0];
    if (target === undefined) {
      this.combatStatus = "Stationary: seeking a target";
      this.attackElapsed = 0;
      return;
    }
    this.attackElapsed += delta;
    const interval = this.upgrades.has("quick-hands") ? 0.38 : 0.5;
    this.combatStatus = `Auto-attacking ${target.kind} (${Math.ceil(target.hp)}/${target.maxHp})`;
    if (this.attackElapsed < interval) return;
    this.attackElapsed = 0;
    target.hp -= this.attackDamage();
    if (target.hp <= 0) this.defeatEnemy(target);
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
      const definition = enemyDefinitions[enemy.kind];
      enemy.attackElapsed += delta;
      if (enemy.attackElapsed < definition.attackEverySeconds) continue;
      enemy.attackElapsed = 0;
      this.player.hp -= definition.damage;
      if (this.player.hp <= 0) {
        this.player.position = { x: 0, y: 0 };
        this.player.hp = this.player.maxHp;
        this.resources = {
          ...this.resources,
          food: Math.max(0, this.resources.food - 5),
        };
        this.message =
          "You fell and returned to the home campfire. Five food was lost; no save was made.";
      }
    }
  }

  private defeatEnemy(enemy: RuntimeEnemy): void {
    const definition = enemyDefinitions[enemy.kind];
    this.resources = addResources(this.resources, definition.drops);
    if (enemy.kind !== "boss")
      this.resources = addResources(this.resources, {
        wood: 1,
        ore: 0,
        food: 0,
        bossCore: 0,
      });
    enemy.defeated = true;
    if (enemy.kind === "boss") {
      this.defeatedBossIds.add(enemy.id);
      this.pendingUpgradeChoices = this.bossUpgradeChoices();
      this.message =
        "The Ember Wyrm is defeated: Boss Core gained. Choose one permanent upgrade, then campfire-save it.";
    } else {
      enemy.respawnAt = this.elapsed + (definition.respawnSeconds ?? 0);
      this.message = `${enemy.kind} defeated: resources collected. It will respawn later; no save was made.`;
    }
  }

  private bossUpgradeChoices(): UpgradeId[] {
    const available = upgradeDefinitions
      .map((upgrade) => upgrade.id)
      .filter((id) => !this.upgrades.has(id));
    const source =
      available.length >= 3
        ? available
        : upgradeDefinitions.map((upgrade) => upgrade.id);
    const start =
      hashText(`${this.world.seed}|boss:ember-wyrm`) % source.length;
    return [0, 1, 2].map((offset) => source[(start + offset) % source.length]);
  }

  private attackDamage(): number {
    const workshopBonus = this.buildings
      .filter((building) => building.kind === "Workshop")
      .reduce((total, building) => total + building.level * 4, 0);
    return (
      12 +
      workshopBonus +
      (this.upgrades.has("sharpened-blade") ? 7 : 0) +
      (this.upgrades.has("ember-aura") ? 3 : 0)
    );
  }

  private applyPassiveHealing(delta: number): void {
    const nearby = this.nearbyCampfire();
    if (nearby !== null) {
      const healerLevels = this.buildings
        .filter((building) => building.kind === "Healer")
        .reduce((total, building) => total + building.level, 0);
      this.player.hp = Math.min(
        this.player.maxHp,
        this.player.hp + delta * (3 + healerLevels),
      );
    }
    const farmLevels = this.buildings
      .filter((building) => building.kind === "Farm")
      .reduce((total, building) => total + building.level, 0);
    if (farmLevels > 0)
      this.player.hp = Math.min(
        this.player.maxHp,
        this.player.hp + delta * farmLevels * 0.5,
      );
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
    if (
      kind !== "Campfire" &&
      !this.settlementCampfires().some(
        (campfire) =>
          distance(campfire.position, position) <= SETTLEMENT_RADIUS,
      )
    ) {
      return `outside the ${SETTLEMENT_RADIUS}m campfire settlement radius`;
    }
    return null;
  }

  private isTerrainBlocked(position: Vector2): boolean {
    const coordinate = chunkCoordinateFor(position);
    return generateChunk(this.world, coordinate).obstacles.some(
      (obstacle) => distance(obstacle.position, position) < 0.9,
    );
  }

  private settlementCampfires(): readonly {
    id: string;
    label: string;
    position: Vector2;
  }[] {
    const base = visibleChunkCoordinates(this.player.position).flatMap(
      (coordinate) =>
        generateChunk(this.world, coordinate).campfires.map((campfire) => ({
          id: campfire.id,
          label: campfire.kind === "home" ? "home campfire" : "wild campfire",
          position: campfire.position,
        })),
    );
    const playerBuilt = this.buildings
      .filter((building) => building.kind === "Campfire")
      .map((building) => ({
        id: building.id,
        label: "player campfire",
        position: building.position,
      }));
    return [...base, ...playerBuilt];
  }

  private nearbyCampfire(): {
    id: string;
    label: string;
    position: Vector2;
  } | null {
    return (
      this.settlementCampfires().find(
        (campfire) => distance(this.player.position, campfire.position) <= 2,
      ) ?? null
    );
  }

  private describeEffects(): string[] {
    const effects = [
      "Hearth Ward: heals while stationary near a campfire",
      "Forager’s Instinct: normal kills grant +1 wood",
    ];
    const workshop = this.buildings
      .filter((building) => building.kind === "Workshop")
      .reduce((sum, building) => sum + building.level, 0);
    const farm = this.buildings
      .filter((building) => building.kind === "Farm")
      .reduce((sum, building) => sum + building.level, 0);
    if (workshop > 0)
      effects.push(`Workshop Training: +${workshop * 4} basic damage`);
    if (farm > 0)
      effects.push(
        `Farm Rations: +${(farm * 0.5).toFixed(1)} stationary health/s`,
      );
    for (const id of this.upgrades)
      effects.push(
        upgradeDefinitions.find((upgrade) => upgrade.id === id)?.label ?? id,
      );
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
