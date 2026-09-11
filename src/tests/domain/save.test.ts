import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GameSession } from "../../domain/GameSession";
import { buildingDefinitions } from "../../data/definitions";
import { decodeSave, isSaveDocument } from "../../domain/save";
import {
  toCurrentSaveStorageDocument,
  toSaveV2Document,
} from "../../domain/persistence/currentSave";
import type { SaveDocument } from "../../domain/types";
import {
  createBrowserSaveStorage,
  SAVE_KEYS,
  type KeyValueStore,
} from "../../platform/storage/browserSaveStorage";

class MemoryStore implements KeyValueStore {
  protected readonly values = new Map<string, string>();
  writes = 0;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes += 1;
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.writes += 1;
    this.values.delete(key);
  }

  seed(key: string, value: string): void {
    this.values.set(key, value);
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

class CleanupFailureStore extends MemoryStore {
  override removeItem(key: string): void {
    if (key === SAVE_KEYS.temporary)
      throw new Error("simulated temporary cleanup failure");
    super.removeItem(key);
  }
}

const fixtureNames = [
  "minimal",
  "progressed",
  "buildings-and-upgrades",
  "recovery-primary",
] as const;

const fixtureText = (name: (typeof fixtureNames)[number]): string =>
  readFileSync(
    new URL(`../fixtures/saves/v2/${name}.json`, import.meta.url),
    "utf8",
  );

const fixtureValue = (name: (typeof fixtureNames)[number]): unknown =>
  JSON.parse(fixtureText(name));

const validSave = (): SaveDocument => {
  const session = new GameSession();
  const request = session.createValidCampfireSaveRequest(1);
  if (request === null) throw new Error("home campfire should be valid");
  return request.document;
};

describe("schema-2 persistence boundary", () => {
  it.each(fixtureNames)(
    "decodes, migrates, hydrates, and reprojects the static %s fixture",
    (name) => {
      const text = fixtureText(name);
      const result = decodeSave(text);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.wireDocument).toEqual(fixtureValue(name));
      expect(toSaveV2Document(result.document)).toEqual(fixtureValue(name));
      expect(
        new GameSession({ saved: result.document }).presentation().ui.world,
      ).toEqual(result.document.world);
    },
  );

  it("keeps a historical Healer building wire value while presenting a Healing Hut", () => {
    const result = decodeSave(fixtureText("recovery-primary"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.buildings).toContainEqual(
      expect.objectContaining({ kind: "Healer" }),
    );
    expect(buildingDefinitions.Healer.label).toBe("Healing Hut");
  });

  it("distinguishes absent, malformed, invalid, unsupported schema, and unsupported generator data", () => {
    expect(decodeSave(null)).toMatchObject({ ok: false, failure: "absent" });
    expect(decodeSave("{not JSON")).toMatchObject({
      ok: false,
      failure: "invalid-json",
    });
    expect(decodeSave('{"schemaVersion":2}')).toMatchObject({
      ok: false,
      failure: "invalid-document",
    });
    expect(decodeSave('{"schemaVersion":3}')).toMatchObject({
      ok: false,
      failure: "unsupported-schema",
    });
    expect(
      decodeSave(
        JSON.stringify({
          ...(fixtureValue("minimal") as Record<string, unknown>),
          world: { seed: "legacy", generatorVersion: "wanderer-web-v9" },
        }),
      ),
    ).toMatchObject({ ok: false, failure: "unsupported-generator" });
  });

  it("keeps historical V2 validation independent of current generator support", () => {
    const historical = {
      ...(fixtureValue("minimal") as Record<string, unknown>),
      world: { seed: "legacy", generatorVersion: "wanderer-web-v9" },
    };
    expect(isSaveDocument(historical)).toBe(true);
    expect(decodeSave(JSON.stringify(historical))).toMatchObject({
      ok: false,
      failure: "unsupported-generator",
    });
  });

  it("rejects duplicate and unknown persisted content through the frozen V2 decoder", () => {
    const document = fixtureValue("buildings-and-upgrades") as SaveDocument;
    const duplicateBuilding = {
      ...document,
      buildings: [
        ...document.buildings,
        { ...document.buildings[0], position: { x: 2, y: 2 } },
      ],
    };
    const unknownBuilding = {
      ...document,
      buildings: [{ ...document.buildings[0], kind: "Unknown building" }],
    };
    const unknownUpgrade = { ...document, upgrades: ["unknown-upgrade"] };

    expect(isSaveDocument(duplicateBuilding)).toBe(false);
    expect(isSaveDocument(unknownBuilding)).toBe(false);
    expect(isSaveDocument(unknownUpgrade)).toBe(false);
  });
});

describe("browser save validation and recovery", () => {
  it("loads a valid primary without writes", () => {
    const store = new MemoryStore();
    const storage = createBrowserSaveStorage(store);
    const primary = fixtureText("minimal");
    store.seed(SAVE_KEYS.primary, primary);
    const writesBeforeLoad = store.writes;

    expect(storage.load()).toMatchObject({
      ok: true,
      source: "primary",
      warning: null,
      primaryFailure: null,
    });
    expect(store.writes).toBe(writesBeforeLoad);
    expect(store.getItem(SAVE_KEYS.primary)).toBe(primary);
  });

  it("falls back to a valid backup and retains the primary failure without writes", () => {
    const store = new MemoryStore();
    const storage = createBrowserSaveStorage(store);
    const backup = fixtureText("recovery-primary");
    store.seed(SAVE_KEYS.primary, "{not valid JSON");
    store.seed(SAVE_KEYS.backup, backup);
    const writesBeforeLoad = store.writes;

    expect(storage.load()).toMatchObject({
      ok: true,
      source: "backup",
      primaryFailure: "invalid-json",
      warning:
        "Primary save was absent or invalid; recovered the last valid backup.",
    });
    expect(store.writes).toBe(writesBeforeLoad);
    expect(store.getItem(SAVE_KEYS.primary)).toBe("{not valid JSON");
    expect(store.getItem(SAVE_KEYS.backup)).toBe(backup);
  });

  it("surfaces a present primary failure instead of treating it as a fresh save", () => {
    const store = new MemoryStore();
    const storage = createBrowserSaveStorage(store);
    store.seed(SAVE_KEYS.primary, "{not valid JSON");
    const writesBeforeLoad = store.writes;

    expect(storage.load()).toMatchObject({
      ok: false,
      failure: "invalid-json",
    });
    expect(store.writes).toBe(writesBeforeLoad);
  });

  it("reports absent only when primary and backup are both absent and ignores temporary data", () => {
    const store = new MemoryStore();
    const storage = createBrowserSaveStorage(store);
    store.seed(SAVE_KEYS.temporary, fixtureText("minimal"));
    const writesBeforeLoad = store.writes;

    expect(storage.load()).toMatchObject({ ok: false, failure: "absent" });
    expect(store.writes).toBe(writesBeforeLoad);
    expect(store.getItem(SAVE_KEYS.temporary)).toBe(fixtureText("minimal"));
  });

  it("does not mutate known-good primary or backup for an invalid commit", () => {
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

    expect(storage.commit(invalid)).toMatchObject({
      ok: false,
      message: "Save rejected: invalid document.",
    });
    expect(store.getItem(SAVE_KEYS.primary)).toBe(beforePrimary);
    expect(store.getItem(SAVE_KEYS.backup)).toBe(beforeBackup);
  });

  it("keeps frozen V2 projection exact while browser storage retains current extensions", () => {
    const store = new MemoryStore();
    const storage = createBrowserSaveStorage(store);
    const document = {
      ...validSave(),
      classProgression: {
        experience: 6,
        level: 1 as const,
        playerClass: "wizard" as const,
        skillIds: [],
        weaponRank: 2,
      },
    };

    expect(storage.commit(document).ok).toBe(true);
    const serialized = store.getItem(SAVE_KEYS.primary);
    expect(serialized).not.toBeNull();
    expect(JSON.parse(serialized ?? "")).toEqual(
      toCurrentSaveStorageDocument(document),
    );
    expect(toSaveV2Document(document)).not.toHaveProperty("classProgression");
    expect(JSON.parse(serialized ?? "")).toMatchObject({ schemaVersion: 2 });
  });

  it("stages and validates temporary and backup data before an interrupted primary write", () => {
    const store = new InterruptedPrimaryStore();
    const storage = createBrowserSaveStorage(store);
    const knownGood = validSave();
    expect(storage.commit(knownGood).ok).toBe(true);
    const originalPrimary = store.getItem(SAVE_KEYS.primary);

    store.failPrimary = true;
    expect(storage.commit({ ...knownGood, committedAt: 4 })).toMatchObject({
      ok: false,
      message: "Save failed safely: browser storage was unavailable.",
    });
    expect(store.getItem(SAVE_KEYS.primary)).toBe(originalPrimary);
    expect(storage.load()).toMatchObject({ ok: true, source: "primary" });
  });

  it("keeps a successful primary commit successful when only temporary cleanup fails", () => {
    const store = new CleanupFailureStore();
    const storage = createBrowserSaveStorage(store);
    const result = storage.commit(validSave());

    expect(result).toMatchObject({
      ok: true,
      cleanupWarning:
        "Primary save committed, but temporary cleanup could not be completed.",
    });
    expect(store.getItem(SAVE_KEYS.primary)).not.toBeNull();
    expect(store.getItem(SAVE_KEYS.temporary)).not.toBeNull();
    expect(storage.load()).toMatchObject({ ok: true, source: "primary" });
  });
});
