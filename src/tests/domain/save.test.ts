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
import { emptyPlayerStatAllocations } from "../../domain/types";
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
      failure: "invalid-document",
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

  it("rejects malformed, overspent, and classless V4 allocation records before hydration", () => {
    const valid = {
      ...validSave(),
      classProgression: {
        experience: 6,
        level: 1 as const,
        playerClass: "knight" as const,
        skillIds: [],
        allocatedStats: {
          ...emptyPlayerStatAllocations(),
          strength: 3,
        },
        weaponRank: 0,
      },
    };
    const { luck: omittedLuck, ...missingLuck } =
      valid.classProgression.allocatedStats;
    void omittedLuck;
    const invalidRecords = [
      {
        ...valid,
        classProgression: {
          ...valid.classProgression,
          allocatedStats: missingLuck,
        },
      },
      {
        ...valid,
        classProgression: {
          ...valid.classProgression,
          allocatedStats: {
            ...valid.classProgression.allocatedStats,
            strength: 1.5,
          },
        },
      },
      {
        ...valid,
        classProgression: {
          ...valid.classProgression,
          allocatedStats: {
            ...valid.classProgression.allocatedStats,
            luck: -1,
          },
        },
      },
      {
        ...valid,
        classProgression: {
          ...valid.classProgression,
          allocatedStats: {
            ...valid.classProgression.allocatedStats,
            strength: 4,
          },
        },
      },
      {
        ...valid,
        classProgression: {
          experience: 0,
          level: 0 as const,
          playerClass: null,
          skillIds: [],
          allocatedStats: {
            ...emptyPlayerStatAllocations(),
            strength: 1,
          },
          weaponRank: 0,
        },
      },
    ];

    for (const document of invalidRecords) {
      expect(isSaveDocument(document)).toBe(false);
      expect(decodeSave(JSON.stringify(document))).toMatchObject({
        ok: false,
        failure: "invalid-document",
      });
    }
  });

  it("migrates a frozen V3 level-5 save into V4 without widening historical validation", () => {
    const base = validSave();
    const historicalV3 = {
      ...toSaveV2Document({
        ...base,
        player: { ...base.player, hp: 850, maxHp: 850 },
      }),
      schemaVersion: 3 as const,
      classProgression: {
        experience: 9999,
        level: 5 as const,
        playerClass: "knight" as const,
        skillIds: [
          "knight-iron-guard",
          "knight-heavy-blade",
          "knight-execution-arc",
          "knight-bulwark",
        ],
        allocatedStats: {
          ...emptyPlayerStatAllocations(),
          strength: 4,
        },
        weaponRank: 2,
      },
    };
    expect(isSaveDocument(historicalV3)).toBe(true);
    const decoded = decodeSave(JSON.stringify(historicalV3));
    expect(decoded).toMatchObject({
      ok: true,
      wireDocument: { schemaVersion: 3 },
      document: {
        schemaVersion: 4,
        player: { hp: 1450, maxHp: 1450 },
        classProgression: {
          experience: 9999,
          level: 25,
          playerClass: "knight",
          skillIds: historicalV3.classProgression.skillIds,
          allocatedStats: historicalV3.classProgression.allocatedStats,
          weaponRank: 2,
        },
      },
    });
    if (!decoded.ok) throw new Error("Expected frozen V3 save to load");
    expect(
      decoded.document.classProgression.legacySkillSelection,
    ).toBeUndefined();
    const widenedAsV3 = {
      ...historicalV3,
      classProgression: {
        ...historicalV3.classProgression,
        skillIds: ["knight-boss-5"],
      },
    };
    expect(isSaveDocument(widenedAsV3)).toBe(false);
    expect(decodeSave(JSON.stringify(widenedAsV3))).toMatchObject({
      ok: false,
      failure: "invalid-document",
    });
  });

  it("preserves each frozen-validator legacy skill selection through V4", () => {
    const base = validSave();
    const legacyProgression = {
      experience: 300,
      level: 5 as const,
      playerClass: "knight" as const,
      skillIds: ["wizard-flame-orb"] as const,
      weaponRank: 0,
    };
    const historicalV2 = {
      ...toSaveV2Document(base),
      classProgression: legacyProgression,
    };
    const historicalV3 = {
      ...toSaveV2Document(base),
      schemaVersion: 3 as const,
      classProgression: {
        ...legacyProgression,
        allocatedStats: emptyPlayerStatAllocations(),
      },
    };

    for (const historical of [historicalV2, historicalV3]) {
      expect(isSaveDocument(historical)).toBe(true);
      const decoded = decodeSave(JSON.stringify(historical));
      expect(decoded).toMatchObject({
        ok: true,
        document: {
          schemaVersion: 4,
          classProgression: {
            experience: 300,
            level: 5,
            playerClass: "knight",
            skillIds: ["wizard-flame-orb"],
            legacySkillSelection: true,
          },
        },
      });
      if (!decoded.ok) throw new Error("Expected frozen legacy save to load");

      const current = toCurrentSaveStorageDocument(decoded.document);
      expect(isSaveDocument(current)).toBe(true);
      expect(decodeSave(JSON.stringify(current))).toMatchObject({
        ok: true,
        document: {
          classProgression: {
            skillIds: ["wizard-flame-orb"],
            legacySkillSelection: true,
          },
        },
      });

      const session = new GameSession({ saved: decoded.document });
      const request = session.createValidCampfireSaveRequest(2);
      expect(request?.document.classProgression).toMatchObject({
        skillIds: ["wizard-flame-orb"],
        legacySkillSelection: true,
      });
      expect(isSaveDocument(request?.document)).toBe(true);
    }

    const classlessV2 = {
      ...toSaveV2Document(base),
      classProgression: {
        experience: 300,
        level: 5 as const,
        playerClass: null,
        skillIds: ["wizard-flame-orb"],
        weaponRank: 0,
      },
    };
    expect(isSaveDocument(classlessV2)).toBe(true);
    const classlessDecoded = decodeSave(JSON.stringify(classlessV2));
    expect(classlessDecoded).toMatchObject({
      ok: true,
      document: {
        classProgression: {
          playerClass: null,
          skillIds: ["wizard-flame-orb"],
          legacySkillSelection: true,
        },
      },
    });
    if (!classlessDecoded.ok)
      throw new Error("Expected classless frozen V2 save to load");
    const classlessRequest = new GameSession({
      saved: classlessDecoded.document,
    }).createValidCampfireSaveRequest(2);
    expect(classlessRequest?.document.classProgression).toMatchObject({
      playerClass: null,
      skillIds: ["wizard-flame-orb"],
      legacySkillSelection: true,
    });
    expect(isSaveDocument(classlessRequest?.document)).toBe(true);

    const levelSixV3 = {
      ...toSaveV2Document(base),
      schemaVersion: 3 as const,
      classProgression: {
        experience: 400,
        level: 5 as const,
        playerClass: "knight" as const,
        skillIds: [
          "wizard-flame-orb",
          "knight-heavy-blade",
          "knight-execution-arc",
          "knight-bulwark",
        ],
        allocatedStats: emptyPlayerStatAllocations(),
        weaponRank: 0,
      },
    };
    expect(isSaveDocument(levelSixV3)).toBe(true);
    const levelSixDecoded = decodeSave(JSON.stringify(levelSixV3));
    if (!levelSixDecoded.ok)
      throw new Error("Expected level-six frozen V3 save to load");
    const levelSixSession = new GameSession({
      saved: levelSixDecoded.document,
    });
    expect(levelSixSession.presentation().ui).toMatchObject({
      classProgression: { level: 6, legacySkillSelection: true },
      pendingClassSkillChoices: [],
    });
    const levelSixRequest = levelSixSession.createValidCampfireSaveRequest(2);
    expect(isSaveDocument(levelSixRequest?.document)).toBe(true);
  });

  it("leaves canonical frozen V2/V3 skill prefixes unmarked", () => {
    const base = validSave();
    const canonicalProgression = {
      experience: 300,
      level: 5 as const,
      playerClass: "knight" as const,
      skillIds: ["knight-iron-guard"] as const,
      weaponRank: 0,
    };
    const canonicalV2 = {
      ...toSaveV2Document(base),
      classProgression: canonicalProgression,
    };
    const canonicalV3 = {
      ...toSaveV2Document(base),
      schemaVersion: 3 as const,
      classProgression: {
        ...canonicalProgression,
        allocatedStats: emptyPlayerStatAllocations(),
      },
    };
    for (const historical of [canonicalV2, canonicalV3]) {
      const decoded = decodeSave(JSON.stringify(historical));
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) continue;
      expect(
        decoded.document.classProgression.legacySkillSelection,
      ).toBeUndefined();
    }
  });

  it("accepts only contiguous V4 class-route skill prefixes", () => {
    const base = validSave();
    const validBossRoute = {
      ...base,
      classProgression: {
        experience: 6100,
        level: 25 as const,
        playerClass: "wizard" as const,
        skillIds: [
          "wizard-flame-orb",
          "wizard-arcane-haste",
          "wizard-nova",
          "wizard-meteor",
          "wizard-boss-5",
          "wizard-boss-6",
        ],
        allocatedStats: emptyPlayerStatAllocations(),
        weaponRank: 0,
      },
    };
    expect(isSaveDocument(validBossRoute)).toBe(true);
    expect(decodeSave(JSON.stringify(validBossRoute))).toMatchObject({
      ok: true,
      document: { schemaVersion: 4 },
    });

    const invalidSkillSequences = [
      [
        "wizard-flame-orb",
        "wizard-arcane-haste",
        "wizard-nova",
        "wizard-meteor",
        "wizard-boss-5",
        "wizard-aoe-6",
      ],
      ["wizard-flame-orb", "wizard-nova"],
      ["knight-iron-guard"],
      [
        "wizard-flame-orb",
        "wizard-arcane-haste",
        "wizard-nova",
        "wizard-meteor",
        "wizard-boss-5",
        "wizard-boss-5",
      ],
    ];
    for (const skillIds of invalidSkillSequences) {
      const candidate = {
        ...validBossRoute,
        classProgression: { ...validBossRoute.classProgression, skillIds },
      };
      expect(isSaveDocument(candidate)).toBe(false);
      expect(decodeSave(JSON.stringify(candidate))).toMatchObject({
        ok: false,
        failure: "invalid-document",
      });
    }

    const invalidLegacyMarker = {
      ...validBossRoute,
      classProgression: {
        ...validBossRoute.classProgression,
        legacySkillSelection: true,
      },
    };
    expect(isSaveDocument(invalidLegacyMarker)).toBe(false);
    expect(decodeSave(JSON.stringify(invalidLegacyMarker))).toMatchObject({
      ok: false,
      failure: "invalid-document",
    });

    const canonicalLegacyMarker = {
      ...validBossRoute,
      classProgression: {
        experience: 300,
        level: 5 as const,
        playerClass: "wizard" as const,
        skillIds: ["wizard-flame-orb"],
        legacySkillSelection: true as const,
        allocatedStats: emptyPlayerStatAllocations(),
        weaponRank: 0,
      },
    };
    expect(isSaveDocument(canonicalLegacyMarker)).toBe(false);
    expect(decodeSave(JSON.stringify(canonicalLegacyMarker))).toMatchObject({
      ok: false,
      failure: "invalid-document",
    });

    const persistedRouteField = {
      ...validBossRoute,
      classProgression: {
        ...validBossRoute.classProgression,
        route: "boss",
      },
    };
    expect(isSaveDocument(persistedRouteField)).toBe(false);
    expect(decodeSave(JSON.stringify(persistedRouteField))).toMatchObject({
      ok: false,
      failure: "invalid-document",
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

  it("keeps frozen V2 projection exact while browser storage writes V4 progression", () => {
    const store = new MemoryStore();
    const storage = createBrowserSaveStorage(store);
    const document = {
      ...validSave(),
      classProgression: {
        experience: 6,
        level: 1 as const,
        playerClass: "wizard" as const,
        skillIds: [],
        allocatedStats: emptyPlayerStatAllocations(),
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
    expect(JSON.parse(serialized ?? "")).toMatchObject({ schemaVersion: 4 });
  });

  it("keeps a loaded V2 save byte-stable until an explicit V4 campfire commit persists an allocation", () => {
    const store = new MemoryStore();
    const storage = createBrowserSaveStorage(store);
    const fresh = validSave();
    const legacy = JSON.stringify({
      ...toSaveV2Document({
        ...fresh,
        player: { ...fresh.player, hp: 130, maxHp: 130 },
      }),
      classProgression: {
        experience: 6,
        level: 1,
        playerClass: "knight",
        skillIds: [],
        weaponRank: 0,
      },
    });
    store.seed(SAVE_KEYS.primary, legacy);
    const writesBeforeLoad = store.writes;

    const loadedLegacy = storage.load();
    expect(loadedLegacy).toMatchObject({
      ok: true,
      source: "primary",
      document: {
        schemaVersion: 4,
        classProgression: { allocatedStats: emptyPlayerStatAllocations() },
      },
    });
    if (!loadedLegacy.ok) throw new Error("Expected legacy V2 save to load");
    expect(store.writes).toBe(writesBeforeLoad);
    expect(store.getItem(SAVE_KEYS.primary)).toBe(legacy);

    const session = new GameSession({ saved: loadedLegacy.document });
    expect(session.allocateStat("strength")).toBe(true);
    expect(store.getItem(SAVE_KEYS.primary)).toBe(legacy);
    const request = session.createValidCampfireSaveRequest(77);
    if (request === null) throw new Error("Home campfire should issue a save");
    expect(storage.commit(request.document)).toMatchObject({ ok: true });

    const persisted = store.getItem(SAVE_KEYS.primary);
    expect(JSON.parse(persisted ?? "")).toMatchObject({
      schemaVersion: 4,
      classProgression: {
        allocatedStats: { ...emptyPlayerStatAllocations(), strength: 1 },
      },
    });
    const reloaded = storage.load();
    expect(reloaded).toMatchObject({
      ok: true,
      source: "primary",
      document: {
        classProgression: {
          allocatedStats: { ...emptyPlayerStatAllocations(), strength: 1 },
        },
      },
    });
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
