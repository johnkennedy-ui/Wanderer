# Procedural Camp MVP Implementation Plan

## Current phase and truth boundary

This is the executable plan for a documentation-only foundation. It does not
mark any Unity runtime, PC build, Android build, or physical-device gate
complete. All Unity/Android/device results remain **NOT YET VERIFIED**.

The only current deliverable is durable planning documentation. Toolchain/SDK
changes, device use, Unity-generated metadata, gameplay code, assets, packaging,
and publishing require separately scoped authority.

## Phase map

| Phase | Smallest coherent cut | Preconditions | Exit evidence / stop gate |
| --- | --- | --- | --- |
| 0 — Foundation | Editor-created project, shared input, PC and physical Android movement | Supported Unity 6/modules, API/toolchain recheck, USB-debuggable device | Same project runs on PC and physical Android. **NOT YET VERIFIED.** |
| 1 — Combat | Camera, movement, stationary auto-attack, targeting, enemies, health/death/drops, two skills | Phase 0 gate | Touchscreen combat coherent. **NOT YET VERIFIED.** |
| 2 — World | Seed/version, chunks, stream/unstream, danger/spawns, campfires, boss location | Phase 1 loop + deterministic vectors | Same seed/version structural replay. **NOT YET VERIFIED.** |
| 3 — Resources/buildings | Inventory, settlement rule, five buildings, three levels, validate/relocate/demolish | Phase 2 chunk ownership | Buildings correct through unload/reload. **NOT YET VERIFIED.** |
| 4 — Save | Versioned snapshot, manual Campfire gate, atomic backup, recovery, deltas/buildings | Phase 2 IDs + Phase 3 state | Deterministic save/load/corruption tests pass. **NOT YET VERIFIED.** |
| 5 — Boss/progression | Boss delta, Boss Core, three-choice reward, permanent modifiers, rollback | Phase 4 commit contract | Kill/save/restart/load reconstructs progression. **NOT YET VERIFIED.** |
| 6 — Android hardening | Touch UX, lifecycle/aspect, pools/profile, ARM64/AAB/release docs | Gameplay/save contracts + authorised device | Device/release evidence passes. **NOT YET VERIFIED.** |

## Phase-local maintainability seams — planned and **NOT YET VERIFIED**

These seams preserve the Phase 0-to-6 order above. They are future acceptance
requirements, not evidence that a Unity module, runtime, or test already
exists. Each seam is introduced only with its matching phase; Phase 0 must not
create a generic framework for later systems.

### Phase 0 — Foundation

Plan one local, explicit gameplay-scene Composition root that performs manual
wiring and deliberate serialized scene/prefab binding only. It explicitly
creates and retains ordinary `GameSession`; `GameSession` is never a
singleton/static/registry/discoverable service. PC and virtual-stick adapters
both emit the same Player-owned normalized `MoveCommand` boundary. Add only a
small architecture guard and adapter-interchange fixture when source exists;
do not introduce a container, automatic registration, global event bus, or
generic Services/Utilities layer.

### Phase 1 — Combat

Introduce only feature-specific `GameSession` command/query/committed-snapshot
ports required by Player and Combat. Construct these dependencies explicitly in
fixtures so motion/targeting can use fakes without a scene, singleton, or
service lookup. Player remains independent of Input adapters and Combat remains
independent of device APIs.

### Phase 2 — World

Introduce pure `WorldIdentity`, generator version, chunk key, procedural ID,
and named domain-seed values with World. Each domain seed derives explicitly
from world seed, generator version, chunk, and named domain, so decoration
changes cannot perturb encounter, boss, or campfire recipes. Do not use global
RNG state, Unity random authority, scene order, or chunk request order.

### Phase 3 — Resources/buildings

Keep stable building/settlement records and validate-then-apply outcomes in
Buildings. Expose only a read-only per-chunk overlay query to World/streaming;
chunk unload may discard projections but not the records. Buildings must not
reach into generator internals, ChunkManager, presentation objects, or save
files.

### Phase 4 — Save

Introduce Persistence through an explicit `ValidCampfireSaveRequest` and
committed immutable snapshot boundary. Keep `SaveDocument` versioning,
validation, atomic recovery, and pure document-to-document migrations within
Persistence, which receives an injected storage adapter. Ordinary mutation,
pause, focus loss, quit, UI lookup, and direct domain filesystem access are not
save authority.

### Phase 5 — Boss/progression

Keep permanent modifier records separate from a combat modifier source/query
port. If temporary/run modifiers are later needed, introduce a distinct source
layer rather than replacing saved permanent progression or campfire commit
semantics.

### Phase 6 — Android hardening

Keep PC/Android differences inside named Input, lifecycle, and presentation
adapters. Core systems continue to receive explicit commands, state ports, and
lifecycle intents only; Android conditionals must not move into Combat, World,
or Persistence.

## Phase 0 execution sequence

1. Prerequisite preflight: after authority, re-verify a supported Unity 6 Editor,
   desktop/Android modules, API/toolchain compatibility, and an ADB-visible
   physical device. Do not install/configure/use them until authorised.
2. Editor-owned creation: make 3D URP/mobile-friendly project through the
   Editor; review generated Packages and ProjectSettings; never synthesize them.
3. Input slice: add only PC and virtual-stick adapters that emit one shared
   movement command; keep gameplay independent of device APIs.
4. PC smoke: build/run desktop development candidate and retain artifact/version
   plus manual behavior evidence.
5. Android smoke: build ARM64, install on physical device, test touch movement
   and pause/resume, and retain safely redacted evidence.
6. Gate: do not start combat until both PC and physical-device tests pass for
   the same project candidate.

## Contract order for later work

### Before Phase 1

Freeze source-neutral Move(Vector2) semantics and an authored motion threshold.
Set GameSession as mutable authority and GameObjects as projections. Test PC and
touch adapter interchangeability at the command boundary.

### Before Phase 2

Define canonical WorldSeed, WorldGeneratorVersion, chunk keys, domain seeds,
procedural object IDs, and deterministic vectors. Prohibit Unity instance IDs,
scene order, global random streams, and chunk request order as authority.

### Before Phase 3

Store building GUID, settlement ID, transform, level, and local state outside
loaded chunks. Use validate-then-apply relocation and explicit settlement
connectivity.

### Before Phase 4

Make SaveService callable only by an explicit valid-campfire action. Save
seed/version plus deltas rather than the generated map; validate candidate
snapshot before backup-preserving atomic replace.

### Before Phase 5

Treat boss kill and upgrade choice as runtime mutations until a campfire save.
Test saved and unsaved outcomes separately.

### Before Phase 6 / release

Profile actual devices before optimization. Recheck live Google Play target-SDK,
policy, signing authority, ARM64, and AAB requirements immediately before
packaging.

## Required validation cadence

For each cut: inspect candidate; make smallest coherent change; run focused
deterministic tests and smoke; inspect results; update contracts; normalize
generated artifacts; freeze clean candidate; then obtain independent review.
Code generation alone is not runtime proof.

Phase 0 first needs the documentation checks in TEST_MATRIX.md, independent
documentation verification, and final review. Future runtime cuts also need
declared automated tests plus PC/physical-device QA; desktop-only evidence cannot
substitute for Android.

## Re-entry conditions and blockers

| Blocker | Classification | Next safe action |
| --- | --- | --- |
| No Unity 6 Editor | External authority | Obtain explicit authority, then inspect exact supported Editor/module version. |
| Local SDK only exposes API 35 | Discoverable/external prerequisite | Recheck API 36-or-higher availability and Unity compatibility before release configuration. |
| No ADB-visible Android device | External authority | Connect authorised USB-debuggable device, then perform bounded validation. |

Until those conditions change, documentation/contract validation is the safe
work. It is not a reason to hand-author Unity files or claim PC, Android, or
device success.
