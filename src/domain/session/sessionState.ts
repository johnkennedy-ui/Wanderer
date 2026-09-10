import { DEFAULT_WORLD_GENERATOR_VERSION } from "../world";
import type { GameNotice } from "../notices";
import type {
  BuildingState,
  AttackStyle,
  CrescentAttackState,
  ClassProgression,
  CurrentSave,
  EnemyKind,
  FloorDropState,
  MoveCommand,
  ReadonlyResourceBag,
  ResourceBag,
  UpgradeId,
  Vector2,
  WorldIdentity,
} from "../types";

/** Immutable default identity used only when a caller did not supply a world. */
export const DEFAULT_WORLD = Object.freeze({
  seed: "wanderer-known-seed",
  generatorVersion: DEFAULT_WORLD_GENERATOR_VERSION,
} satisfies WorldIdentity);

export const DEFAULT_SESSION_NOTICE = Object.freeze({
  kind: "session.ready",
} as const satisfies GameNotice);
export const DEFAULT_COMBAT_STATUS = "Stationary: seeking a target";

/** Runtime-only enemy state; it is recreated from deterministic chunks on hydrate. */
export interface RuntimeEnemy {
  id: string;
  kind: EnemyKind;
  position: Vector2;
  spawnPosition: Vector2;
  hp: number;
  maxHp: number;
  damage: number;
  dangerTier: number;
  dropMultiplier: number;
  moveSpeed: number;
  attackEverySeconds: number;
  respawnAt: number | null;
  defeated: boolean;
  attackElapsed: number;
  /** Runtime-only wave ownership; omitted for generator-owned enemies. */
  waveIndex?: number;
  /** Wave normal enemies disappear at this time; wave bosses persist. */
  waveExpiresAt?: number;
  readonly isWaveBoss?: boolean;
  readonly bossName?: string;
}

/** Runtime-only projectile state. It is intentionally excluded from saves. */
export interface RuntimeProjectile {
  readonly id: string;
  readonly origin: Vector2;
  readonly targetId: string;
  readonly targetPosition: Vector2;
  readonly damage: number;
  readonly chainTargetIds: readonly string[];
  readonly chainDamage: number;
  readonly hitHeal: number;
  readonly style?: AttackStyle;
  elapsed: number;
}

/** Runtime-only visible Knight attack. It applies its damage immediately. */
export interface RuntimeCrescentAttack {
  readonly id: string;
  readonly origin: Vector2;
  readonly direction: Vector2;
  readonly radius: number;
  readonly arcCosine: number;
  elapsed: number;
}

export interface SettlementCampfire {
  readonly id: string;
  readonly label: string;
  readonly position: Vector2;
  readonly level: 1 | 2 | 3;
}

interface RuntimePlayerState {
  position: Vector2;
  hp: number;
  maxHp: number;
}

/**
 * Every lifecycle-owned GameSession field. This state is always owned by one
 * session instance; this module supplies factories, never a shared instance.
 */
export interface SessionState {
  world: WorldIdentity;
  player: RuntimePlayerState;
  resources: ResourceBag;
  buildings: BuildingState[];
  enemies: Map<string, RuntimeEnemy>;
  projectiles: RuntimeProjectile[];
  crescentAttacks: RuntimeCrescentAttack[];
  floorDrops: FloorDropState[];
  defeatedBossIds: Set<string>;
  upgrades: Set<UpgradeId>;
  classProgression: ClassProgression;
  pendingUpgradeChoices: UpgradeId[];
  nextBuildingSerial: number;
  nextProjectileSerial: number;
  nextCrescentSerial: number;
  nextFloorDropSerial: number;
  committedSavePoint: SettlementCampfire;
  input: MoveCommand;
  destination: Vector2 | null;
  elapsed: number;
  attackElapsed: number;
  farmHarvestElapsed: number;
  notice: GameNotice;
  combatStatus: string;
}

export const copyWorldIdentity = (world: WorldIdentity): WorldIdentity => ({
  seed: world.seed,
  generatorVersion: world.generatorVersion,
});

export const copyVector = (position: Vector2): Vector2 => ({
  x: position.x,
  y: position.y,
});

export const cloneResources = (
  resources: ReadonlyResourceBag,
): ResourceBag => ({
  ...resources,
});

export const cloneClassProgression = (
  progression: ClassProgression | undefined,
): ClassProgression => ({
  experience: progression?.experience ?? 0,
  level: progression?.level ?? 0,
  playerClass: progression?.playerClass ?? null,
  skillIds: [...(progression?.skillIds ?? [])],
});

export const cloneBuildings = (
  buildings: readonly BuildingState[],
): BuildingState[] =>
  buildings.map((building) => ({
    ...building,
    position: copyVector(building.position),
  }));

const initialResources = (): ResourceBag => ({
  wood: 120,
  stone: 120,
  scrap: 120,
  essence: 20,
  bossCore: 0,
});

const idleInput = (at: number): MoveCommand => ({
  intent: { x: 0, y: 0 },
  source: "system",
  at,
});

const homeSavePoint = (): SettlementCampfire => ({
  id: "campfire:home",
  label: "home campfire",
  position: { x: 0, y: 0 },
  level: 1,
});

export interface FreshSessionStateOptions {
  readonly world?: WorldIdentity;
  /** Reset preserves accumulated session time so command timestamps stay monotonic. */
  readonly elapsed?: number;
  readonly notice?: GameNotice;
  /** Reset preserves the existing presentation status for compatibility. */
  readonly combatStatus?: string;
}

/** Creates every lifecycle field for a new/reset session without shared state. */
export const createFreshSessionState = (
  options: FreshSessionStateOptions = {},
): SessionState => {
  const elapsed = options.elapsed ?? 0;
  return {
    world: copyWorldIdentity(options.world ?? DEFAULT_WORLD),
    player: { position: { x: 0, y: 0 }, hp: 100, maxHp: 100 },
    resources: initialResources(),
    buildings: [],
    enemies: new Map(),
    projectiles: [],
    crescentAttacks: [],
    floorDrops: [],
    defeatedBossIds: new Set(),
    upgrades: new Set(),
    classProgression: cloneClassProgression(undefined),
    pendingUpgradeChoices: [],
    nextBuildingSerial: 1,
    nextProjectileSerial: 1,
    nextCrescentSerial: 1,
    nextFloorDropSerial: 1,
    committedSavePoint: homeSavePoint(),
    input: idleInput(elapsed),
    destination: null,
    elapsed,
    attackElapsed: 0,
    farmHarvestElapsed: 0,
    notice: options.notice ?? DEFAULT_SESSION_NOTICE,
    combatStatus: options.combatStatus ?? DEFAULT_COMBAT_STATUS,
  };
};

/**
 * Clones a validated current save into fresh instance-owned runtime state.
 * Runtime-only maps, projectiles and floor drops deliberately begin empty.
 */
export const hydrateSessionState = (saved: CurrentSave): SessionState => ({
  world: copyWorldIdentity(saved.world),
  player: {
    position: copyVector(saved.player.position),
    hp: saved.player.hp,
    maxHp: saved.player.maxHp,
  },
  resources: cloneResources(saved.resources),
  buildings: cloneBuildings(saved.buildings),
  enemies: new Map(),
  projectiles: [],
  crescentAttacks: [],
  floorDrops: [],
  defeatedBossIds: new Set(saved.defeatedBossIds),
  upgrades: new Set(saved.upgrades),
  classProgression: cloneClassProgression(saved.classProgression),
  pendingUpgradeChoices: [],
  nextBuildingSerial: saved.nextBuildingSerial,
  nextProjectileSerial: 1,
  nextCrescentSerial: 1,
  nextFloorDropSerial: 1,
  committedSavePoint: {
    id: saved.savePointId,
    label: "committed campfire",
    position: copyVector(saved.savePointPosition),
    level: 1,
  },
  input: idleInput(0),
  destination: null,
  elapsed: 0,
  attackElapsed: 0,
  farmHarvestElapsed: 0,
  notice: DEFAULT_SESSION_NOTICE,
  combatStatus: DEFAULT_COMBAT_STATUS,
});
