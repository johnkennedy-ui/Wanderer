# Deterministic browser world generation

The deterministic base-world identity is:

```text
WorldSeed + WorldGeneratorVersion + chunk coordinate + named domain
```

`src/domain/world.ts` derives independent named domain seeds for `terrain`,
`poi`, `campfire`, `boss`, `encounter`, and `cosmetic`. A stable text hash,
rather than `Math.random()` or a shared PRNG stream, produces recipe values.
Changing call order or requesting another chunk first cannot perturb a chunk's
obstacles, campfire, enemy IDs, or boss recipe.

Chunk keys use 16-unit coordinates. The session exposes a 3×3 neighborhood
around the player to presentation. The Three.js adapter creates/disposes only
that bounded projection; chunk meshes are never persistent identity or world
authority.

Procedural objects use deterministic IDs composed from generator version, world
seed, chunk coordinate, kind, and index. Player-built buildings use a stable
session serial tied to the world seed. Saved data retains deltas such as
buildings, boss defeat, player state, and upgrades—not render objects or a
serialized generated map.

The home chunk contains a stable home campfire, review scout/elite spawns, and
the persistent `boss:ember-wyrm`. Unit tests request chunks in different orders
and assert the same recipes and named domain seeds.
