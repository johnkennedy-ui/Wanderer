import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { GameSession } from "../../domain/GameSession";
import { buildingDefinitions } from "../../data/definitions";
import { decodeSave, isSaveDocument } from "../../domain/save";
import {
  toCurrentSaveStorageDocument,
  toSaveV2Document,
} from "../../domain/persistence/currentSave";
import { isSaveV2Document } from "../../domain/persistence/saveV2";
import { isSaveV3Document } from "../../domain/persistence/saveV3";
import { isSaveV4Document } from "../../domain/persistence/saveV4";
import { isSaveV5DocumentStructure } from "../../domain/persistence/saveV5";
import { MAX_SAVE_DOCUMENT_CODE_UNITS } from "../../domain/persistence/saveLimits";
import type { SaveDocument } from "../../domain/types";
import type { SaveV2Document } from "../../domain/persistence/saveV2";
import { emptyPlayerStatAllocations } from "../../domain/types";
import { harvestRewardsForObstacle } from "../../domain/resourceHarvesting";
import {
  CHUNK_SIZE,
  generateChunk,
  WANDERER_WEB_V1,
  WANDERER_WEB_V2,
  WANDERER_WEB_V3,
} from "../../domain/world";
import type { WorldIdentity } from "../../domain/types";
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

class FaultingStore extends MemoryStore {
  readonly failGetKeys = new Set<string>();
  readonly failSetKeys = new Set<string>();
  readonly corruptSetKeys = new Set<string>();

  override getItem(key: string): string | null {
    if (this.failGetKeys.has(key)) throw new Error("simulated read failure");
    return super.getItem(key);
  }

  override setItem(key: string, value: string): void {
    if (this.failSetKeys.has(key)) throw new Error("simulated write failure");
    super.setItem(
      key,
      this.corruptSetKeys.has(key) ? value.slice(0, -1) : value,
    );
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

const generatedRecipes = new Map<string, ReturnType<typeof generateChunk>>();
const findGeneratedHarvestedNodeId = (
  world: WorldIdentity,
  resource: "wood" | "iron",
): string => {
  for (let radius = 0; radius <= 8; radius += 1)
    for (let y = -radius; y <= radius; y += 1)
      for (let x = -radius; x <= radius; x += 1) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== radius) continue;
        const key = `${world.generatorVersion}:${world.seed}:${x}:${y}`;
        let recipe = generatedRecipes.get(key);
        if (recipe === undefined) {
          recipe = generateChunk(world, { x, y });
          generatedRecipes.set(key, recipe);
        }
        const node = recipe.obstacles.find((obstacle) => {
          const rewards = harvestRewardsForObstacle(obstacle);
          return resource === "wood"
            ? rewards?.wood !== undefined
            : rewards?.iron !== undefined;
        });
        if (node !== undefined) return node.id;
      }
  throw new Error(
    `No generated ${resource} node found for ${world.generatorVersion}.`,
  );
};

describe("schema-2 persistence boundary", () => {
  it("round-trips current wall and tower content while rejecting an explicit V2 projection", () => {
    const current = {
      ...validSave(),
      buildings: [
        {
          id: "building:wall:0001",
          kind: "WoodWall" as const,
          level: 1 as const,
          position: { x: -1, y: 2 },
        },
        {
          id: "building:wall:0002",
          kind: "StoneWall" as const,
          level: 1 as const,
          position: { x: 0, y: 2 },
        },
        {
          id: "building:tower:0003",
          kind: "MageTower" as const,
          level: 1 as const,
          position: { x: 1, y: 2 },
        },
        {
          id: "building:legacy:0004",
          kind: "Farm" as const,
          level: 1 as const,
          position: { x: 1.25, y: -2.75 },
        },
      ],
    };
    const serialized = toCurrentSaveStorageDocument(current);
    expect(isSaveDocument(serialized)).toBe(true);
    expect(decodeSave(JSON.stringify(serialized))).toMatchObject({
      ok: true,
      document: { buildings: current.buildings },
    });
    expect(() => toSaveV2Document(current)).toThrow("cannot be projected");
  });

  it("copies only whitelisted V4 fields and rejects malformed current common fields", () => {
    const current = {
      ...validSave(),
      buildings: [
        {
          id: "building:wall:0001",
          kind: "WoodWall" as const,
          level: 1 as const,
          position: { x: -1, y: 2 },
          runtimeOnly: "do-not-persist",
        },
      ],
      world: { ...validSave().world, runtimeOnly: true },
      player: {
        ...validSave().player,
        position: { ...validSave().player.position, runtimeOnly: true },
      },
      resources: { ...validSave().resources, runtimeOnly: 1 },
    } as unknown as SaveDocument;
    const projected = toCurrentSaveStorageDocument(current);
    expect(projected).not.toHaveProperty("world.runtimeOnly");
    expect(projected).not.toHaveProperty("player.position.runtimeOnly");
    expect(projected).not.toHaveProperty("resources.runtimeOnly");
    expect(projected).not.toHaveProperty("buildings.0.runtimeOnly");

    expect(isSaveDocument({ ...projected, resources: {} })).toBe(false);
    expect(
      isSaveDocument({
        ...projected,
        buildings: [projected.buildings[0], projected.buildings[0]],
      }),
    ).toBe(false);
    expect(
      isSaveDocument({ ...projected, player: { ...projected.player, hp: -1 } }),
    ).toBe(false);
  });

  it("keeps V4 strict and rejects V2 projections that discard Iron or depletion", () => {
    const current = toCurrentSaveStorageDocument(validSave());
    const { iron: _iron, ...legacyResources } = current.resources;
    const {
      schemaVersion: _version,
      harvestedNodeIds: _harvested,
      ...legacyFields
    } = current;
    const legacyV4 = {
      ...legacyFields,
      schemaVersion: 4,
      resources: legacyResources,
    };
    expect(isSaveV4Document(legacyV4)).toBe(true);
    expect(isSaveV4Document(current)).toBe(false);
    expect(isSaveDocument(current)).toBe(true);
    expect(decodeSave(JSON.stringify(legacyV4))).toMatchObject({
      ok: true,
      document: {
        schemaVersion: 5,
        resources: { iron: 0 },
        harvestedNodeIds: [],
      },
    });

    const withIron = {
      ...validSave(),
      resources: { ...validSave().resources, iron: 1 },
    };
    const withHarvestedNode = {
      ...validSave(),
      harvestedNodeIds: ["harvested-node:test"],
    };
    expect(() => toSaveV2Document(withIron)).toThrow(
      /Iron and harvested-node state/,
    );
    expect(() => toSaveV2Document(withHarvestedNode)).toThrow(
      /Iron and harvested-node state/,
    );
  });

  it("keeps historical parsers but rejects unsafe balances after V2-V4 migration", () => {
    const v2 = fixtureValue("minimal") as SaveV2Document;
    const v3 = {
      ...v2,
      schemaVersion: 3,
      classProgression: {
        experience: 0,
        level: 0,
        playerClass: null,
        skillIds: [],
        allocatedStats: emptyPlayerStatAllocations(),
      },
    };
    const current = toCurrentSaveStorageDocument(validSave());
    const { iron: _iron, ...v4Resources } = current.resources;
    const {
      schemaVersion: _schemaVersion,
      harvestedNodeIds: _harvestedNodeIds,
      ...v4Fields
    } = current;
    const v4 = { ...v4Fields, schemaVersion: 4, resources: v4Resources };
    const wide = Number.MAX_SAFE_INTEGER + 1;
    const unsafeV2 = { ...v2, resources: { ...v2.resources, wood: wide } };
    const unsafeV3 = { ...v3, resources: { ...v3.resources, wood: wide } };
    const unsafeV4 = { ...v4, resources: { ...v4.resources, wood: wide } };

    expect(isSaveV2Document(unsafeV2)).toBe(true);
    expect(isSaveV3Document(unsafeV3)).toBe(true);
    expect(isSaveV4Document(unsafeV4)).toBe(true);
    for (const legacy of [unsafeV2, unsafeV3, unsafeV4])
      expect(decodeSave(JSON.stringify(legacy))).toMatchObject({
        ok: false,
        failure: "invalid-document",
      });

    for (const legacy of [
      {
        ...unsafeV2,
        resources: { ...unsafeV2.resources, wood: Number.MAX_SAFE_INTEGER },
      },
      {
        ...unsafeV3,
        resources: { ...unsafeV3.resources, wood: Number.MAX_SAFE_INTEGER },
      },
      {
        ...unsafeV4,
        resources: { ...unsafeV4.resources, wood: Number.MAX_SAFE_INTEGER },
      },
    ])
      expect(decodeSave(JSON.stringify(legacy))).toMatchObject({ ok: true });
  });

  it("accepts only bounded canonical V5 IDs for generated harvestable nodes", () => {
    const current = toCurrentSaveStorageDocument(validSave());
    const treeId = findGeneratedHarvestedNodeId(current.world, "wood");
    const rockId = findGeneratedHarvestedNodeId(current.world, "iron");
    expect(
      isSaveDocument({ ...current, harvestedNodeIds: [treeId, rockId] }),
    ).toBe(true);

    for (const generatorVersion of [
      WANDERER_WEB_V1,
      WANDERER_WEB_V2,
      WANDERER_WEB_V3,
    ]) {
      const historicalWorld = { ...current.world, generatorVersion };
      const historicalRock = findGeneratedHarvestedNodeId(
        historicalWorld,
        "iron",
      );
      expect(
        isSaveDocument({
          ...current,
          world: historicalWorld,
          harvestedNodeIds: [historicalRock],
        }),
      ).toBe(true);
    }
    const safeIronBalance = {
      ...current,
      resources: { ...current.resources, iron: Number.MAX_SAFE_INTEGER },
    };
    const unsafeIronBalance = {
      ...current,
      resources: { ...current.resources, iron: Number.MAX_SAFE_INTEGER + 1 },
    };
    expect(isSaveDocument(safeIronBalance)).toBe(true);
    expect(isSaveDocument(unsafeIronBalance)).toBe(false);
    expect(decodeSave(JSON.stringify(unsafeIronBalance))).toMatchObject({
      ok: false,
      failure: "invalid-document",
    });

    const inheritedWideBalances = {
      ...current,
      resources: {
        ...current.resources,
        wood: Number.MAX_SAFE_INTEGER + 1,
        stone: Number.MAX_SAFE_INTEGER + 1,
      },
    };
    expect(isSaveDocument(inheritedWideBalances)).toBe(false);
    expect(decodeSave(JSON.stringify(inheritedWideBalances))).toMatchObject({
      ok: false,
      failure: "invalid-document",
    });

    expect(
      isSaveDocument({
        ...current,
        harvestedNodeIds: [treeId, treeId],
      }),
    ).toBe(false);
    const sparseNodeIds = new Array<string>(1);
    expect(
      isSaveDocument({ ...current, harvestedNodeIds: sparseNodeIds }),
    ).toBe(false);
    expect(
      isSaveDocument({
        ...current,
        harvestedNodeIds: [
          "tree:" + current.world.generatorVersion + ":other-world:0:0:0",
        ],
      }),
    ).toBe(false);
    expect(
      isSaveDocument({
        ...current,
        harvestedNodeIds: [
          "tree:wanderer-web-v2:" + current.world.seed + ":0:0:0",
        ],
      }),
    ).toBe(false);
    const treePrefix =
      "tree:" + current.world.generatorVersion + ":" + current.world.seed + ":";
    for (const nonCanonicalId of [
      `${treePrefix}00:0:0`,
      `${treePrefix}-0:0:0`,
      `${treePrefix}+1:0:0`,
    ])
      expect(
        isSaveDocument({ ...current, harvestedNodeIds: [nonCanonicalId] }),
      ).toBe(false);
    // V3 may filter candidate tree indices while constructing the final home
    // recipe; plausible tuple syntax is not proof of generated membership.
    const homeTreeCandidates = [0, 1, 2].map(
      (index) => `${treePrefix}0:0:${index}`,
    );
    const filteredHomeTreeId = homeTreeCandidates.find(
      (id) =>
        !generateChunk(current.world, { x: 0, y: 0 }).obstacles.some(
          (o) => o.id === id,
        ),
    );
    expect(filteredHomeTreeId).toBeDefined();
    expect(
      isSaveDocument({
        ...current,
        harvestedNodeIds: [filteredHomeTreeId],
      }),
    ).toBe(false);
    expect(
      isSaveDocument({
        ...current,
        harvestedNodeIds: [
          `rock:${current.world.generatorVersion}:${current.world.seed}:9007199254740991:0:0`,
        ],
      }),
    ).toBe(false);
    expect(
      isSaveDocument({
        ...current,
        harvestedNodeIds: Array.from(
          { length: 4097 },
          (_, index) =>
            "tree:" +
            current.world.generatorVersion +
            ":" +
            current.world.seed +
            ":0:0:" +
            index,
        ),
      }),
    ).toBe(false);
    expect(
      isSaveDocument({
        ...current,
        resources: { ...current.resources, iron: -1 },
      }),
    ).toBe(false);
    const longSeed = "s".repeat(1000);
    const longWorld = { ...current.world, seed: longSeed };
    expect(
      isSaveDocument({
        ...current,
        world: longWorld,
        harvestedNodeIds: [
          `rock:${longWorld.generatorVersion}:${longSeed}:0:0:0`,
        ],
      }),
    ).toBe(false);

    const wideSeed = "w".repeat(256);
    const wideWorld = { ...current.world, seed: wideSeed };
    const oversizedDepletion = Array.from(
      { length: 4096 },
      (_, index) =>
        `rock:${wideWorld.generatorVersion}:${wideSeed}:${index}:0:0`,
    );
    expect(
      isSaveDocument({
        ...current,
        world: wideWorld,
        harvestedNodeIds: oversizedDepletion,
      }),
    ).toBe(false);
  });

  it("keeps V1/V2 membership bounds local to their historical chunk", () => {
    const current = toCurrentSaveStorageDocument(validSave());
    const farChunkAxis = Math.floor(
      (Number.MAX_SAFE_INTEGER / 100 - 14) / CHUNK_SIZE,
    );
    expect(Number.isSafeInteger((farChunkAxis * CHUNK_SIZE + 14) * 100)).toBe(
      true,
    );
    expect(
      Number.isSafeInteger(((farChunkAxis + 1) * CHUNK_SIZE + 14) * 100),
    ).toBe(false);

    for (const generatorVersion of [WANDERER_WEB_V1, WANDERER_WEB_V2]) {
      const world = { ...current.world, generatorVersion };
      const rock = generateChunk(world, {
        x: farChunkAxis,
        y: 0,
      }).obstacles.find(
        (obstacle) => harvestRewardsForObstacle(obstacle)?.iron === 12,
      );
      expect(rock).toBeDefined();
      if (rock === undefined) continue;
      expect(
        isSaveDocument({ ...current, world, harvestedNodeIds: [rock.id] }),
      ).toBe(true);
    }

    const v3World = { ...current.world, generatorVersion: WANDERER_WEB_V3 };
    const safeV3Axis = farChunkAxis - 2;
    const upperBoundaryNode = generateChunk(v3World, {
      x: safeV3Axis,
      y: 0,
    }).obstacles.find(
      (obstacle) => harvestRewardsForObstacle(obstacle) !== null,
    );
    const lowerBoundaryNode = generateChunk(v3World, {
      x: -safeV3Axis,
      y: 0,
    }).obstacles.find(
      (obstacle) => harvestRewardsForObstacle(obstacle) !== null,
    );
    expect(upperBoundaryNode).toBeDefined();
    expect(lowerBoundaryNode).toBeDefined();
    if (upperBoundaryNode !== undefined)
      expect(
        isSaveDocument({
          ...current,
          world: v3World,
          harvestedNodeIds: [upperBoundaryNode.id],
        }),
      ).toBe(true);
    if (lowerBoundaryNode !== undefined)
      expect(
        isSaveDocument({
          ...current,
          world: v3World,
          harvestedNodeIds: [lowerBoundaryNode.id],
        }),
      ).toBe(true);

    const v3NeighborOverflowIds = [safeV3Axis + 1, -safeV3Axis - 1].map(
      (axis) =>
        "rock:" + WANDERER_WEB_V3 + ":" + v3World.seed + ":" + axis + ":0:0",
    );
    expect(
      v3NeighborOverflowIds.every((id) =>
        isSaveV5DocumentStructure({
          ...current,
          world: v3World,
          harvestedNodeIds: [id],
        }),
      ),
    ).toBe(false);
  });

  it.each(fixtureNames)(
    "decodes, migrates, hydrates, and reprojects the static %s fixture",
    (name) => {
      const text = fixtureText(name);
      const result = decodeSave(text);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.wireDocument).toEqual(fixtureValue(name));
      expect(result.document.resources.iron).toBe(0);
      expect(result.document.harvestedNodeIds).toEqual([]);
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

  it("rejects an oversized input before invoking JSON.parse", () => {
    const parse = vi.spyOn(JSON, "parse");
    try {
      expect(
        decodeSave("x".repeat(MAX_SAVE_DOCUMENT_CODE_UNITS + 1)),
      ).toMatchObject({
        ok: false,
        failure: "invalid-document",
      });
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
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

  it("migrates a frozen V3 level-5 save into V5 without widening historical validation", () => {
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
        schemaVersion: 5,
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

  it("preserves each frozen-validator legacy skill selection through V5", () => {
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
          schemaVersion: 5,
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
    const classlessSession = new GameSession({
      saved: classlessDecoded.document,
    });
    expect(classlessSession.presentation().ui.pendingClassChoices).toEqual([
      "knight",
      "wizard",
      "archer",
    ]);
    expect(classlessSession.chooseClass("wizard")).toBe(true);
    expect(classlessSession.presentation().ui.classProgression).toMatchObject({
      playerClass: "wizard",
      skillIds: ["wizard-flame-orb"],
    });
    expect(
      classlessSession.presentation().ui.classProgression.legacySkillSelection,
    ).toBeUndefined();
    const classlessRequest = classlessSession.createValidCampfireSaveRequest(2);
    expect(classlessRequest?.document.classProgression).toMatchObject({
      playerClass: "wizard",
      skillIds: ["wizard-flame-orb"],
    });
    expect(
      classlessRequest?.document.classProgression.legacySkillSelection,
    ).toBeUndefined();
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

    const delayedCanonicalV3 = {
      ...toSaveV2Document(base),
      schemaVersion: 3 as const,
      classProgression: {
        experience: 19,
        level: 1 as const,
        playerClass: "knight" as const,
        skillIds: ["knight-iron-guard"],
        allocatedStats: emptyPlayerStatAllocations(),
        weaponRank: 0,
      },
    };
    expect(isSaveDocument(delayedCanonicalV3)).toBe(true);
    const delayedCanonicalDecoded = decodeSave(
      JSON.stringify(delayedCanonicalV3),
    );
    if (!delayedCanonicalDecoded.ok)
      throw new Error("Expected delayed canonical V3 save to load");
    expect(
      delayedCanonicalDecoded.document.classProgression.legacySkillSelection,
    ).toBe(true);
    const delayedCanonicalSession = new GameSession({
      saved: delayedCanonicalDecoded.document,
    });
    (
      delayedCanonicalSession as unknown as {
        grantExperience: (amount: number) => void;
      }
    ).grantExperience(1);
    expect(
      delayedCanonicalSession.presentation().ui.classProgression,
    ).toMatchObject({
      experience: 20,
      level: 2,
      playerClass: "knight",
      skillIds: ["knight-iron-guard"],
    });
    expect(
      delayedCanonicalSession.presentation().ui.classProgression
        .legacySkillSelection,
    ).toBeUndefined();
    const delayedCanonicalRequest =
      delayedCanonicalSession.createValidCampfireSaveRequest(2);
    expect(isSaveDocument(delayedCanonicalRequest?.document)).toBe(true);
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
      document: { schemaVersion: 5 },
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

    const classlessMarkedAllocation = {
      ...validBossRoute,
      classProgression: {
        experience: 300,
        level: 5 as const,
        playerClass: null,
        skillIds: ["wizard-flame-orb"],
        legacySkillSelection: true as const,
        allocatedStats: {
          ...emptyPlayerStatAllocations(),
          strength: 1,
        },
        weaponRank: 0,
      },
    };
    expect(isSaveDocument(classlessMarkedAllocation)).toBe(false);
    expect(decodeSave(JSON.stringify(classlessMarkedAllocation))).toMatchObject(
      {
        ok: false,
        failure: "invalid-document",
      },
    );
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

  it("rejects temporary write/readback failures without changing committed slots", () => {
    for (const fail of ["write", "readback"] as const) {
      const store = new FaultingStore();
      const storage = createBrowserSaveStorage(store);
      const original = validSave();
      expect(storage.commit(original).ok).toBe(true);
      const primary = store.getItem(SAVE_KEYS.primary);
      const backup = store.getItem(SAVE_KEYS.backup);
      if (fail === "write") store.failSetKeys.add(SAVE_KEYS.temporary);
      else store.corruptSetKeys.add(SAVE_KEYS.temporary);

      expect(storage.commit({ ...original, committedAt: 2 }).ok).toBe(false);
      store.failSetKeys.clear();
      store.corruptSetKeys.clear();
      expect(store.getItem(SAVE_KEYS.primary)).toBe(primary);
      expect(store.getItem(SAVE_KEYS.backup)).toBe(backup);
    }
  });

  it("rejects backup write/readback failures before replacing primary", () => {
    for (const fail of ["write", "readback"] as const) {
      const store = new FaultingStore();
      const storage = createBrowserSaveStorage(store);
      const original = validSave();
      expect(storage.commit(original).ok).toBe(true);
      const primary = store.getItem(SAVE_KEYS.primary);
      if (fail === "write") store.failSetKeys.add(SAVE_KEYS.backup);
      else store.corruptSetKeys.add(SAVE_KEYS.backup);

      expect(storage.commit({ ...original, committedAt: 3 }).ok).toBe(false);
      store.failSetKeys.clear();
      store.corruptSetKeys.clear();
      expect(store.getItem(SAVE_KEYS.primary)).toBe(primary);
    }
  });

  it("preserves committed slots when a transaction read fails at each key", () => {
    for (const key of [
      SAVE_KEYS.temporary,
      SAVE_KEYS.primary,
      SAVE_KEYS.backup,
    ]) {
      const store = new FaultingStore();
      const storage = createBrowserSaveStorage(store);
      const original = validSave();
      expect(storage.commit(original).ok).toBe(true);
      const primary = store.getItem(SAVE_KEYS.primary);
      const backup = store.getItem(SAVE_KEYS.backup);
      store.failGetKeys.add(key);

      expect(storage.commit({ ...original, committedAt: 5 })).toMatchObject({
        ok: false,
        message: "Save failed safely: browser storage was unavailable.",
      });
      store.failGetKeys.clear();
      expect(store.getItem(SAVE_KEYS.primary)).toBe(primary);
      expect(store.getItem(SAVE_KEYS.backup)).toBe(backup);
    }
  });

  it("keeps the remembered validated primary isolated from mutations to loaded data", () => {
    const store = new FaultingStore();
    const storage = createBrowserSaveStorage(store);
    const original = validSave();
    expect(storage.commit(original).ok).toBe(true);
    const originalPrimary = store.getItem(SAVE_KEYS.primary);
    const loaded = storage.load();
    if (!loaded.ok) throw new Error("Expected a valid primary save");
    Object.assign(loaded.document.resources, { wood: -1 });

    expect(storage.commit({ ...original, committedAt: 6 }).ok).toBe(true);
    expect(store.getItem(SAVE_KEYS.backup)).toBe(originalPrimary);
  });

  it("recovers the old valid backup when primary readback is corrupted", () => {
    const store = new FaultingStore();
    const storage = createBrowserSaveStorage(store);
    const original = validSave();
    expect(storage.commit(original).ok).toBe(true);
    const originalPrimary = store.getItem(SAVE_KEYS.primary);
    store.corruptSetKeys.add(SAVE_KEYS.primary);

    expect(storage.commit({ ...original, committedAt: 4 }).ok).toBe(false);
    store.corruptSetKeys.clear();
    expect(storage.load()).toMatchObject({ ok: true, source: "backup" });
    expect(store.getItem(SAVE_KEYS.backup)).toBe(originalPrimary);
  });

  it("rejects an over-limit document without writing any storage key", () => {
    const store = new MemoryStore();
    const storage = createBrowserSaveStorage(store);
    const valid = validSave();
    const oversized = {
      ...valid,
      world: { ...valid.world, seed: "s".repeat(MAX_SAVE_DOCUMENT_CODE_UNITS) },
    };

    expect(storage.commit(oversized)).toMatchObject({ ok: false });
    expect(store.writes).toBe(0);
  });

  it("keeps frozen V2 projection exact while browser storage writes V5 progression", () => {
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
    expect(JSON.parse(serialized ?? "")).toMatchObject({ schemaVersion: 5 });
  });

  it("keeps a loaded V2 save byte-stable until an explicit V5 campfire commit persists an allocation", () => {
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
        schemaVersion: 5,
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
      schemaVersion: 5,
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
