# Browser architecture

```text
src/main.ts
  -> createGameApplication (explicit composition root)
       -> GameSession (pure mutable runtime authority)
       -> immutable authored definitions
       -> input, lifecycle, storage, Three.js, and DOM adapters
```

`src/main.ts` only invokes `createGameApplication`. The composition root creates
and retains one ordinary `GameSession`; there is no singleton, static current
session, service locator, registry, global event bus, DOM lookup, or scene
lookup for gameplay authority.

| Area                              | Authority                                             | Cannot own                                              |
| --------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| `src/domain/`                     | deterministic world, combat, buildings, save validity | DOM, localStorage, Three.js, Capacitor, `Math.random()` |
| `src/data/`                       | immutable IDs, costs, tuning, effects                 | runtime/session state                                   |
| `src/platform/input/`             | source-to-`MoveCommand` translation                   | movement/combat policy                                  |
| `src/platform/storage/`           | browser key writes and recovery                       | whether a save is permitted                             |
| `src/platform/render/`, `src/ui/` | disposable projection and explicit intents            | world/player/building/persistence authority             |
| `src/app/`                        | local wiring and lifecycle                            | generic service container or hidden authority           |

The app passes commands to `GameSession` and consumes immutable-shaped snapshots.
Three meshes, camera, DOM rows, and virtual-stick visuals may be discarded and
rebuilt without changing gameplay state. The renderer only receives a 3×3 chunk
snapshot neighborhood; it does not stream or persist world authority itself.

`npm run check:architecture` scans the pure domain for browser/framework/random
authority and confirms that the Vite entrypoint delegates construction only to
the explicit composition root.
