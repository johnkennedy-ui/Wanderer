# Manual save format and browser recovery

`GameSession` can create a `ValidCampfireSaveRequest` only while the player is within 2m of a home, wild, or player-built campfire. The UI's visible **Save at campfire** button is the only caller that asks the browser storage adapter to commit such a request. Movement, combat, drops, buildings, upgrades, death, reload, visibility changes, and shutdown do not persist state.

## Version 2 document

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

The parser requires exactly the five resource keys, known building and upgrade definitions, unique building IDs, unique upgrades, valid finite coordinates, and all schema fields. Invalid input fails closed. Runtime-only enemy cooldowns, Three.js meshes, DOM identity, keyboard/touch state, and framework identifiers are not persisted.

`savePointId` and `savePointPosition` are committed only after browser storage reports success. Death returns to that committed position, applies the named 25% carried-resource loss rule, and makes no write.

## Browser keys and recovery

| Key                       | Use                                        |
| ------------------------- | ------------------------------------------ |
| `wanderer.save.temporary` | write-and-parse staging save               |
| `wanderer.save.primary`   | last committed save                        |
| `wanderer.save.backup`    | previous primary, or first valid save copy |

The adapter writes temporary, parses it again, validates the backup before it touches primary, writes primary, validates primary, then removes temporary. An invalid request makes no storage mutation. On a fresh app load, an absent or corrupt primary falls back to a validated backup. An interrupted staging or primary write leaves the prior valid primary available; the temporary key is never loaded as authority.

This is browser localStorage evidence only. A later Capacitor storage adapter must separately prove equivalent temporary/primary/backup semantics.
