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
