# Wanderer browser MVP

Wanderer is a browser-first, greybox top-down survival MVP built with Vite,
TypeScript, and Three.js. The playable runtime, deterministic domain, and
browser tests live in this repository; no Unity project is required.

## Run locally

```bash
npm install
npm run dev
```

Open the Vite address in a desktop or mobile browser. Move with **WASD**, arrow
keys, or the visible virtual stick. Basic attacks are automatic only when
meaningful movement has stopped. Use the known-seed reset control to repeat the
scenario without hidden world RNG.

## Validation commands

```bash
npm run format
npm run typecheck
npm run test
npm run check:architecture
npm run build
TMPDIR=/tmp/wanderer-playwright-profile \
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium \
  npm run test:browser
```

The browser test uses Playwright's isolated temporary profile. `dist/`,
`node_modules/`, Playwright output, and generated native wrappers are ignored.

## Implemented slice

- deterministic named-seed chunks and bounded primitive Three.js projection;
- one movement command boundary for keyboard and touch stick;
- stationary auto-combat, normal/elite/boss enemies, drops, respawns, passive
  effects, Boss Core, and exactly-three-choice boss rewards;
- all five building types with placement, relocation, upgrades, and demolition;
- explicit campfire-only versioned browser saves with temporary/primary/backup
  recovery; and
- a `dist`-based Capacitor configuration only.

## Truth boundary

This cut does **not** create `android/`, run `cap add android`, sync a native
wrapper, produce an APK/AAB, install to a device, test Capacitor lifecycle, or
claim Android/Play evidence. See [ANDROID_BUILD.md](ANDROID_BUILD.md) for the
separate generated-wrapper follow-on.
