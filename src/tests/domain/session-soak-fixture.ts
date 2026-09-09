import { createHash } from "node:crypto";
import { GameSession } from "../../domain/GameSession";
import type { RuntimeDiagnostics } from "../../domain/session/runtimeDiagnostics";
import { resourceKinds } from "../../domain/types";
import { WANDERER_WEB_V1, WANDERER_WEB_V2 } from "../../domain/world";

export const SOAK_HALF_STEPS = 2080;
export const SOAK_STEP_SECONDS = 0.1;

const requireInvariant = (condition: boolean, label: string): void => {
  if (!condition) throw new Error(`runtime invariant: ${label}`);
};

/** Sort object keys only. Array order remains evidence of combat/ID ordering. */
export const canonicalJson = (value: unknown): string => {
  if (typeof value === "number") {
    requireInvariant(Number.isFinite(value), "non-finite number");
    return JSON.stringify(value);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  requireInvariant(
    typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype,
    "non-plain canonical value",
  );
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

export const canonicalHash = (value: unknown): string =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");

const uniqueIds = (ids: readonly string[], label: string): void => {
  requireInvariant(
    ids.every((id) => id.length > 0),
    `${label} empty ID`,
  );
  requireInvariant(new Set(ids).size === ids.length, `${label} duplicate IDs`);
};
const nonnegative = (value: number, label: string): void =>
  requireInvariant(Number.isFinite(value) && value >= 0, label);
const serial = (value: number, label: string): void =>
  requireInvariant(Number.isSafeInteger(value) && value >= 1, label);

export const assertRuntimeInvariants = (state: RuntimeDiagnostics): void => {
  // Also checks every nested position/timer/stat before JSON can turn NaN into null.
  canonicalJson(state);
  requireInvariant(state.world.seed.length > 0, "world seed");
  requireInvariant(
    [WANDERER_WEB_V1, WANDERER_WEB_V2].includes(
      state.world.generatorVersion as
        typeof WANDERER_WEB_V1 | typeof WANDERER_WEB_V2,
    ),
    "generator",
  );
  nonnegative(state.elapsed, "elapsed");
  nonnegative(state.attackElapsed, "attack elapsed");
  nonnegative(state.farmHarvestElapsed, "harvest elapsed");
  requireInvariant(
    state.player.maxHp > 0 &&
      state.player.hp >= 0 &&
      state.player.hp <= state.player.maxHp,
    "player health",
  );
  requireInvariant(
    Object.keys(state.resources).sort().join() ===
      [...resourceKinds].sort().join(),
    "resource keys",
  );
  for (const amount of Object.values(state.resources))
    nonnegative(amount, "resource");
  for (const [kind, value] of Object.entries(state.serials))
    serial(value, `${kind} serial`);
  uniqueIds(
    [
      ...state.enemies,
      ...state.projectiles,
      ...state.floorDrops,
      ...state.buildings,
    ].map((entry) => entry.id),
    "runtime",
  );
  uniqueIds(state.defeatedBossIds, "boss");
  uniqueIds(state.upgrades, "upgrade");
  uniqueIds(state.pendingUpgradeChoices, "choices");
  const enemyIds = new Set(state.enemies.map((enemy) => enemy.id));
  for (const enemy of state.enemies) {
    requireInvariant(enemy.mapKey === enemy.id, "enemy map key");
    // Existing lethal impacts keep overkill HP until respawn; do not clamp it.
    requireInvariant(
      enemy.maxHp > 0 &&
        enemy.hp <= enemy.maxHp &&
        (enemy.defeated ? enemy.hp <= 0 : enemy.hp > 0),
      "enemy health",
    );
    for (const value of [
      enemy.damage,
      enemy.moveSpeed,
      enemy.attackElapsed,
      enemy.dropMultiplier,
      enemy.dangerTier,
    ])
      nonnegative(value, "enemy stat");
    requireInvariant(enemy.attackEverySeconds > 0, "enemy attack interval");
    if (enemy.respawnAt !== null) nonnegative(enemy.respawnAt, "respawn timer");
  }
  for (const projectile of state.projectiles) {
    const match = /^projectile:(\d+)$/.exec(projectile.id);
    requireInvariant(
      match !== null &&
        Number(match[1]) >= 1 &&
        Number(match[1]) < state.serials.projectile,
      "projectile serial collision",
    );
    requireInvariant(
      enemyIds.has(projectile.targetId) &&
        projectile.chainTargetIds.every((id) => enemyIds.has(id)),
      "projectile target",
    );
    for (const value of [
      projectile.elapsed,
      projectile.damage,
      projectile.chainDamage,
      projectile.hitHeal,
    ])
      nonnegative(value, "projectile stat");
  }
  for (const drop of state.floorDrops) {
    const match = /^drop:.+:(\d+):([^:]+)$/.exec(drop.id);
    requireInvariant(
      match !== null &&
        Number(match[1]) >= 1 &&
        Number(match[1]) < state.serials.floorDrop &&
        match[2] === drop.resource,
      "drop serial collision",
    );
    requireInvariant(
      resourceKinds.includes(drop.resource) && drop.amount > 0,
      "drop resource",
    );
  }
  for (const building of state.buildings) {
    requireInvariant(/^building:[^:]+:\d+$/.test(building.id), "building ID");
    const allocated = Number(building.id.split(":").at(-1));
    serial(allocated, "building ID serial");
    requireInvariant(
      allocated < state.serials.building,
      "building serial collision",
    );
    requireInvariant([1, 2, 3].includes(building.level), "building level");
  }
  requireInvariant(
    state.counts.retainedEnemyDeltas === state.enemies.length &&
      state.counts.activeEnemies ===
        state.enemies.filter((enemy) => !enemy.defeated).length &&
      state.counts.projectiles === state.projectiles.length &&
      state.counts.floorDrops === state.floorDrops.length &&
      state.counts.cachedChunks === 0,
    "diagnostic counts",
  );
};

const requireSave = (session: GameSession, at: number) => {
  const request = session.createValidCampfireSaveRequest(at);
  if (request === null)
    throw new Error("soak schedule missed valid home campfire save");
  return request.document;
};

/** No private hooks, teleportation, accelerated rules, random input, or sleeps. */
export const runSoak = (reloadAtMidpoint: boolean) => {
  let session = new GameSession({
    world: {
      seed: "wanderer-known-seed",
      generatorVersion: "wanderer-web-v1",
    },
  });
  const placed = session.placeBuilding("Workshop", { x: 1, y: 1 });
  if (!placed.ok || placed.building === undefined)
    throw new Error("soak placement failed");
  const buildingId = placed.building.id;
  const maxima = { ...session.diagnostics().counts };
  const retainedAtStart = maxima.retainedEnemyDeltas;
  const visited = new Set<string>();
  let previousChunk = "";
  let revisits = 0;
  let deathReturns = 0;
  let midpointHash = "";
  let hydratedHash = "";
  let midpointRuntimeReset = false;
  const checkpoints: { step: number; retained: number }[] = [];
  for (let step = 0; step < SOAK_HALF_STEPS * 2; step += 1) {
    if (step === 200) {
      const result = session.demolishBuilding(buildingId);
      if (!result.ok) throw new Error("soak demolition failed");
    }
    if (step === SOAK_HALF_STEPS) {
      const document = requireSave(session, step);
      session.recordSaveCommitted(document);
      const hydrated = new GameSession({ saved: document });
      midpointHash = canonicalHash(document);
      hydratedHash = canonicalHash(requireSave(hydrated, step));
      const reset = hydrated.diagnostics();
      midpointRuntimeReset =
        reset.elapsed === 0 &&
        reset.attackElapsed === 0 &&
        reset.farmHarvestElapsed === 0 &&
        reset.destination === null &&
        reset.input.intent.x === 0 &&
        reset.input.intent.y === 0 &&
        reset.pendingUpgradeChoices.length === 0 &&
        reset.projectiles.length === 0 &&
        reset.floorDrops.length === 0 &&
        reset.serials.projectile === 1 &&
        reset.serials.floorDrop === 1 &&
        reset.enemies.every(
          (enemy) =>
            enemy.hp === enemy.maxHp &&
            !enemy.defeated &&
            enemy.attackElapsed === 0 &&
            enemy.respawnAt === null &&
            enemy.position.x === enemy.spawnPosition.x &&
            enemy.position.y === enemy.spawnPosition.y,
        );
      requireInvariant(
        midpointHash === hydratedHash,
        "durable midpoint roundtrip",
      );
      requireInvariant(midpointRuntimeReset, "hydrate runtime reset");
      if (reloadAtMidpoint) session = hydrated;
    }
    const phase = step % SOAK_HALF_STEPS;
    if (phase >= 840) {
      session.setDestination({
        destination: { x: 0, y: 0 },
        source: "tap-to-move",
        at: step,
      });
    } else {
      const intent =
        phase < 200
          ? { x: 0, y: 0 }
          : phase < 280
            ? { x: 1, y: 0 }
            : phase < 440
              ? { x: -1, y: 0 }
              : phase < 520
                ? { x: 1, y: 0 }
                : phase < 600
                  ? { x: 0, y: 1 }
                  : phase < 760
                    ? { x: 0, y: -1 }
                    : { x: 0, y: 1 };
      session.move({ intent, source: "keyboard", at: step });
    }
    const before = session.diagnostics().player.position;
    session.tick(SOAK_STEP_SECONDS);
    const state = session.diagnostics();
    assertRuntimeInvariants(state);
    // A >1m jump cannot be normal 0.1s default movement. Death returns home.
    if (
      Math.hypot(
        state.player.position.x - before.x,
        state.player.position.y - before.y,
      ) > 1 &&
      state.player.hp === state.player.maxHp &&
      state.player.position.x === 0 &&
      state.player.position.y === 0
    )
      deathReturns += 1;
    const chunk = `${Math.floor(state.player.position.x / 16)},${Math.floor(state.player.position.y / 16)}`;
    if (chunk !== previousChunk) {
      if (visited.has(chunk)) revisits += 1;
      visited.add(chunk);
      previousChunk = chunk;
    }
    for (const key of Object.keys(maxima) as (keyof typeof maxima)[])
      maxima[key] = Math.max(maxima[key], state.counts[key]);
    if ((step + 1) % 280 === 0)
      checkpoints.push({
        step: step + 1,
        retained: state.counts.retainedEnemyDeltas,
      });
  }
  const final = session.diagnostics();
  return {
    steps: SOAK_HALF_STEPS * 2,
    stepSeconds: SOAK_STEP_SECONDS,
    reloadAtMidpoint,
    finalHash: canonicalHash(final),
    midpointHash,
    hydratedHash,
    midpointRuntimeReset,
    maxima,
    retainedAtStart,
    retainedAtEnd: final.counts.retainedEnemyDeltas,
    retainedGrowth: final.counts.retainedEnemyDeltas - retainedAtStart,
    checkpoints,
    visitedChunks: [...visited].sort(),
    revisits,
    deathReturns,
    buildingActions: 2,
  };
};
