# Procedural Camp MVP — Project Contract

## Scope and ownership

This is a standalone Unity 6/C# project. It must not modify Tap Survivor or the
parent OpenClaw workspace. Work only inside this repository.

The current milestone is Phase 0 foundation. Until a Unity Editor is installed,
do not hand-author Unity-generated project metadata or claim that a Unity or
Android build has run. Create the Unity project through the verified Editor
toolchain, then commit its generated project files deliberately.

## Required system boundaries

- Procedural base world, persisted deltas, runtime state, and scene GameObjects
  are separate concerns.
- Static definitions use authored data; mutable save state never lives in
  ScriptableObjects or Unity instance IDs.
- Save commits happen only after an explicit interaction at a valid campfire.
- Input sources map into gameplay commands; gameplay does not depend on PC or
  touch APIs directly.
- Android support is a first-class acceptance surface, but no device or release
  claim is valid without physical-device evidence.

## Repository layout

- `Assets/Game/` — runtime C# and authored assets.
- `Assets/Tests/` — Unity EditMode/PlayMode tests.
- `Packages/`, `ProjectSettings/` — Unity-owned project configuration once the
  Editor creates it.
- `Documentation~/` — durable project documentation and test evidence indexes.
- `Tools~/` — deterministic developer-only scripts; no credentials.

Never commit `Library/`, `Temp/`, `Logs/`, generated build outputs, or local
Android signing material. Do not manually edit generated Unity files unless the
Editor has produced them and the change is explicitly part of a verified
configuration update.

## Engineering rules

- Keep each cut narrow, data-driven, deterministic, and independently testable.
- Preserve stable definition IDs, player-building GUIDs, and deterministic
  procedural IDs. Never use Unity runtime instance IDs for persistence.
- Treat explicit campfire save as the only committed state transition.
- Do not publish, upload an Android artifact, install host packages, or change
  global SDK/toolchain configuration without separate verified authority.
- Update documentation only to describe implemented, evidenced behavior.
