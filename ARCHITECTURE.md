# Architecture

## Status and architectural rule

This document defines a planned architecture, not an implemented Unity runtime.
Unity build/run, Android build/run, and physical-device behavior are **NOT YET
VERIFIED**.

~~~
Authored definitions != runtime session state != persisted save state != GameObjects
Procedural base world != persistent player/world deltas
Ordinary mutation != explicit save commit
Input source != gameplay command
~~~

## Runtime and data boundaries

| Layer | Planned responsibility | Persistence authority |
| --- | --- | --- |
| Authored definitions | Stable IDs/tuning for items, buildings, enemies, bosses, skills, loot, generator parameters | Immutable references only |
| Deterministic base world | Seed/version-driven terrain, POIs, wild campfires, bosses, spawn recipes | Reconstructed, not fully serialized |
| Runtime session | Current player, inventory, buildings, deltas, combat, pending unsaved changes | In-memory authority |
| Save document | Versioned committed snapshot | Authority after successful atomic commit |
| Presentation | Chunk GameObjects, pools, VFX, UI, camera | Never authoritative |

ScriptableObjects or equivalent may contain immutable definitions. They must not
hold mutable save state. Unity instance IDs must never be persisted.

## Planned project responsibilities

| Area | Main responsibility |
| --- | --- |
| Assets/Game/Data | Definition IDs, tuning, validation |
| Assets/Game/Input | PC/touch adapters that emit source-neutral commands |
| Assets/Game/Player | Movement and player-state projection |
| Assets/Game/Combat | Attack gate, targeting, skills, modifiers, health, drops |
| Assets/Game/World | Generator, chunks, streaming, spawn recipes, persistent lookup |
| Assets/Game/Buildings | Placement, relocation, demolition, settlement reach |
| Assets/Game/Persistence | Save snapshot, storage, migration, recovery |
| Assets/Game/UI | Campfire save action and mobile-safe presentation |
| Assets/Tests | EditMode contracts and PlayMode integration |

Those paths are planned and do not exist in this documentation-only candidate.

## Planned dependency direction and module ownership

The following direction and ownership rules are planned requirements only;
they are **NOT YET VERIFIED** in a Unity runtime. They do not create the listed
paths or authorize an implementation outside its matching phase.

~~~
Gameplay-scene Composition -> explicit module construction and named Unity adapters
Named Input/UI/Persistence adapters -> feature-owned command/query/snapshot ports
Feature modules -> immutable Data values and declared narrow ports only
World/Buildings records -> disposable chunk/UI/GameObject projections
~~~

| Planned area | Owns | Allowed dependency direction | Must not own or obtain |
| --- | --- | --- | --- |
| `Assets/Game/Composition/` | The one local gameplay-scene composition root and deliberate serialized scene/prefab bindings | Public construction/port surfaces and named Unity adapters | Gameplay policy, mutable authority, save IO, generator rules, or a reusable service container |
| `Assets/Game/Session/` | Explicitly constructed active-world aggregate, narrow state/query/command ports, committed snapshot boundary | Stable value records only; retained by Composition | A singleton/static/registry, Unity GameObjects, input adapters, storage implementation, or cross-feature policy |
| `Assets/Game/Data/` | Immutable definition IDs, tuning, and validation | Value contracts and authored-asset boundary only | Per-world mutable state, save slots, Unity instance IDs, runtime services, or scene objects |
| `Assets/Game/Input/` and `Assets/Game/UI/` | Named platform adapters, presentation, and explicit user intents | The relevant feature-owned input/query/command port | Device-specific gameplay policy, authoritative state, hidden save calls, or direct peer discovery |
| `Assets/Game/Player/` and `Assets/Game/Combat/` | Movement/command application and combat/targeting/skills/modifiers | Narrow Session ports, immutable Data, and explicit feature ports | Input device APIs, global target registries, save writes, or UI controls |
| `Assets/Game/World/` and `Assets/Game/Buildings/` | World identity/base recipes/chunk lifecycle and building/settlement records plus overlay query | Immutable Data, stable value records, narrow Session/overlay ports | Global RNG state, authoritative GameObjects, generator internals from Buildings, or direct save-file access |
| `Assets/Game/Persistence/` | Versioned documents, validation, atomic recovery, and pure migrations | Explicit valid-campfire request, committed Session snapshot, injected storage adapter | Live GameObjects, direct UI/campfire lookup, ordinary runtime mutation, or feature-owned mutable state |
| `Assets/Tests/` | Planned EditMode contracts and PlayMode integration fixtures | Public module contracts plus fakes/adapters | Production registration, production composition shortcuts, credentials, or production save locations |

Composition is the only planned production location allowed to know all module
concretes. It wires direct declared dependencies manually and locally; no other
module may acquire a concrete peer by static accessor, registry, search, or
automatic registration. This is deliberately not an IoC/DI framework, generic
event bus, reflection scan, or shared Services/Utilities module.

`GameSession` remains an ordinary, explicitly held object: Composition creates
it and passes each consumer only the required narrow port. It is never a
`MonoBehaviour` singleton, a static `Current`/`Instance`/`Default`, a service
locator entry, or a scene-discovered authority.

## Planned allowed and forbidden boundaries

These boundary rules are planned and **NOT YET VERIFIED**. They are intended to
keep future platform and persistence details out of domain authority.

| Boundary | Planned allowed boundary | Planned forbidden bypass |
| --- | --- | --- |
| Scene/composition | Composition-owned deliberate serialized references | `GameObject.Find*`, `FindAnyObjectByType`, `FindFirstObjectByType`, `Resources.FindObjectsOfTypeAll`, or cross-module `GetComponent` discovery for services/state |
| Global authority | Compile-time constants and pure immutable static value helpers | Mutable static session/service/cache state; `Instance`/`Current`/`Default`; service locator, reachable container, automatic registration, global event bus, mutable static dictionary, or `DontDestroyOnLoad` session manager |
| Input/UI platform APIs | Explicit named Input/UI adapters wired by Composition | Domain systems calling `UnityEngine.Input` or UI APIs directly, or UI owning authoritative state/save writes |
| Persistence | Explicit valid-campfire request plus committed immutable snapshot through injected storage adapter | Direct filesystem/path access from domain systems; ScriptableObjects/assets holding mutable save/session state or runtime service/GameObject references |
| Deterministic World randomness | Explicit seeds derived from world seed, generator version, chunk, and named domain | `UnityEngine.Random`, `Random.InitState`, one shared PRNG stream, scene order, or chunk request order as generation authority |

Presentation remains a projection boundary: chunk GameObjects, pools, VFX, UI,
and camera may be rebuilt or discarded without changing authoritative records.
No planned future feature may use Unity instance IDs or `GetInstanceID()` as a
persistent identity.

## Planned service contracts

| Service | Contract |
| --- | --- |
| GameSession | Owns active mutable-world state; exposes snapshot only after a validated manual-save request. |
| InputService | Converts WASD or virtual-stick input into normalized gameplay/UI commands; gameplay reads no device API directly. |
| PlayerController | Applies commands and exposes meaningful-motion state to combat. |
| CombatController / TargetingSystem | Stops attack on motion, chooses stable valid targets while stationary, resolves damage/death/drops. |
| StatModifierSystem / SkillSystem | Applies data-driven permanent modifiers and leaves room for future temporary modifiers. |
| ResourceInventory / LootSystem | Performs data-driven resource mutations and enforces non-negative rules. |
| BuildingSystem / SettlementSystem | Validates placement, preserves state on relocation, maintains settlement-anchor invariants. |
| WorldGenerator / ChunkManager | Regenerates base recipes and streams projections using deltas/buildings. |
| SpawnDirector / BossStateSystem | Handles transient spawns and persisted boss state. |
| WorldDeltaStore | Stores mutable base-world changes keyed by stable procedural ID. |
| SaveService | Sole committed-write path; rejects every caller except explicit valid-campfire save. |

## Command and state flow

~~~
Keyboard / virtual stick -> InputService -> gameplay command -> PlayerController / UI
                                                     |
Authored definitions -> runtime systems -> GameSession
WorldSeed + generator version -> WorldGenerator -> base chunk recipe
WorldDeltaStore + BuildingStore --------------------> chunk projection
Valid campfire + explicit action -> SaveService -> atomic committed snapshot
~~~

Save UI appears only at a valid home, player-built, or wild campfire. It reports
success only after SaveService completes an atomic commit.

## Chunk lifecycle

On chunk load: derive canonical identity/domain seeds; generate base recipe;
apply persistent deltas; project buildings belonging to the chunk; create
transient spawn populations. On unload: pool/destroy presentation only; retain
session authority; never commit a save.

## Invariants

- Only explicit valid-campfire interaction can write a committed save.
- A known-good primary remains recoverable after interrupted write/corrupt file.
- Same seed/version/coordinate/domain/canonical ordering gives the same base
  structure regardless of chunk load order.
- Player buildings use stable GUIDs; persistent procedural objects use
  deterministic IDs; neither uses Unity instance IDs.
- Normal buildings cannot bootstrap an isolated settlement, while a valid
  Campfire can.
- Loaded GameObjects are disposable projections, never persistence authority.

## Dependency order

Phase 0 verifies an Editor-created PC/Android input foundation before Phase 1.
Deterministic identity precedes persistence-sensitive systems; manual save safety
precedes boss progression. The phase plan is in Documentation~/IMPLEMENTATION_PLAN.md.
