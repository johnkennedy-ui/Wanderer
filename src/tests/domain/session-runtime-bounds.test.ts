import { describe, expect, it } from "vitest";
import { GameSession } from "../../domain/GameSession";
import { createFreshSessionState } from "../../domain/session/sessionState";
import { projectRuntimeDiagnostics } from "../../domain/session/runtimeDiagnostics";
import type { RuntimeDiagnostics } from "../../domain/session/runtimeDiagnostics";
import {
  missingVisibleRuntimeEnemyDraftsFor,
  visibleChunksFor,
} from "../../domain/session/worldRuntime";
import { assertRuntimeInvariants, canonicalHash } from "./session-soak-fixture";

type Mutable<Value> = Value extends object
  ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
  : Value;

const diagnosticInput = () => {
  const state = createFreshSessionState();
  const enemies = missingVisibleRuntimeEnemyDraftsFor({
    visibleChunks: visibleChunksFor(state.world, state.player.position),
    existingEnemies: state.enemies,
    defeatedBossIds: state.defeatedBossIds,
  });
  for (const enemy of enemies) state.enemies.set(enemy.id, enemy);
  const target = enemies[0];
  if (target === undefined) throw new Error("no diagnostic fixture enemy");
  state.buildings.push({
    id: "building:fixture:1",
    kind: "Workshop",
    position: { x: 1, y: 1 },
    level: 1,
  });
  state.nextBuildingSerial = 2;
  state.projectiles.push({
    id: "projectile:0001",
    origin: { x: 0, y: 0 },
    targetId: target.id,
    targetPosition: { ...target.position },
    damage: 12,
    chainTargetIds: [target.id],
    chainDamage: 6,
    hitHeal: 0,
    elapsed: 0.1,
  });
  state.nextProjectileSerial = 2;
  state.floorDrops.push({
    id: `drop:${target.id}:1:wood`,
    resource: "wood",
    amount: 5,
    position: { x: 3, y: 3 },
  });
  state.nextFloorDropSerial = 2;
  state.destination = { x: 10, y: -10 };
  return state;
};

const assertDeepFrozenPlain = (value: unknown): void => {
  if (value === null || typeof value !== "object") return;
  expect(value).not.toBeInstanceOf(Map);
  expect(value).not.toBeInstanceOf(Set);
  expect(Object.isFrozen(value)).toBe(true);
  expect(
    Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype,
  ).toBe(true);
  for (const member of Object.values(value)) assertDeepFrozenPlain(member);
};

describe("runtime diagnostics, not an enemy memory bound", () => {
  it("deep freezes detached plain data without freezing or retaining authority", () => {
    const input = diagnosticInput();
    const snapshot = projectRuntimeDiagnostics(input);
    assertRuntimeInvariants(snapshot);
    assertDeepFrozenPlain(snapshot);
    const hash = canonicalHash(snapshot);
    expect(Reflect.set(snapshot.player.position, "x", 99)).toBe(false);
    expect(Reflect.set(snapshot.resources, "wood", -1)).toBe(false);
    expect(Reflect.set(snapshot.enemies[0].position, "x", 99)).toBe(false);
    expect(
      Reflect.set(snapshot.projectiles[0].chainTargetIds, "0", "bad"),
    ).toBe(false);
    expect(Reflect.set(snapshot.floorDrops[0].position, "y", 99)).toBe(false);
    expect(Reflect.set(snapshot.buildings[0].position, "x", 99)).toBe(false);
    expect(Reflect.set(snapshot.world, "seed", "bad")).toBe(false);
    expect(canonicalHash(snapshot)).toBe(hash);
    // Mutate the source fixture after projection: it must remain independently writable.
    input.player.position = { x: 99, y: 99 };
    input.resources.wood = 1;
    input.projectiles[0].elapsed = 99;
    const sourceEnemy = [...input.enemies.values()][0];
    sourceEnemy.hp -= 1;
    sourceEnemy.position = { x: 77, y: 77 };
    expect(Object.isFrozen(input.projectiles[0].origin)).toBe(false);
    expect(Object.isFrozen(input.projectiles[0].chainTargetIds)).toBe(false);
    expect(Object.isFrozen(input.floorDrops[0].position)).toBe(false);
    expect(Object.isFrozen(input.buildings[0].position)).toBe(false);
    input.enemies.clear();
    input.floorDrops.length = 0;
    input.buildings.length = 0;
    input.upgrades.add("quick-hands");
    expect(canonicalHash(snapshot)).toBe(hash);
  });

  it("querying or attempting mutation cannot change GameSession or old snapshots", () => {
    const session = new GameSession();
    const control = new GameSession();
    const before = session.diagnostics();
    const hash = canonicalHash(before);
    for (let query = 0; query < 3; query += 1) {
      const snapshot = session.diagnostics();
      assertDeepFrozenPlain(snapshot);
      expect(Reflect.set(snapshot.serials, "projectile", 999)).toBe(false);
      expect(Reflect.set(snapshot.enemies, "length", 0)).toBe(false);
    }
    for (let step = 0; step < 20; step += 1) {
      session.tick(0.1);
      control.tick(0.1);
    }
    expect(session.diagnostics()).toEqual(control.diagnostics());
    expect(canonicalHash(before)).toBe(hash);
    expect(canonicalHash(session.diagnostics())).not.toBe(hash);
    session.resetWorld("independent-reset");
    expect(canonicalHash(before)).toBe(hash);
    expect(session.diagnostics().world.seed).toBe("independent-reset");
  });

  const corruptions: readonly [
    string,
    (state: Mutable<RuntimeDiagnostics>) => void,
  ][] = [
    [
      "NaN position",
      (s) => {
        s.player.position.x = NaN;
      },
    ],
    [
      "infinite spawn",
      (s) => {
        s.enemies[0].spawnPosition.y = Infinity;
      },
    ],
    [
      "infinite timer",
      (s) => {
        s.elapsed = Infinity;
      },
    ],
    [
      "negative timer",
      (s) => {
        s.attackElapsed = -1;
      },
    ],
    [
      "negative resources",
      (s) => {
        s.resources.wood = -1;
      },
    ],
    [
      "impossible player health",
      (s) => {
        s.player.hp = s.player.maxHp + 1;
      },
    ],
    [
      "negative player health",
      (s) => {
        s.player.hp = -1;
      },
    ],
    [
      "invalid live enemy health",
      (s) => {
        s.enemies[0].hp = 0;
      },
    ],
    [
      "invalid defeated health",
      (s) => {
        s.enemies[0].defeated = true;
      },
    ],
    [
      "duplicate ID",
      (s) => {
        s.enemies.push({ ...s.enemies[0] });
      },
    ],
    [
      "empty ID",
      (s) => {
        s.enemies[0].id = "";
      },
    ],
    [
      "map key mismatch",
      (s) => {
        s.enemies[0].mapKey = "other";
      },
    ],
    [
      "fractional serial",
      (s) => {
        s.serials.building = 1.5;
      },
    ],
    [
      "zero serial",
      (s) => {
        s.serials.floorDrop = 0;
      },
    ],
    [
      "unsafe serial",
      (s) => {
        s.serials.projectile = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      "projectile serial collision",
      (s) => {
        s.serials.projectile = 1;
      },
    ],
    [
      "drop serial collision",
      (s) => {
        s.serials.floorDrop = 1;
      },
    ],
    [
      "building serial collision",
      (s) => {
        s.serials.building = 1;
      },
    ],
    [
      "unknown target",
      (s) => {
        s.projectiles[0].targetId = "missing";
      },
    ],
    [
      "negative drop",
      (s) => {
        s.floorDrops[0].amount = -1;
      },
    ],
    [
      "invalid projectile position",
      (s) => {
        s.projectiles[0].targetPosition.x = -Infinity;
      },
    ],
    [
      "incorrect counts",
      (s) => {
        s.counts.activeEnemies = -1;
      },
    ],
  ];
  for (const [label, corrupt] of corruptions) {
    it(`rejects ${label} without mutating gameplay`, () => {
      const source = projectRuntimeDiagnostics(diagnosticInput());
      const copy = structuredClone(source) as Mutable<RuntimeDiagnostics>;
      corrupt(copy);
      expect(() => assertRuntimeInvariants(copy)).toThrow("runtime invariant");
      expect(() => assertRuntimeInvariants(source)).not.toThrow();
    });
  }

  it("accepts characterized defeated overkill HP pending normal respawn", () => {
    const state = diagnosticInput();
    const enemy = [...state.enemies.values()][0];
    enemy.hp = -4;
    enemy.defeated = true;
    enemy.respawnAt = 12;
    expect(() =>
      assertRuntimeInvariants(projectRuntimeDiagnostics(state)),
    ).not.toThrow();
  });
});
