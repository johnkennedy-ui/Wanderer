# Procedural Camp MVP

## Status and truth boundary

This repository now has a documentation-only Phase 0 foundation. It does not yet
contain a Unity project, Unity-generated metadata, gameplay code, assets, or a
build artifact.

| Surface | Current status |
| --- | --- |
| Unity 6 project creation, PC build, and PC run | **NOT YET VERIFIED** — no Unity 6 Editor is installed on this host. |
| Shared PC/touch input in a running game | **NOT YET VERIFIED** — no runtime exists. |
| Android ARM64 build and install | **NOT YET VERIFIED** — no Android build has run. |
| Android toolchain suitability | **NOT YET VERIFIED** — local SDK inventory exposes API 35; API 36-or-higher compatibility must be rechecked before release-oriented configuration. |
| Physical Android device and ADB lifecycle evidence | **NOT YET VERIFIED** — no ADB-visible device is connected. |

The intended MVP is a Unity 6, top-down 3D procedural camp and auto-combat game
for PC and Android. These documents define contracts and validation gates; they
are not evidence that the planned runtime exists or works.

## MVP contract

The player explores a deterministic streamed world, automatically attacks only
while meaningfully stationary, gathers resources, grows camps, defeats a boss,
chooses a permanent upgrade, and explicitly saves at a valid campfire.

Priority order:

1. Correct manual-save semantics.
2. Deterministic world reconstruction.
3. Playable auto-combat.
4. Persistent buildings.
5. Boss progression.
6. Android robustness.

## Planned project structure

This is a target layout only. Packages and ProjectSettings must be created by a
verified Unity Editor, never hand-authored while the Editor is unavailable.

~~~
Assets/
  Game/
    Data/          Static definitions and tuning
    Input/         PC/touch adapters and gameplay commands
    Player/        Movement and player projection
    Combat/        Targeting, attacks, skills, modifiers
    World/         Generator, chunks, deltas, streaming
    Buildings/     Placement, settlements, building runtime
    Persistence/   Save document, atomic storage, migrations
    UI/            PC/touch-adaptive presentation
  Tests/
    EditMode/      Determinism, save, placement, progression
    PlayMode/      Runtime integration and input smoke tests
Documentation~/
  IMPLEMENTATION_PLAN.md
Tools~/            Deterministic developer-only helpers, if needed
Packages/          Unity-owned package configuration
ProjectSettings/   Unity-owned project configuration
~~~

Library, Temp, Logs, generated build outputs, and Android signing material are
local-only and must not be committed.

## Phase map

| Phase | Outcome | Gate |
| --- | --- | --- |
| 0 | Editor-created project, PC movement, Android touch movement | Same project runs on PC and a physical Android device. **NOT YET VERIFIED.** |
| 1 | Stationary auto-combat vertical slice | Combat is mechanically coherent on touchscreen. **NOT YET VERIFIED.** |
| 2 | Deterministic streamed world | Same seed/version gives the same structural world. **NOT YET VERIFIED.** |
| 3 | Resources and persistent buildings | Structures survive chunk unload/reload in-session. **NOT YET VERIFIED.** |
| 4 | Manual-only recoverable save system | Deterministic save/load and corruption tests pass. **NOT YET VERIFIED.** |
| 5 | Boss progression | Save/restart reconstructs boss and upgrade state. **NOT YET VERIFIED.** |
| 6 | Android hardening and packaging | Device lifecycle, performance, target-SDK, and AAB evidence pass. **NOT YET VERIFIED.** |

## Phase 0 re-entry

This document does not authorise a host-toolchain, SDK, device, or publishing
change. Once separately authorised:

1. Verify a currently supported Unity 6 Editor with desktop and Android modules.
2. Create the project through that Editor and review generated files.
3. Recheck Android SDK/toolchain compatibility. The brief names API 36 or higher
   for new Play submissions after 2026-08-31 if policy is unchanged.
4. Produce and run a PC development build using the shared input command layer.
5. Produce an ARM64 Android development build, run it on a physical device, and
   record touch plus pause/resume evidence.

Exact build commands and output paths must be added only after an Editor-created
project and build profiles exist.

## Document index

- GAME_DESIGN_MVP.md — playable-MVP scope and rules.
- ARCHITECTURE.md — runtime, data, and authority boundaries.
- SAVE_FORMAT.md — manual commits, versions, backup, and recovery.
- WORLD_GENERATION.md — seed, chunks, deterministic object IDs, and deltas.
- ANDROID_BUILD.md — PC/touch parity and physical-device validation.
- TEST_MATRIX.md — Phase 0/1 and later high-risk test contracts.
- Documentation~/IMPLEMENTATION_PLAN.md — executable phase plan.
