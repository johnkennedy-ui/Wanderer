import { describe, expect, it } from "vitest";
import { GameSession } from "../../domain/GameSession";
import {
  createBrowserSaveStorage,
  type KeyValueStore,
} from "../../platform/storage/browserSaveStorage";

const advance = (session: GameSession, seconds: number): void => {
  for (let tick = 0; tick < Math.ceil(seconds * 10); tick += 1)
    session.tick(0.1);
};

class MemoryStore implements KeyValueStore {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("GameSession", () => {
  it("immediately suppresses basic attacks while meaningful movement is present", () => {
    const session = new GameSession();
    const scoutBefore = session
      .snapshot()
      .enemies.find((enemy) => enemy.id === "enemy:starter-scout");
    session.move({ intent: { x: 1, y: 0 }, source: "keyboard", at: 1 });
    advance(session, 0.8);
    const scoutAfter = session
      .snapshot()
      .enemies.find((enemy) => enemy.id === "enemy:starter-scout");

    expect(session.snapshot().moving).toBe(true);
    expect(session.snapshot().combatStatus).toContain("suppressed");
    expect(scoutAfter?.hp).toBe(scoutBefore?.hp);

    session.move({ intent: { x: 0, y: 0 }, source: "keyboard", at: 2 });
    advance(session, 0.6);
    expect(session.snapshot().combatStatus).toContain("Auto-attacking");
  });

  it("rejects an isolated normal building without partial resource or record mutation", () => {
    const session = new GameSession();
    const before = session.snapshot();
    const result = session.placeBuilding("Workshop", { x: 48.1, y: 48.1 });
    const after = session.snapshot();

    expect(result).toEqual({
      ok: false,
      reason: "outside the 6m campfire settlement radius",
    });
    expect(after.buildings).toEqual([]);
    expect(after.resources).toEqual(before.resources);
  });

  it("accepts isolated Campfire bootstrap and preserves its stable ID through a committed save", () => {
    const session = new GameSession();
    const built = session.placeBuilding("Campfire", { x: 16.1, y: 16.1 });
    expect(built.ok).toBe(true);
    const request = session.createValidCampfireSaveRequest(1_700_000_000_000);
    expect(request).not.toBeNull();
    // The player is still at the home campfire; a manual action is still required to create this request.
    const restored = new GameSession({ saved: request?.document });
    expect(restored.snapshot().buildings).toEqual(session.snapshot().buildings);
  });

  it("keeps ordinary mutations runtime-only and restores only a validated explicit save", () => {
    const session = new GameSession();
    const request = session.createValidCampfireSaveRequest(42);
    expect(request).not.toBeNull();
    const storage = createBrowserSaveStorage(new MemoryStore());
    expect(storage.commit(request!.document).ok).toBe(true);

    session.move({ intent: { x: 1, y: 0 }, source: "keyboard", at: 1 });
    advance(session, 1);
    session.move({ intent: { x: 0, y: 0 }, source: "keyboard", at: 2 });
    expect(session.snapshot().player.position.x).toBeGreaterThan(0);

    const loaded = storage.load();
    const restored = new GameSession({ saved: loaded.document ?? undefined });
    expect(restored.snapshot().player.position).toEqual({ x: 0, y: 0 });
  });

  it("awards exactly three non-duplicate boss options and keeps the selected effect runtime-only before save", () => {
    const session = new GameSession();
    session.move({ intent: { x: 1, y: 0 }, source: "keyboard", at: 1 });
    advance(session, 2);
    session.move({ intent: { x: 0, y: 0 }, source: "keyboard", at: 2 });
    advance(session, 4);
    const choices = session.snapshot().pendingUpgradeChoices;
    expect(choices).toHaveLength(3);
    expect(new Set(choices).size).toBe(3);
    expect(session.snapshot().resources.bossCore).toBe(1);
    expect(session.chooseUpgrade(choices[0])).toBe(true);
    expect(session.snapshot().upgrades).toContain(choices[0]);
  });
});
