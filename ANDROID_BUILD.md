# Android and Cross-Platform Build Plan

## Verification status

This is a validation plan, not Android build evidence.

| Requirement | Status |
| --- | --- |
| Unity 6 Editor with desktop and Android modules | **NOT YET VERIFIED** — no Unity 6 Editor is installed. |
| Editor-created project and build profiles | **NOT YET VERIFIED** — no metadata has been generated. |
| PC development build and keyboard movement | **NOT YET VERIFIED** — no runtime exists. |
| Android ARM64 development build | **NOT YET VERIFIED** — no Android build has run. |
| SDK suitability for release target | **NOT YET VERIFIED** — local SDK inventory shows API 35, not proven API 36-compatible. |
| Device, ADB, install, and lifecycle smoke | **NOT YET VERIFIED** — no ADB-visible device is attached. |
| AAB packaging and Play compliance | **NOT YET VERIFIED** — live policy/toolchain must be rechecked before release. |

## PC and touch input contract

Gameplay receives source-neutral commands, never direct keyboard, touch, or
device APIs:

~~~
Move(normalized Vector2 intent, source timestamp)
UIAction(action ID, phase)
~~~

The PC adapter maps WASD and the mobile adapter maps a virtual stick. The same
PlayerController applies the meaningful-movement threshold. Mouse/touch may vary
for UI but normal combat cannot need precision click/tap aiming.

## Future toolchain preflight

This plan does not authorise installation or configuration. After separate
authority, record exact versions and evidence:

1. Verify a supported Unity 6 Editor with desktop and Android modules.
2. Create a 3D URP/mobile-friendly project through that Editor; review generated
   project configuration and New Input System availability.
3. Verify SDK, NDK, JDK, and API compatibility against the exact Unity release
   and live Google Play requirements.
4. Confirm a USB-debuggable Android phone is physically connected and ADB can
   identify it; do not publish unique device identifiers.

The current host inventory has API 35 and build-tools 34.0.0/35.0.0. That does
not prove a Unity Android build works or satisfies the brief's API 36-or-higher
new-submission target after 2026-08-31 if policy remains unchanged.

## Phase 0 PC and device route

| Step | Required evidence | Status |
| --- | --- | --- |
| PC build | Exact Editor/build profile, artifact hash/path, runnable launch record | **NOT YET VERIFIED** |
| PC movement | WASD produces expected source-neutral movement; usable UI | **NOT YET VERIFIED** |
| Android ARM64 build | Build profile shows ARM64 and yields installable artifact | **NOT YET VERIFIED** |
| Device movement | Virtual stick has same normalized movement semantics | **NOT YET VERIFIED** |
| Lifecycle | Pause/resume must not implicitly store or mutate persistence state. | **NOT YET VERIFIED** |

Phase 0 is not passed until the same project has PC and physical-device evidence.
Editor-only success cannot replace device evidence.

## Phase 1 touchscreen and Phase 4/6 persistence/lifecycle hardening

On physical hardware, test virtual-stick drift tolerance, immediate movement
attack interruption, stop-to-attack reacquisition, touch UI, safe areas, and
multiple aspect ratios. These results are **NOT YET VERIFIED**.

After Campfire and SaveService exist, Phase 4/6 must validate restoration of
the last committed manual campfire save after pause/resume, focus change, and
process loss; rollback of later unsaved progress; and atomic primary/backup
recovery. These results are **NOT YET VERIFIED**.

Phase 6 must profile actual target devices against a 60 FPS aim and 30 FPS hard
minimum; enforce explicit budgets for pools, draw calls, physics, particles, and
chunks; and make ARM64/AAB packaging explicit. Immediately before release, recheck live
Google Play target-SDK, signing authority, policy, and listing requirements. No
performance, lifecycle, packaging, or Play-readiness conclusion is valid without
corresponding evidence.
