# Manual save format and browser recovery

`GameSession` can create a `ValidCampfireSaveRequest` only while the player is
within 2m of a home, wild, or player-built campfire. The UI's visible **Save at
campfire** button is the only caller that asks the browser storage adapter to
commit such a request. Movement, combat, drops, buildings, upgrades, reload,
visibility changes, and shutdown do not persist state.

## Version 1 document

```ts
{
  schemaVersion: 1,
  world: { seed, generatorVersion },
  player: { position, hp, maxHp },
  resources: { wood, ore, food, bossCore },
  buildings: [{ id, kind, position, level }],
  defeatedBossIds: string[],
  upgrades: string[],
  nextBuildingSerial: number,
  committedAt: number,
  savePointId: string
}
```

The domain validates all schema fields before the adapter receives the save.
Runtime-only enemy cooldowns, Three.js meshes, DOM identity, keyboard/touch
state, and framework identifiers are not persisted.

## Browser keys and recovery

| Key                       | Use                                        |
| ------------------------- | ------------------------------------------ |
| `wanderer.save.temporary` | write-and-parse staging save               |
| `wanderer.save.primary`   | last committed save                        |
| `wanderer.save.backup`    | previous primary, or first valid save copy |

The adapter writes temporary, parses it again, preserves a validated backup,
writes primary, validates primary, then removes temporary. On a fresh app load,
it accepts validated primary first; an absent/corrupt primary falls back to a
validated backup. Invalid saves fail closed. Reloading reconstructs only the
latest committed save, so later unsaved mutations disappear.

This is browser localStorage evidence only. A later Capacitor storage adapter
must separately prove equivalent temporary/primary/backup semantics.
