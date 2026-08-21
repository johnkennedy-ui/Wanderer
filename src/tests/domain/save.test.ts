import { describe, expect, it } from "vitest";
import { GameSession } from "../../domain/GameSession";
import { isSaveDocument } from "../../domain/save";
import type { SaveDocument } from "../../domain/types";
import {
  createBrowserSaveStorage,
  SAVE_KEYS,
  type KeyValueStore,
} from "../../platform/storage/browserSaveStorage";

class MemoryStore implements KeyValueStore {
  protected values = new Map<string, string>();

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

class InterruptedPrimaryStore extends MemoryStore {
  failPrimary = false;

  override setItem(key: string, value: string): void {
    if (this.failPrimary && key === SAVE_KEYS.primary)
      throw new Error("simulated interrupted primary write");
    super.setItem(key, value);
  }
}

const validSave = (): SaveDocument => {
  const session = new GameSession();
  const request = session.createValidCampfireSaveRequest(1);
  if (request === null) throw new Error("home campfire should be valid");
  return request.document;
};

describe("browser save validation and recovery", () => {
  it("falls back to the last valid backup when a primary payload is corrupt", () => {
    const store = new MemoryStore();
    const storage = createBrowserSaveStorage(store);
    const first = validSave();
    const second = { ...first, committedAt: 2 };
    expect(storage.commit(first).ok).toBe(true);
    expect(storage.commit(second).ok).toBe(true);
    store.setItem(SAVE_KEYS.primary, "{not valid JSON");

    expect(storage.load()).toEqual({
      document: first,
      source: "backup",
      warning:
        "Primary save was absent or invalid; recovered the last valid backup.",
    });
  });

  it("fails invalid documents closed without mutating a known-good primary or backup", () => {
    const store = new MemoryStore();
    const storage = createBrowserSaveStorage(store);
    const knownGood = validSave();
    expect(storage.commit(knownGood).ok).toBe(true);
    const beforePrimary = store.getItem(SAVE_KEYS.primary);
    const beforeBackup = store.getItem(SAVE_KEYS.backup);
    const invalid = {
      ...knownGood,
      resources: { ...knownGood.resources, obsoleteResource: 1 },
    } as unknown as SaveDocument;

    expect(storage.commit(invalid)).toEqual({
      ok: false,
      message: "Save rejected: invalid document.",
    });
    expect(store.getItem(SAVE_KEYS.primary)).toBe(beforePrimary);
    expect(store.getItem(SAVE_KEYS.backup)).toBe(beforeBackup);
  });

  it("rejects duplicate building IDs and unknown building or upgrade definitions", () => {
    const session = new GameSession();
    const placed = session.placeBuilding("Workshop", { x: 1, y: 1 });
    if (!placed.ok || placed.building === undefined)
      throw new Error("Workshop should be placeable at home");
    const request = session.createValidCampfireSaveRequest(3);
    if (request === null) throw new Error("home campfire should remain valid");
    const document = request.document;
    const duplicateBuilding = {
      ...document,
      buildings: [
        ...document.buildings,
        { ...document.buildings[0], position: { x: 2, y: 2 } },
      ],
    };
    const unknownBuilding = {
      ...document,
      buildings: [
        {
          ...document.buildings[0],
          kind: "Unknown building",
        },
      ],
    };
    const unknownUpgrade = {
      ...document,
      upgrades: ["unknown-upgrade"],
    };

    expect(isSaveDocument(duplicateBuilding)).toBe(false);
    expect(isSaveDocument(unknownBuilding)).toBe(false);
    expect(isSaveDocument(unknownUpgrade)).toBe(false);
  });

  it("stages and validates temporary and backup data before an interrupted primary write", () => {
    const store = new InterruptedPrimaryStore();
    const storage = createBrowserSaveStorage(store);
    const knownGood = validSave();
    expect(storage.commit(knownGood).ok).toBe(true);
    const originalPrimary = store.getItem(SAVE_KEYS.primary);

    store.failPrimary = true;
    expect(storage.commit({ ...knownGood, committedAt: 4 })).toEqual({
      ok: false,
      message: "Save failed safely: browser storage was unavailable.",
    });
    expect(store.getItem(SAVE_KEYS.primary)).toBe(originalPrimary);
    expect(storage.load()).toMatchObject({
      document: knownGood,
      source: "primary",
    });
  });
});
