# Manual save format and browser recovery

`GameSession` creates a `ValidCampfireSaveRequest` only while the player is within 2m of a home, wild, or player-built campfire. The visible **Save at campfire** control is the only caller that asks the browser-storage adapter to commit such a request. Movement, combat, drops, buildings, upgrades, death, reload, visibility changes, and shutdown do not persist state.

## Frozen schema-2/schema-3/schema-4 formats and active schema-5

Released documents remain schema version `2`:

```ts
{
  schemaVersion: 2,
  world: { seed, generatorVersion },
  player: { position, hp, maxHp },
  resources: { wood, stone, scrap, essence, bossCore },
  buildings: [{ id, kind, position, level }],
  defeatedBossIds: string[],
  upgrades: string[],
  nextBuildingSerial: number,
  committedAt: number,
  savePointId: string,
  savePointPosition: { x, y }
}
```

`src/domain/persistence/saveV2.ts` owns this frozen historical DTO and its
literal validation values. It deliberately does not import live `ResourceBag`,
player/building runtime state, or current content catalogues. A future runtime
resource or upgrade therefore cannot silently redefine schema 2. The checked-in
JSON documents in `src/tests/fixtures/saves/v2/` are historical compatibility
fixtures: do not regenerate or edit them just because a new implementation
would otherwise fail.

Schema version `3` is a frozen historical storage format. It retains every V2
field and adds a normalized progression object capped at the released L5
catalogue. Schema version `4` is also frozen historical storage. It
retains every V3 field and uses the level-25 progression catalogue. Schema
version `5` is active: it retains the V4 fields, adds a distinct Iron
resource, and records depleted deterministic resource nodes:

```ts
{
  schemaVersion: 5,
  // V2/V3/V4 fields above, including resources.iron,
  classProgression: {
    experience, level, playerClass, skillIds, weaponRank,
    allocatedStats: { strength, agility, vitality, magic, dexterity, luck }
  },
  harvestedNodeIds: string[]
}
```

The active resource bag has exactly wood, stone, scrap, essence, iron, and
bossCore. Iron is separate from the historical Metal / Scrap balance. Every
current balance must be a non-negative JavaScript safe integer; Number.MAX_SAFE_INTEGER
itself is valid. Frozen V2/V3/V4 wire validators retain their released shape and
integer rules, but migration admits a document to the current runtime only when
all six balances meet this exactness invariant. Accordingly, safe-range
historical saves remain loadable, while legacy values above the safe-integer
range are rejected without clamping or writing storage. This is a numeric
representation boundary, not a gameplay or Storage cap. Any transaction that
would make even one balance unsafe rejects atomically, without partially
applying its reward, refund, or harvested-node depletion.

Each allocation is a non-negative integer, all six keys are required, and the
total cannot exceed `level * 3`. Defense and magic defense are derived from
Vitality and Magic and are never persisted as allocations.

`src/domain/persistence/currentSave.ts` owns the separate current in-memory
hydration representation and the explicit V2 serialization projection.
`migrateSaveV2`, `migrateSaveV3`, and `migrateSaveV4` convert validated
historical DTOs to V5 in memory; `GameSession` then clones them with
`hydrateSessionState`. Current V5 documents are copied on load. Active copy-out
is V5; `toSaveV2Document` remains an exact historical projection for fixtures
and compatibility checks. Runtime types may evolve around this boundary
without silently changing released V2/V3/V4 validators or JSON field names.

V5 retains V4 class-progression rules: a contiguous class/tier skill prefix and
a Boss/AoE route derived from the tier-5 skill rather than persisted
separately. If a frozen V2/V3 validator had accepted a non-canonical but known
legacy skill selection, pure migration retains those exact IDs with the narrow
`legacySkillSelection: true` compatibility marker so a later explicit save
does not discard them. New progression never creates that marker. A classless
marked selection may still choose a class, and any marked selection sheds the
marker when its retained IDs become a current class/tier prefix at class choice
or an XP-level boundary; otherwise it receives no new route-continuation
choices. V4 and V5 accept only their listed progression fields; a persisted
`route` field is rejected because the current route remains derived from the
tier-5 skill.

The current in-memory hydration model is separate. Loading performs a pure sequence:

```text
raw string → JSON parse → schema identification → frozen V2/V3/V4 decode or V5 decode
→ pure V2→V5/V3→V5/V4→V5 migration or V5 copy → current-state validation
→ GameSession hydration
```

No decode, migration, or hydration stage writes browser storage. A migrated
state is stored only by a later, valid, explicit campfire save. Historical
fixtures and existing V2/V3/V4 documents must remain loadable at their original
schema version; loading must never rewrite them. V2/V3/V4 migrations start with
Iron 0 and an empty harvested-node list. A V2 Knight save already contains the
level-one Vitality health grant, so migration adds only missing level-two and
later base-Vitality growth while preserving upgrade and class-skill health.

The decoder distinguishes `absent`, `invalid-json`, `invalid-document`, `unsupported-schema`, and `unsupported-generator`. A present corrupt or unsupported save is not silently treated as a first launch. A valid backup may still recover it, with a recovery warning.

## Generator and persistent-ID compatibility

The current runtime accepts the released `wanderer-web-v1`, `wanderer-web-v2`, and `wanderer-web-v3` generators. An unknown generator version is rejected before it hydrates a session; it is never passed to the newest algorithm. Released world-generator implementations and their procedural IDs are compatibility surfaces and are versioned separately in `WORLD_GENERATION.md`.

Persistent resource, building, enemy, boss, and upgrade IDs are opaque serialized values. They are append-only: display labels may change, but existing IDs must not be renamed or removed without an explicit compatibility definition, alias, or migration. Historical schema validators retain their own frozen values rather than importing an evolving active-ID list.

## Deterministic resource harvesting

Harvesting adds a persisted delta, not a generator change. Deterministic tree and rock obstacles keep their existing world-bound IDs and unchanged base recipes. The session derives one effective obstacle view for rendering, collision, placement, and picking; harvested IDs are not written into the generator or shared cache. A tree yields 24 Wood; a rock yields 20 Stone and 12 Iron without changing Scrap. The V5 save stores the Iron balance and a sorted, world-bound list of at most 4,096 dense, unique depleted-node IDs, each at most 1,024 UTF-16 code units. The sum of ID-string lengths is at most 1,048,576 UTF-16 code units. This ID budget excludes JSON overhead and other fields; the complete serialized save is separately capped at `MAX_SAVE_DOCUMENT_CODE_UNITS` (2,097,152 JavaScript UTF-16 code units), checked before `JSON.parse` and before browser storage writes. If a valid maximum-size V2/V3/V4 document migrates in memory to a V5 projection above this cap, an explicit save rejects before mutating any storage slot; the original legacy primary and backup remain available and loadable. Loading never rewrites the historical record, and no field is truncated to force a fit. Every ID must use the canonical tuple spelling and match an actual reward-bearing obstacle after filtering in the exact saved generator version (V1/V2 rocks; V3 trees/rocks); version-specific safe chunk bounds protect generator arithmetic. Decoder validation groups IDs by chunk, generates each referenced chunk once before depletion, and discards each generated recipe after membership checking. V2/V3/V4 migrations still start with Iron zero and an empty list without regenerating or rewriting historical saves. Both runtime rewards and depletion remain unsaved until the existing explicit valid campfire save commits them; an unsaved reload restores the previous balance and deterministic nodes.

Player-built building IDs keep their existing
`building:<stable-world-seed-hash>:<session-serial>` strategy. The stable hash
is derived from the world seed and the serial is the persisted
`nextBuildingSerial` sequence; do not replace these compatible opaque IDs with
GUIDs. A new building kind may be appended to the active catalogue only with
the same explicit compatibility discipline.

`WoodWall`, `StoneWall`, `ArcherTower`, `SwordTower` and `MageTower` are
append-only current-schema building kinds, using the existing
`{ id, kind, position, level }` record with level 1. V2/V3 validators keep
their frozen historical building-kind lists and reject those newer IDs; V4
and V5 preserve the current list. The V2 copy-out boundary explicitly rejects
unsupported current building content. Current save copy-out retains only
declared fields. Legacy fractional positions load and re-save unchanged:
snapping applies only to new placement or explicit relocation.

Runtime-only enemy and tower cooldowns, projectiles, tower attack cues, floor drops, Three.js meshes, DOM identity, keyboard/touch state, and framework identifiers are never persisted.

## RO-inspired stat rules

The stat model is **game-adapted and Ragnarok Online-inspired**, not exact
parity with a particular RO release. Each earned level repeats its class's
level-one base stats and grants three persistent allocation points. Knight
damage uses Strength, Archer damage uses Dexterity, Wizard damage uses Magic,
and Vitality gives health plus `floor(Vitality / 2)` physical defense. Magic
defense is `floor(Magic / 2)`.

Agility increases movement speed, attack speed, and a bounded deterministic
dodge chance. Luck gives bounded deterministic physical critical chance;
Wizard magic does not critically strike. Rolls are hashes of the world seed
and stable event identities, never `Math.random`: a Knight swing shares one
critical outcome across its arc, Archer shots roll separately, and each enemy
has a runtime-only per-enemy attack-attempt ordinal.

## Browser keys and recovery

| Key                       | Use                                        |
| ------------------------- | ------------------------------------------ |
| `wanderer.save.temporary` | write-and-readback staging save            |
| `wanderer.save.primary`   | last committed save                        |
| `wanderer.save.backup`    | previous primary, or first valid save copy |

The keys and their order are compatibility requirements. The adapter validates the incoming document, writes the temporary slot and checks exact string readback, validates the existing primary before using it as backup, writes and verifies backup, then writes and verifies primary before attempting to remove temporary. Exact readback checks reject altered values without repeating generated-node membership validation for copies derived from already-validated documents. An invalid request makes no storage mutation. If primary is already committed but temporary cleanup throws, the commit remains successful and returns a cleanup warning; the temporary key is still never load authority.

On load, primary is checked before backup. A valid primary wins. An absent or invalid primary can recover a valid backup without promoting, deleting, or rewriting any key. A temporary-only value is ignored. If both primary and backup are absent, the application starts a fresh runtime; if a present save cannot be decoded and no valid backup exists, the application surfaces the typed failure and leaves all storage intact.

`savePointId` and `savePointPosition` become the committed death-return point only after browser storage reports a successful explicit commit. Death returns to that committed position, applies the named 25% carried-resource loss rule, and makes no write.

This is browser localStorage evidence only. A later Capacitor storage adapter
must separately prove equivalent temporary/primary/backup semantics and the
same no-write-on-load behaviour. Changing an adapter does not authorize a key
rename, a startup migration write, or a weaker corrupt-save recovery path.
