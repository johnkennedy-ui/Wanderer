# Browser MVP test matrix

| ID              | Medium                              | Assertion                                                                | Command/source                     |
| --------------- | ----------------------------------- | ------------------------------------------------------------------------ | ---------------------------------- |
| WEB-DOMAIN-001  | Vitest                              | named-seed identities/domains stay stable; near/far danger scales        | `src/tests/domain/world.test.ts`   |
| WEB-DOMAIN-002  | Vitest                              | five resources, L1-L3 building effects, capacity, upgrades, death        | `src/tests/domain/session.test.ts` |
| WEB-SAVE-003    | Vitest                              | schema v2 fail-closed parsing, backup fallback, interrupted-write safety | `src/tests/domain/save.test.ts`    |
| WEB-ARCH-004    | Node source guard                   | pure domain and explicit composition entrypoint                          | `npm run check:architecture`       |
| WEB-BROWSER-005 | Playwright desktop + touch viewport | input paths, resource UI, Storage UI, save/reload, invalid placement     | `npm run test:browser`             |
| WEB-BUILD-006   | Vite                                | production browser bundle                                                | `npm run build`                    |

Run the complete browser route with an isolated temporary profile:

```bash
TMPDIR=/tmp/wanderer-playwright-profile \
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium \
  npm run test:browser
```

The browser scenarios cover initial resource/capacity presentation, keyboard/stationary auto-attack, virtual-stick movement/release, valid manual save/reload with later unsaved rollback, and invalid normal-building placement. They do not use an Android device.

## Explicitly unverified native matrix

All Android wrapper, APK/AAB, physical Android touch, pause/resume, lifecycle, performance, ARM64, target-SDK, signing, and Play evidence is **NOT YET VERIFIED** for this candidate. Native Android remains ungenerated. See `ANDROID_BUILD.md`.
