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
- Definitions have opaque, append-only IDs and are immutable. Player-built
  buildings retain the serialized `building:<stable-world-seed-hash>:<session-serial>`
  form; persistent procedural objects use deterministic IDs. Do not replace
  either compatible ID strategy with GUIDs. Never persist render, DOM, or
  framework instance IDs.
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

## Compatibility-safe maintenance workflow

`createGameApplication` is the one composition root. It explicitly owns one
ordinary `GameSession`, which owns all retained gameplay state. Fresh and reset
state comes from `createFreshSessionState`; saved state is cloned through
`hydrateSessionState`; `projectCurrentSave` is the narrow copy-out boundary for
explicit persistence. These are factories and projections, not registries or
shared state.

`GameNotice` is an instance-owned discriminated outcome. The UI translates its
`kind` and facts through `noticePresentation.ts`; it must never infer gameplay
behaviour by matching English display text. New presentation consumers should
use the narrow `GameUiSnapshot` or `GameRendererSnapshot` projections. The
legacy `GameSnapshot` aggregate is a transitional read-only facade, never a
second authority.

Allowed patterns include immutable module constants, deeply frozen authored
catalogues, immutable generator-dispatch tables, pure functions, explicit
narrow interfaces, test fixtures/factories, and disposable caches owned by a
session, renderer, or adapter instance. Prohibited patterns include mutable
module-level `let`/`var`, exported mutable state bags, module-level runtime
`Map`/`Set`/arrays, mutable static state, global stores or event buses, service
locators, generic `Services` bags, dependency containers, automatic feature or
service registration, reflection-based discovery, and concrete adapter
reach-through. `ARCHITECTURE.md` defines the exact dependency rules and their
machine-enforced coverage.

Before a compatibility-sensitive change, identify whether it affects the save
wire shape, persistent IDs, storage recovery, or deterministic output. Use a
feature branch; never push directly to `main`; keep each commit bounded to one
reviewable phase; and run fresh validation after every phase. Do not rewrite
historical save or world fixtures just to make a changed implementation pass.

Before the first browser run on a machine, install Playwright Chromium after an
initial dependency install. `npm ci` does not download the browser binary:

```bash
# Once per machine (after npm ci)
npx playwright install chromium

# Supported Linux environments that also need system libraries may use:
npx playwright install --with-deps chromium
```

After that browser prerequisite, the required local release gate is:

```bash
npm ci
npm run verify
npm run test:browser
VITE_BASE_PATH=/Wanderer/ npm run build
```

`npm run test:browser` builds `dist/`, serves it with `vite preview`, and
exercises both `/` and `/Wanderer/`; it is not a Vite development-server test.
See `TEST_MATRIX.md` for the covered browser scenarios.

### Change classification

| Change                          | Save schema            | Generator version     | Required treatment                                                        |
| ------------------------------- | ---------------------- | --------------------- | ------------------------------------------------------------------------- |
| Internal refactor               | No                     | No                    | Existing save and world fixtures remain identical.                        |
| UI, renderer, or control change | No                     | No                    | Keep adapters non-authoritative and validate built output.                |
| Display-label change            | No                     | No                    | Keep the persistent ID unchanged.                                         |
| Add optional content            | Usually no             | Usually no            | Append an ID and provide compatible defaults/definitions.                 |
| Add required persisted field    | New schema when needed | No                    | Provide a pure, explicit migration.                                       |
| Change procedural output or IDs | No map migration       | New generator version | Preserve the released implementation and add a new version.               |
| Rename or remove a persisted ID | Prohibited by default  | Possibly              | Retain an alias/definition or provide an explicit migration.              |
| Change storage adapter          | No                     | No                    | Preserve load, commit, temporary, primary, and backup recovery semantics. |

### Completion report

Every completed compatibility-sensitive change must report the feature branch,
baseline and final commit hashes, bounded commits and files changed, commands
actually run with results, compatibility impact (schema, keys, historical
saves, generator output, IDs, gameplay, and deployment path), remaining risks,
and final `git status --short`. Never claim a push, pull request, deployment,
native verification, or passing command without direct evidence.
