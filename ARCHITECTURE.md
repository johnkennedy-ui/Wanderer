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
