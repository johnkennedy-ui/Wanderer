# Wanderer — Project Contract

## Scope and ownership

This is a standalone, browser-first TypeScript/WebGL game with a dedicated
Capacitor Android wrapper. It must not modify or copy production source from Tap
Survivor or the parent OpenClaw workspace. Work only inside this repository.

The user explicitly authorised this pivot on 2026-08-21: browser play is the
first delivery target; Capacitor is the native Android packaging route. This
replaces the former Unity-only implementation constraint. It does **not** prove
that an Android APK/AAB, physical-device test, Google Play submission, or Unity
build exists.

## Repository layout

- `src/domain/` — pure deterministic world, combat, building, progression, and
  save-domain contracts. No DOM, Three.js, Capacitor, storage, or mutable global
  state.
- `src/app/` — the one explicit browser composition root plus lifecycle
  orchestration and named feature adapters.
- `src/platform/` — browser input, storage, rendering, and Capacitor-facing
  adapters. They may depend on platform APIs, never the reverse.
- `src/ui/` — disposable DOM presentation and explicit user intents only.
- `src/data/` — immutable authored definitions and tuning.
- `src/tests/` — deterministic unit and consumer/integration tests.
- `public/` — static browser assets only.
- `android/` — Capacitor-generated Android wrapper once created by the
  Capacitor CLI; it is a platform adapter, not gameplay authority.
- `Documentation~/` — durable implementation and validation records.
- `Tools~/` — deterministic developer-only scripts; no credentials.

Never commit `node_modules/`, `dist/`, Capacitor copied web assets, Android
build outputs, signing material, keystores, service-account JSON, or local
browser/Gradle caches.

## Required architecture boundaries

```text
immutable definitions != runtime session != committed save document != presentation
deterministic base world != persisted player/world deltas
ordinary mutation != explicit campfire save commit
input source != gameplay command
```

- `createGameApplication` is the only composition root. It constructs the
  session and passes narrow command/query/snapshot ports to adapters; it must
  not become a service locator, global registry, or gameplay-policy module.
- `GameSession` is an ordinary explicitly retained object. It is never exported
  as mutable singleton/static/default/current state, cached globally, or found
  through a DOM/scene search.
- No mutable module-level state, global event bus, automatic registration,
  reachable DI container, cross-module concrete reach-through, or generic
  `Services`/`Utils` bag is allowed.
- Platform adapters translate keyboard, pointer/touch, DOM, localStorage,
  Three.js, and Capacitor lifecycle APIs into feature-owned ports. Domain code
  must not call those APIs directly.
- Rendering, DOM, chunk visuals, UI, and pooled meshes are disposable
  projections. They never own player, world, building, combat, or save state.
- Definitions have stable IDs and are immutable. Runtime buildings use stable
  GUIDs; persistent procedural objects use deterministic IDs. Never persist
  render, DOM, or framework instance IDs.
- Deterministic generation receives explicit domain-derived seeds. Do not use
  `Math.random()` or one shared PRNG stream as world authority; named terrain,
  POI, campfire, boss, encounter, and cosmetic streams are required.

## Gameplay and persistence rules

- Manual campfire save is the only committed persistence transition. Enemy
  deaths, pickups, placement, upgrades, boss defeat, pause, unload, reload, and
  quit must not silently save.
- The persistence adapter receives only an explicit valid-save request and a
  validated immutable snapshot. It must use a versioned document, temporary
  write/validation, primary/backup recovery, and safe failure behaviour.
- Same seed + generator version + chunk coordinate + named domain must produce
  the same base structure independent of load order.
- PC keyboard and mobile virtual-stick input must produce the same gameplay
  movement command; basic attacks stop while meaningful movement is present.
- Android/Capacitor remains a first-class design surface, but native device,
  pause/resume, APK/AAB, ARM64, target-SDK, performance, signing, and Play
  claims require their own evidence. Before Play packaging, re-check current
  Google policy and target-SDK requirements.

## Engineering rules

- Keep each cut narrow, data-driven, deterministic, and independently testable.
- Build the canonical web runtime first; Capacitor syncs that exact built web
  output. Do not fork gameplay between browser and Android.
- Run the declared generation, typecheck, test, architecture guard, build, and
  reproducibility checks before candidate freeze.
- Treat all current project documentation as historical until it is rewritten
  to describe the browser-first implementation truthfully.
- Do not publish, push, upload a build, use credentials, contact Google Play,
  install an Android artifact, or change global SDK/toolchain configuration
  without separately verified authority and evidence.
