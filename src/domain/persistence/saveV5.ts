import {
  harvestRewardsForObstacle,
  MAX_HARVESTED_NODE_ID_CHARS,
  MAX_HARVESTED_NODE_ID_LENGTH,
  MAX_HARVESTED_NODE_IDS,
} from "../resourceHarvesting";
import {
  CHUNK_SIZE,
  generateChunk,
  isSupportedWorldGeneratorVersion,
  WANDERER_WEB_V3,
} from "../world";
import type { Vector2, WorldIdentity } from "../types";
import { saveV2ResourceKeys } from "./saveV2";
import type { SaveV4Document } from "./saveV4";
import { isSaveV4Document } from "./saveV4";

/** Active schema extends V4 with a distinct Iron balance and depleted-node delta. */
export const SAVE_V5_SCHEMA_VERSION = 5 as const;
export const saveV5ResourceKeys = Object.freeze([
  ...saveV2ResourceKeys,
  "iron",
] as const);

export type SaveV5ResourceKey = (typeof saveV5ResourceKeys)[number];
export type SaveV5ResourceBag = Readonly<Record<SaveV5ResourceKey, number>>;

export interface SaveV5Document extends Omit<
  SaveV4Document,
  "schemaVersion" | "resources"
> {
  readonly schemaVersion: typeof SAVE_V5_SCHEMA_VERSION;
  readonly resources: SaveV5ResourceBag;
  readonly harvestedNodeIds: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return (
    actual.length === sorted.length &&
    actual.every((key, i) => key === sorted[i])
  );
};

const topLevelKeys = Object.freeze([
  "schemaVersion",
  "world",
  "player",
  "resources",
  "buildings",
  "defeatedBossIds",
  "upgrades",
  "nextBuildingSerial",
  "committedAt",
  "savePointId",
  "savePointPosition",
  "classProgression",
  "harvestedNodeIds",
] as const);

const isNonNegativeSafeInteger = (value: unknown): boolean =>
  Number.isSafeInteger(value) && (value as number) >= 0;

// Historical V2-V4 wire validators retain their released integer semantics.
// Every balance entering current V5 must be exactly representable by JavaScript.
const isResourceBag = (value: unknown): value is SaveV5ResourceBag =>
  isRecord(value) &&
  hasExactKeys(value, saveV5ResourceKeys) &&
  saveV5ResourceKeys.every((key) => isNonNegativeSafeInteger(value[key]));

type ParsedHarvestedNodeId = Readonly<{
  id: string;
  kind: "rock" | "tree";
  coordinate: Vector2;
}>;

const parseHarvestedNodeIdFor = (
  value: string,
  world: Record<string, unknown>,
): ParsedHarvestedNodeId | null => {
  const rockPrefix = "rock:" + world.generatorVersion + ":" + world.seed + ":";
  const treePrefix = "tree:" + world.generatorVersion + ":" + world.seed + ":";
  const kind = value.startsWith(rockPrefix)
    ? "rock"
    : (world.generatorVersion === "wanderer-web-v3" ||
          world.generatorVersion === "wanderer-web-v4") &&
        value.startsWith(treePrefix)
      ? "tree"
      : null;
  if (kind === null) return null;
  const prefix = kind === "rock" ? rockPrefix : treePrefix;
  // Generated IDs use canonical Number stringification: no signs on positive
  // values, leading zeroes, negative zero, decimals, or exponent notation.
  const tuple = /^((?:0|-?[1-9]\d*)):((?:0|-?[1-9]\d*)):((?:0|[1-9]\d*))$/.exec(
    value.slice(prefix.length),
  );
  if (tuple === null) return null;
  const x = Number(tuple[1]);
  const y = Number(tuple[2]);
  const index = Number(tuple[3]);
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(index) ||
    String(x) !== tuple[1] ||
    String(y) !== tuple[2] ||
    String(index) !== tuple[3] ||
    (kind === "tree" ? index > 2 : index > 3)
  )
    return null;
  return { id: value, kind, coordinate: { x, y } };
};

const hasDenseEntries = (value: readonly unknown[]): boolean => {
  for (let index = 0; index < value.length; index += 1)
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  return true;
};

const isSafeChunkAxis = (value: number, generatorVersion: string): boolean => {
  // V3 resolves a two-chunk neighborhood. V1/V2 only generate the requested
  // chunk, so do not impose V3's neighbor bound on historical save identities.
  const neighborRadius = generatorVersion === WANDERER_WEB_V3 ? 2 : 0;
  for (let offset = -neighborRadius; offset <= neighborRadius; offset += 1) {
    const neighbor = value + offset;
    if (!Number.isSafeInteger(neighbor)) return false;
    const origin = neighbor * CHUNK_SIZE;
    if (
      !Number.isSafeInteger(origin) ||
      !Number.isSafeInteger((Math.abs(origin) + 14) * 100)
    )
      return false;
  }
  return true;
};

const parseHarvestedNodeList = (
  value: unknown,
  world: unknown,
): readonly ParsedHarvestedNodeId[] | null => {
  if (
    !Array.isArray(value) ||
    value.length > MAX_HARVESTED_NODE_IDS ||
    !hasDenseEntries(value) ||
    !isRecord(world) ||
    typeof world.generatorVersion !== "string" ||
    typeof world.seed !== "string"
  )
    return null;
  const parsedIds: ParsedHarvestedNodeId[] = [];
  const uniqueIds = new Set<string>();
  let totalCharacters = 0;
  for (let index = 0; index < value.length; index += 1) {
    const id: unknown = value[index];
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > MAX_HARVESTED_NODE_ID_LENGTH
    )
      return null;
    totalCharacters += id.length;
    if (totalCharacters > MAX_HARVESTED_NODE_ID_CHARS) return null;
    if (uniqueIds.has(id)) return null;
    uniqueIds.add(id);
    const parsed = parseHarvestedNodeIdFor(id, world);
    if (
      parsed === null ||
      !isSafeChunkAxis(parsed.coordinate.x, world.generatorVersion) ||
      !isSafeChunkAxis(parsed.coordinate.y, world.generatorVersion)
    )
      return null;
    parsedIds.push(parsed);
  }
  return parsedIds;
};

/** Proves every ID against its exact released generator and harvest predicate. */
export const hasGeneratedHarvestedNodeMembership = (
  value: unknown,
  world: unknown,
): boolean => {
  const parsedIds = parseHarvestedNodeList(value, world);
  if (parsedIds === null) return false;
  if (
    !isRecord(world) ||
    typeof world.seed !== "string" ||
    typeof world.generatorVersion !== "string" ||
    !isSupportedWorldGeneratorVersion(world.generatorVersion)
  )
    return false;
  if (parsedIds.length === 0) return true;

  // Validate the complete list cheaply first, then generate each referenced
  // chunk once before depletion and discard its recipe before moving on.
  const chunks = new Map<string, { coordinate: Vector2; ids: string[] }>();
  for (const parsed of parsedIds) {
    const key = `${parsed.coordinate.x}:${parsed.coordinate.y}`;
    const group = chunks.get(key);
    if (group === undefined)
      chunks.set(key, { coordinate: parsed.coordinate, ids: [parsed.id] });
    else group.ids.push(parsed.id);
  }
  for (const { coordinate, ids: chunkIds } of chunks.values()) {
    let generated;
    try {
      generated = generateChunk(world as unknown as WorldIdentity, coordinate);
    } catch {
      return false;
    }
    const generatedHarvestableIds = new Set(
      generated.obstacles
        .filter((obstacle) => harvestRewardsForObstacle(obstacle) !== null)
        .map((obstacle) => obstacle.id),
    );
    if (!chunkIds.every((id) => generatedHarvestableIds.has(id))) return false;
  }
  return true;
};

/** Cheap V5 shape and bounded syntax validation without generator execution. */
export const isSaveV5DocumentStructure = (
  value: unknown,
): value is SaveV5Document => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== SAVE_V5_SCHEMA_VERSION ||
    !hasExactKeys(value, topLevelKeys) ||
    !isResourceBag(value.resources)
  )
    return false;

  const { iron: _iron, ...legacyResources } = value.resources;
  const { harvestedNodeIds: _harvestedNodeIds, ...legacyFields } = value;
  const v4Projection = {
    ...legacyFields,
    schemaVersion: 4,
    resources: legacyResources,
  };
  return (
    isSaveV4Document(v4Projection) &&
    parseHarvestedNodeList(value.harvestedNodeIds, value.world) !== null
  );
};

/** Preserves V4's strict contract and requires generated-node membership. */
export const isSaveV5Document = (value: unknown): value is SaveV5Document =>
  isSaveV5DocumentStructure(value) &&
  hasGeneratedHarvestedNodeMembership(value.harvestedNodeIds, value.world);
