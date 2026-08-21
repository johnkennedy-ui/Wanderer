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
- Update documentation only to describe implemented, evidenced behavior, or
  clearly label future requirements as planned and **NOT YET VERIFIED**.

## Planned maintainability constraints — **NOT YET VERIFIED**

The rules below constrain a future Editor-created implementation only. They do
not claim that any Unity runtime, module, test, or scene exists in this
documentation-only foundation.

- Use one explicitly named, local gameplay-scene composition root, planned at
  `Assets/Game/Composition/`. It alone may construct cross-module concrete
  services or bind deliberately serialized scene/prefab references. It performs
  wiring and lifecycle handoff only; it must not become gameplay, generation,
  placement, save, migration, or persistence policy.
- `GameSession` is an ordinary object constructed and retained explicitly by
  that composition root. It must never be a `MonoBehaviour` singleton, static
  `Current`/`Instance`/`Default`, registry entry, or discoverable service.
  Consumers receive only the narrow command, query, or committed-snapshot port
  they require.
- Each feature owns narrow, declared ports at its boundary. For example, Input
  emits to a Player-owned movement boundary, World consumes a declared
  read-only overlay query, and Persistence receives an explicit valid-save
  request plus committed snapshot. Do not add a generic shared services or
  utilities framework merely to make future dependencies convenient.
- Presentation is never authority: UI, chunk GameObjects, cameras, pools, and
  VFX may project state and submit explicit intents, but they must not own
  mutable player/world/save state or hidden save calls.
- Future production code must not introduce global-equivalent authority:
  mutable static state, service/cache accessors, service locators or reachable
  DI containers, automatic registration, global event buses, mutable static
  dictionaries, or `DontDestroyOnLoad` managers used as session state.
- Future feature code must not discover gameplay authority through
  `GameObject.Find*`, `FindAnyObjectByType`, `FindFirstObjectByType`,
  `Resources.FindObjectsOfTypeAll`, or cross-module `GetComponent` lookups.
  A deliberately serialized reference owned locally by Composition is the only
  planned scene-binding exception.
- Immutable compile-time constants and pure immutable static value helpers are
  allowed. They must not retain session, world, save, scene, or service state.
  Authored definitions may be immutable; ScriptableObjects/assets must not hold
  mutable runtime/save state or service/GameObject references.
- Deterministic World logic must receive explicit domain-derived seeds. It must
  not use `UnityEngine.Random`, one shared PRNG stream, scene order, or chunk
  request order as world authority. Named adapters, wired explicitly by
  Composition, own Unity input, storage-path/filesystem, and UI platform APIs;
  domain systems must not bypass those boundaries.
- Add only phase-local seams and their matching tests when their planned
  feature is introduced. Do not reorder the phase plan or pre-build a generic
  framework in Phase 0.
