# Browser MVP test matrix

| ID              | Medium                              | Assertion                                                                                                                                                                    | Command/source                               |
| --------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| WEB-DOMAIN-001  | Vitest                              | named-seed identities/domains stay stable; near/far danger scales                                                                                                            | `src/tests/domain/world.test.ts`             |
| WEB-DOMAIN-002  | Vitest                              | five resources, L1-L3 building effects, capacity, upgrades, death                                                                                                            | `src/tests/domain/session-*.test.ts`         |
| WEB-SAVE-003    | Vitest                              | schema v2 fail-closed parsing, backup fallback, interrupted-write safety                                                                                                     | `src/tests/domain/save.test.ts`              |
| WEB-ARCH-004    | Node source guard                   | pure domain and explicit composition entrypoint                                                                                                                              | `npm run check:architecture`                 |
| WEB-BROWSER-005 | Playwright desktop + touch viewport | built `dist/` from both `/` and `/Wanderer/` via `vite preview`; input paths, resource UI, Storage UI, save/reload, invalid placement, and rendered native-evidence boundary | `npm run test:browser`                       |
| WEB-BROWSER-006 | Playwright desktop + touch viewport | public keyboard route defeats the real boss, exposes exactly three choices, selects one, and proves reload rollback without a Save action                                    | `npm run test:browser`                       |
| WEB-BUILD-006   | Vite                                | root production browser bundle, including the canonical verification build                                                                                                   | `npm run verify`                             |
| WEB-BUILD-007   | Vite                                | GitHub Pages `/Wanderer/` production bundle is built and preview-tested                                                                                                      | `npm run test:browser`; explicit Pages build |

Before the first browser run on a machine, install Playwright Chromium after an
initial dependency install. `npm ci` does not download the browser binary:

```bash
# Once per machine (after npm ci)
npx playwright install chromium

# Supported Linux environments that also need system libraries may use:
npx playwright install --with-deps chromium
```

After that browser prerequisite, run the required validation sequence before
handing off a compatibility-sensitive feature branch:

```bash
npm ci
npm run verify
npm run test:browser
VITE_BASE_PATH=/Wanderer/ npm run build
```

`npm run verify` is the canonical local and CI gate for formatting, TypeScript,
unit, architecture, and root production-build checks. `npm run test:browser`
then builds and serves `dist/` twice: once at `/`, and once at `/Wanderer/`.
The browser scenarios cover initial resource/capacity presentation, the visible
native-evidence limitation, keyboard/stationary auto-attack, virtual-stick
movement/release, valid manual save/reload with later unsaved rollback, invalid
normal-building placement, and a real public keyboard route to boss
defeat/three-choice upgrade selection. That boss route does not press Save;
reload proves the applied Boss Core/upgrade state was runtime-only. They do not
use an Android device.

The explicitly repeated `VITE_BASE_PATH=/Wanderer/ npm run build` command is a
separate GitHub Pages deploy-path check. It is not a substitute for browser
tests, and browser tests are not a substitute for the canonical `npm run
verify` gate.

## M4 deterministic runtime evidence

`npm run test:soak` runs the fixed-seed headless soak, invariant/mutation-isolation
suite, and global-pursuit regressions using existing Vitest tooling. Each of the
uninterrupted and midpoint-hydrated schedules runs twice (4,160 fixed 0.1s steps
per run). Tests compare canonical SHA-256 diagnostic hashes and all measured
maxima/checkpoints, and print `M4_SOAK_EVIDENCE` JSON for durable log capture.
There are no sleeps or elapsed-wall-time assertions; the 60s test timeout is only
a failure watchdog, not a performance claim.

The explicit valid home-campfire midpoint compares the complete durable save
projection with its immediate hydration/re-save projection at the same fixed
commit timestamp. Runtime combat state is intentionally reset on hydration;
continued hydrated and uninterrupted combat are NOT asserted equal. Both routes
must independently repeat deterministically. Tests assert traversal/revisits,
projectiles, drops, building actions, finite invariants, serial/ID consistency,
and observed retained-state growth. See `Documentation~/M4_RUNTIME_BOUNDS.md` for
scope and the deferred pruning decision.

Root Node 22 validation: 33 focused tests, 137 full-suite tests, formatting,
typecheck, architecture and build/rebuild passed; 44 built-browser cases passed
across root/Pages base paths. Eight schema-v2/generator-v1 fixtures remain
byte-identical to accepted M3. Independent review and release remain separate
gates. See the M4 document for finite measurements and limitations.

## M5 checks

- `src/tests/domain/chunk-recipe-cache.test.ts`: immutable recipes, deterministic
  LRU/identity/axis keys, both released generators, isolation/reset/hydration,
  shared consumers, stationary warmup and preserved Healing Hut behaviour.
- `src/tests/domain/session-world-runtime.test.ts` and
  `session-runtime-bounds.test.ts`: retained enemy authority across eviction,
  copied diagnostics and finite cache accounting without weakening global chase.
- `src/tests/platform/three-renderer.test.ts`: retained identities, warm heavy
  allocation counts, actual cylinder Y=0, aura/projectile/recovery variants,
  bounded maps, instance isolation and exactly-once resource/adapter disposal.
  CPU ownership tests do not establish real browser rendering or hardware speed.
- `src/tests/ui/game-ui.test.ts`: keyed building rows, targeted updates, current
  placement callbacks, removal/disposal, effect signatures and current HUD/class
  flow. Narrow DOM doubles complement, rather than replace, browser checks.
- `src/tests/browser/m5-rendering.spec.ts`: trusted current canvas placement,
  row/effect identity and mutation observation, Healing Hut changes, stable
  canvas/label, cancellation/reset and no implicit save. Public progression
  choices are resolved before obstructed actions; old coordinate inputs are not
  restored. Existing browser cases retain their names and semantic expectations,
  using current icon-control names, resource chip labels and the capacity field.
- `npm run test:soak`: the fixed schedule, deterministic repeat, durable
  roundtrip and state bounds remain; cache maxima and `M5_SOAK_EVIDENCE` extend
  diagnostics. Historical M4 measurements above remain historical, not new goldens.

Run changed-file formatting, typecheck, focused/full tests, architecture, soak,
fixture hashes, reproducible builds, and both root/Pages desktop/touch browser
surfaces on the composed candidate. Exact-candidate independent review and release
remain separate gates; implementation descriptions or old-base results are not
M5 acceptance.

## Explicitly unverified native matrix

All Android wrapper, APK/AAB, physical Android touch, pause/resume, lifecycle, performance, ARM64, target-SDK, signing, and Play evidence is **NOT YET VERIFIED** for this candidate. The rendered browser UI repeats this boundary for consumers. Native Android remains ungenerated. See `ANDROID_BUILD.md`.
