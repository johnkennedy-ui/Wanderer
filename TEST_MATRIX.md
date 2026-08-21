# Browser MVP test matrix

| ID              | Medium                              | Assertion                                                              | Command/source                     |
| --------------- | ----------------------------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| WEB-DOMAIN-001  | Vitest                              | named-seed chunk recipes and IDs are request-order independent         | `src/tests/domain/world.test.ts`   |
| WEB-DOMAIN-002  | Vitest                              | movement gate, atomic invalid building, and distinct boss choices      | `src/tests/domain/session.test.ts` |
| WEB-SAVE-003    | Vitest                              | explicit save restores committed state while later movement disappears | `src/tests/domain/session.test.ts` |
| WEB-ARCH-004    | Node source guard                   | pure domain and explicit composition entrypoint                        | `npm run check:architecture`       |
| WEB-BROWSER-005 | Playwright desktop + touch viewport | initial load, input paths, save/reload rollback, invalid placement     | `npm run test:browser`             |
| WEB-BUILD-006   | Vite                                | production browser bundle                                              | `npm run build`                    |

Run the complete browser route with an isolated temporary profile:

```bash
TMPDIR=/tmp/wanderer-playwright-profile \
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium \
  npm run test:browser
```

The Playwright scenarios use a deterministic browser origin/profile and cover
initial load, keyboard/stationary auto-attack, virtual-stick movement/release,
valid manual save/reload, later unsaved rollback, and invalid normal-building
placement. They do not use an Android device.

## Explicitly unverified native matrix

All Android wrapper, APK/AAB, physical Android touch, pause/resume, lifecycle,
performance, ARM64, target-SDK, signing, and Play evidence is **NOT YET
VERIFIED** for this candidate. See `ANDROID_BUILD.md`.
