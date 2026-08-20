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
