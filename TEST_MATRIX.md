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
- `src/tests/browser/m5-rendering.spec.ts`: **live built-app** trusted current
  canvas placement, retained rows/buttons through upgrades and next-tap relocation,
  whole unaffected row text (including all three controls), departed-row removal,
  Healing Hut row/aura/listener identity and 3/4/5m presentation, maximum-level
  disabling, overlap rejection, cancellation, selected demolition, pending-action
  reset, stable canvas/health label and no implicit save. Whole-row comparisons
  consistently use whitespace-normalized `textContent`, not layout-dependent
  `innerText` against `textContent`. Explicit Playwright handle cleanup remains.
- `src/tests/browser/m5-dom-consumer.spec.ts`: **standalone real-DOM consumer**,
  not the live app or a `dist/` integration substitute. The exact checked-out
  `RetainedBuildingRows` / `RetainedEffects` and their existing runtime dependencies
  are transpiled in memory with the already-declared TypeScript package and loaded
  as page-local ES modules. There are no DOM doubles, copied implementations, new
  dependencies, runtime hooks or build/config changes. After warmup, exactly eight
  animation-frame renders receive independently recorded identical complete
  building/effect values (including explicit XP), using fresh arrays each time.
  The assertion remains **zero mutations**, equal node counts and exact row,
  control and effect node identities. An XP-change positive control must cause
  observed writes/effect replacement while retaining rows. Consumers are disposed;
  source hashes and full frame-input/observation evidence are attached by the test.
  This isolates the identical-input property from legitimately changing live XP;
  it does not establish eight unchanged simulation frames in a running game.
- `src/tests/browser/wanderer.spec.ts`: the honestly named **valid 29 XP / level-0
  save fixture** is decoded by the production save parser, then loaded before boot.
  The first visible HUD witness must still show 29 XP / L0. Normal stationary
  gameplay must earn the crossing to at least 30 XP / L1, show a floor drop and
  expose the class choice within the existing 8s bound; the selected Wizard must
  be visible and the committed save bytes unchanged. There is no after-boot state
  injection, preloaded earned threshold, XP filtering, clock manipulation or
  replay-until-green. Navigation waits only for commit so observation can begin
  before the first kill; missing the initial below-threshold witness is a failure.
  This is causal **loaded-near-threshold gameplay**, NOT fresh 0-to-30 progression.
  Other default fresh UI/input, genuine combat/drop/hit, generator-v1 save/load,
  corrupt-save, manual-save/reload and real public keyboard boss-route cases remain
  separate. Touch canvas cases now use actionability-checked public `locator.tap`
  rather than dispatching pointer events through a possibly obstructed canvas.
- `src/tests/browser/m5-test-helpers.ts`: incidental asynchronous class/boss
  choices use installed Playwright `addLocatorHandler` actionability/assertion
  boundaries. Each selection must lose its button identity, change its public
  choice key and appear in effects. Consecutive class tiers may retain the visible
  container; no four-choice cap, click-retry loop, swallowed error or hidden click
  is used. Class and boss acceptance tests opt out of incidental handlers; the
  boss test explicitly handles only intervening class choices, never its boss
  selection. Input-test hold durations, 5s target-action bounds and existing
  test/expect watchdogs remain.
- `npm run test:soak`: the fixed schedule, deterministic repeat, durable
  roundtrip and state bounds remain; cache maxima and `M5_SOAK_EVIDENCE` extend
  diagnostics. Historical M4 measurements above remain historical, not new goldens.

### M5 correction timing and evidence boundary

The supplied four decoded terminal traces (root/Pages row and hut scenarios)
showed successful late relocation/demolition/reset actions cumulatively exhausting
60s. They do not prove a Playwright handle-disposal fault, a production cleanup
fault, or that changing trace settings fixes the scenarios. The redundant boss
pursuit precondition is removed only from the fresh M5 placement/retention cases;
the separate real boss-route acceptance case remains. The exact-input property is
moved to its own consumer case, not weakened to tolerate writes. No watchdog is
increased. The existing one-XP-per-kill, 0.5s basic attack and 30-XP threshold do not
support the old self-imposed simple fresh 0-to-30-in-8s premise; the explicitly
permitted 29-XP fixture needs an actual gameplay-earned crossing instead.

These are candidate coverage descriptions, **not passing browser results**.
The correction worker does not run browsers/builds or duplicate the separate
source-fixed full-vs-lean trace experiment. Root must freeze and independently
validate this exact candidate on root/Pages desktop/touch. Standalone consumer
results must be reported separately from built-app gameplay/visual evidence.

Run changed-file formatting, typecheck, focused/full tests, architecture, soak,
fixture hashes, reproducible builds, and both root/Pages desktop/touch browser
surfaces on the composed candidate. Exact-candidate independent review and release
remain separate gates; implementation descriptions or old-base results are not
M5 acceptance.

## Explicitly unverified native matrix

All Android wrapper, APK/AAB, physical Android touch, pause/resume, lifecycle, performance, ARM64, target-SDK, signing, and Play evidence is **NOT YET VERIFIED** for this candidate. The rendered browser UI repeats this boundary for consumers. Native Android remains ungenerated. See `ANDROID_BUILD.md`.
