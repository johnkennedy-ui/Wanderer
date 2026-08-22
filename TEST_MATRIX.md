# Browser MVP test matrix

| ID              | Medium                              | Assertion                                                                                                                                                                    | Command/source                               |
| --------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| WEB-DOMAIN-001  | Vitest                              | named-seed identities/domains stay stable; near/far danger scales                                                                                                            | `src/tests/domain/world.test.ts`             |
| WEB-DOMAIN-002  | Vitest                              | five resources, L1-L3 building effects, capacity, upgrades, death                                                                                                            | `src/tests/domain/session.test.ts`           |
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

## Explicitly unverified native matrix

All Android wrapper, APK/AAB, physical Android touch, pause/resume, lifecycle, performance, ARM64, target-SDK, signing, and Play evidence is **NOT YET VERIFIED** for this candidate. The rendered browser UI repeats this boundary for consumers. Native Android remains ungenerated. See `ANDROID_BUILD.md`.
