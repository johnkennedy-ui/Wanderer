# Test Matrix

## Status convention

Planned defines a required future test. PASS requires evidence tied to a specific
candidate. There are no Unity, Android, or physical-device test results in this
documentation-only foundation: all such results are **NOT YET VERIFIED**.

## Phase 0 documentation checks

| ID | Medium | Required assertion | Current status |
| --- | --- | --- | --- |
| P0-DOC-001 | Repository audit | All eight requested documents exist at contract paths. | Planned for this candidate audit |
| P0-DOC-002 | Heading/content audit | Documents cover phases, structure, boundaries, manual save, atomic backup, deterministic IDs/chunks, Android validation, and Phase 0/1 tests. | Planned for this candidate audit |
| P0-DOC-003 | Git | git diff --check base...HEAD has no whitespace errors. | Planned for this candidate audit |
| P0-DOC-004 | Git | Committed worktree is clean; diff is restricted to leased documentation paths. | Planned for this candidate audit |

## Phase 0 planned architecture checks

These checks apply only after the matching Editor-created source exists. They
are planned assertions, not current Unity/runtime/device evidence.

| ID | Medium | Scenario and acceptance | Current status |
| --- | --- | --- | --- |
| P0-ARCH-001 | EditMode or deterministic architecture lint | Outside planned `Assets/Game/Composition/` and test/editor-only code, reject singleton/static-service accessors, mutable static state, service locators/containers, automatic registration, global event buses, scene-search service discovery, and mutable static dictionaries. Any static helper must be explicitly allowlisted as immutable and pure. | Planned; **NOT YET VERIFIED** |
| P0-ARCH-002 | EditMode adapter-interchange fixture | PC and virtual-stick adapters submit identical normalized `MoveCommand` values to the same Player-owned input port; Player contains no direct device API reference. | Planned; **NOT YET VERIFIED** |
| P0-ARCH-003 | EditMode construction fixture | One local Composition root explicitly constructs `GameSession` and hands only narrow ports to consumers; no test needs a singleton, registry, service lookup, or scene discovery. | Planned; **NOT YET VERIFIED** |

## Phase 0 runtime and device gates

| ID | Medium | Scenario and acceptance | Current status |
| --- | --- | --- | --- |
| P0-PC-001 | Unity desktop build | Editor-created project opens and creates documented PC development build. | **NOT YET VERIFIED** |
| P0-PC-002 | PC runnable smoke | WASD maps through InputService to normalized movement without direct input APIs in gameplay. | **NOT YET VERIFIED** |
| P0-AND-001 | Unity Android build | Same project makes ARM64 development artifact with toolchain/profile evidence. | **NOT YET VERIFIED** |
| P0-AND-002 | Physical Android | Install/launch; virtual stick has PC-equivalent normalized movement semantics. | **NOT YET VERIFIED** |
| P0-AND-003 | Physical Android | Pause/resume causes no unintended persistence mutation (no implicit save). | **NOT YET VERIFIED** |
| P0-AND-004 | Device/toolchain audit | Device class/OS, Unity version, SDK/API, and live target-SDK requirement recorded safely. | **NOT YET VERIFIED** |

## Phase 4/6 persistence and recovery gates

After Campfire and SaveService exist, Phase 4/6 validates restoration of the
last committed manual campfire save after pause/resume, focus change, and
process loss; rollback of later unsaved progress; and atomic primary/backup
recovery. These are not Phase 0 assertions and remain **NOT YET VERIFIED**.

## Phase 1 focused tests

| ID | Medium | Scenario and acceptance | Current status |
| --- | --- | --- | --- |
| P1-CMB-001 | EditMode | Motion above threshold immediately disables normal auto-attack. | Planned; **NOT YET VERIFIED** |
| P1-CMB-002 | EditMode | Below threshold, stable sorted valid candidates produce deterministic tuneable target choice. | Planned; **NOT YET VERIFIED** |
| P1-CMB-003 | EditMode | Target death, invalidity, or range loss safely retargets/idles. | Planned; **NOT YET VERIFIED** |
| P1-CMB-004 | PlayMode | Movement, stationary attack, enemy health/death, and drops form one coherent loop. | Planned; **NOT YET VERIFIED** |
| P1-CMB-005 | PC runnable smoke | WASD interrupts attack; stopping resumes targeting without mouse aim. | **NOT YET VERIFIED** |
| P1-CMB-006 | Physical Android | Drift tolerance, interruption, stop-to-attack, touch UI, aspect/safe-area usability. | **NOT YET VERIFIED** |
| P1-CMB-007 | Regression | Automatic/passive skills respect cooldown/range/eligibility without manual aim. | Planned; **NOT YET VERIFIED** |

## Phase 2 planned architecture tests

| ID | Medium | Scenario and acceptance | Current status |
| --- | --- | --- | --- |
| P2-ARCH-001 | EditMode deterministic vectors | The same WorldIdentity and named domain produce the same base recipe and procedural IDs regardless of chunk load order; changing decoration does not change encounter, boss, or campfire recipes. | Planned; **NOT YET VERIFIED** |

## Phase 3 planned architecture tests

| ID | Medium | Scenario and acceptance | Current status |
| --- | --- | --- | --- |
| P3-ARCH-001 | EditMode/PlayMode record-versus-projection fixture | Chunk unload destroys or pools only projections. Stable building/settlement records remain queryable through the read-only per-chunk overlay, and invalid relocation leaves the original record unchanged. | Planned; **NOT YET VERIFIED** |

## Phase 4 planned architecture tests

| ID | Medium | Scenario and acceptance | Current status |
| --- | --- | --- | --- |
| P4-ARCH-001 | EditMode fake-storage boundary test | Only an explicit valid-campfire request carrying a committed snapshot calls Persistence storage. Ordinary mutation, pause, focus loss, and quit produce zero storage writes. | Planned; **NOT YET VERIFIED** |
| P4-ARCH-002 | EditMode migration fixture | Current and prior planned `SaveDocument` migrations preserve declared fields, while unsupported forward versions fail safely before storage authority changes. | Planned; **NOT YET VERIFIED** |

## Phase 5 planned architecture tests

| ID | Medium | Scenario and acceptance | Current status |
| --- | --- | --- | --- |
| P5-ARCH-001 | EditMode saved-versus-unsaved fixture | Unsaved boss/modifier mutations remain runtime-only; loading the last valid committed snapshot restores exactly the permanent modifier records from that campfire save. | Planned; **NOT YET VERIFIED** |

## Phase 6 planned architecture tests

| ID | Medium | Scenario and acceptance | Current status |
| --- | --- | --- | --- |
| P6-ARCH-001 | Architecture lint plus device QA | Named input, lifecycle, and presentation adapters contain platform differences; Combat, World, and Persistence have no Android-specific authority or direct Unity platform API bypass. | Planned; **NOT YET VERIFIED** |

## Later high-risk regression contracts

| Area | Required regression |
| --- | --- |
| Determinism | Same seed/version gives equivalent recipe; load order cannot perturb it; procedural IDs remain stable. |
| Save safety (Phase 4/6) | Save/load equality; interrupted temp write preserves primary; corrupt primary recovers backup; unsupported version fails safely; invalid save point writes nothing. |
| Buildings | Isolated normal building rejected; valid isolated Campfire accepted; nearby building accepted; invalid relocation retains old state; unload/reload restores structures. |
| Progression | Unsaved boss kill disappears after prior-save load; saved kill persists; upgrade choices are valid/non-duplicate; selected upgrade reconstructs. |
| Resources/death | Death applies configured carried-resource loss; committed resources restore exactly; transactions never make resources negative. |

## Evidence requirements and end-to-end route

Each future record states candidate SHA, test ID, medium/tool version, scenario
inputs, observed result, safely redacted artifact/log reference, limitations, and
next safe action. Device records include class/OS/build fingerprint without
unique identifiers.

Final acceptance spans known-seed generation; chunk travel; auto-combat; tiered
loot; valid/rejected building placement; Campfire settlement creation; upgrade
and relocation; chunk return; boss reward; explicit save; restart/load equality;
then force-close rollback of later unsaved progress, repeated on Android. This is
**NOT YET VERIFIED**.
