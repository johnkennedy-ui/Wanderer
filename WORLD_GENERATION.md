# Deterministic browser world generation

The deterministic base-world identity is:

```text
WorldSeed + WorldGeneratorVersion + chunk coordinate + named domain
```

`src/domain/world/generators/wandererWebV1.ts` derives independent named domain
seeds for `terrain`, `poi`, `campfire`, `boss`, `encounter`, and `cosmetic`. A
stable text hash, rather than `Math.random()` or a shared PRNG stream, produces
recipe values. Changing call order or requesting another chunk first cannot
perturb a chunk's obstacles, campfire, enemy IDs, boss recipe, or named domain
seeds.

Chunk keys use 16-unit coordinates. The session exposes a 3×3 neighborhood around the player to presentation. The Three.js adapter creates/disposes only that bounded projection; chunk meshes are never persistent identity or world authority.

Procedural objects use deterministic IDs composed from generator version, world seed, chunk coordinate, kind, and index. Player-built buildings use a stable session serial tied to the world seed. Saved data retains deltas such as buildings, boss defeat, player state, upgrades, and the committed save point — not render objects or a serialized generated map.

## Distance danger overlay

Danger is a pure deterministic overlay derived from chunk distance, not a new random or named-generation domain. Home is tier 0; Frontier, Wilds, and Deep Wilds progressively increase enemy health, damage, and common-material drop multipliers. This preserves terrain, POI, IDs, and named-domain stability while making far chunks materially more dangerous.

The home chunk contains a stable home campfire, review scout/elite spawns, and the persistent `boss:ember-wyrm`. Unit tests request chunks in different orders, assert unchanged home identities, and compare deterministic near/far danger profiles.

## Released generator versions

`src/domain/world.ts` is an explicit dispatcher. A save records its generator
identity and is routed to that exact released implementation; an unknown
identity is rejected with a typed unsupported-generator failure. It is never
silently passed to the newest recipe.

Released generator modules are append-only compatibility contracts. Do not edit
`generators/wandererWebV1.ts` to alter procedural output. A terrain recipe,
placement, object count, hash domain, procedural-ID format, or other
deterministic-output change requires a new `wanderer-web-v2` module and a new
dispatcher entry. New worlds may then select that newest supported version,
while saved `wanderer-web-v1` worlds continue to use V1.

Procedural IDs are persisted compatibility data. The checked-in V1 golden
fixtures under `src/tests/fixtures/world/v1/` were captured from released
commit `30fd4845ae716599b214573e5663d8437abc4ed3`; their hashes must not be
regenerated merely to accept a changed recipe. The tests cover home, positive,
negative, and distant coordinates and assert the same identity-preserving
recipe output after every extraction or refactor.
