# Manual save format and browser recovery

`GameSession` creates a `ValidCampfireSaveRequest` only while the player is within 2m of a home, wild, or player-built campfire. The visible **Save at campfire** control is the only caller that asks the browser-storage adapter to commit such a request. Movement, combat, drops, buildings, upgrades, death, reload, visibility changes, and shutdown do not persist state.

## Schema-2 wire contract

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

`src/domain/persistence/saveV2.ts` owns this historical DTO and its literal validation values. It deliberately does not import live `ResourceBag`, player/building runtime state, or current content catalogues. A future runtime resource or upgrade therefore cannot silently redefine schema 2. The checked-in JSON documents in `src/tests/fixtures/saves/v2/` are historical compatibility fixtures: do not regenerate or edit them just because a new implementation would otherwise fail.

The current in-memory hydration model is separate. Loading performs a pure sequence:

```text
raw string → JSON parse → schema identification → frozen V2 decode
→ in-memory migration/normalisation → current-state validation → GameSession hydration
```

No stage writes browser storage. A migrated state is stored only by a later, valid, explicit campfire save.

The decoder distinguishes `absent`, `invalid-json`, `invalid-document`, `unsupported-schema`, and `unsupported-generator`. A present corrupt or unsupported save is not silently treated as a first launch. A valid backup may still recover it, with a recovery warning.

## Generator and persistent-ID compatibility

The current runtime accepts the released `wanderer-web-v1` generator. An unknown generator version is rejected before it hydrates a session; it is never passed to the newest algorithm. Released world-generator implementations and their procedural IDs are compatibility surfaces and are versioned separately in `WORLD_GENERATION.md`.

Persistent resource, building, enemy, boss, and upgrade IDs are opaque serialized values. They are append-only: display labels may change, but existing IDs must not be renamed or removed without an explicit compatibility definition, alias, or migration. Historical schema validators retain their own frozen values rather than importing an evolving active-ID list.

Runtime-only enemy cooldowns, projectiles, floor drops, Three.js meshes, DOM identity, keyboard/touch state, and framework identifiers are never persisted.

## Browser keys and recovery

| Key                       | Use                                        |
| ------------------------- | ------------------------------------------ |
| `wanderer.save.temporary` | write-and-parse staging save               |
| `wanderer.save.primary`   | last committed save                        |
| `wanderer.save.backup`    | previous primary, or first valid save copy |

The keys and their order are compatibility requirements. The adapter writes temporary, parses it again, validates backup before touching primary, writes primary, validates primary, then attempts to remove temporary. An invalid request makes no storage mutation. If primary is already committed but temporary cleanup throws, the commit remains successful and returns a cleanup warning; the temporary key is still never load authority.

On load, primary is checked before backup. A valid primary wins. An absent or invalid primary can recover a valid backup without promoting, deleting, or rewriting any key. A temporary-only value is ignored. If both primary and backup are absent, the application starts a fresh runtime; if a present save cannot be decoded and no valid backup exists, the application surfaces the typed failure and leaves all storage intact.

`savePointId` and `savePointPosition` become the committed death-return point only after browser storage reports a successful explicit commit. Death returns to that committed position, applies the named 25% carried-resource loss rule, and makes no write.

This is browser localStorage evidence only. A later Capacitor storage adapter must separately prove equivalent temporary/primary/backup semantics and the same no-write-on-load behavior.
