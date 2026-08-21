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

- deterministic named-seed chunks, distance-scaled danger, and a bounded
  primitive Three.js projection;
- one movement command boundary for keyboard and touch stick, with stationary
  auto-combat;
- five data-backed resource roles: Wood, Stone, Metal / Scrap, Essence, and
  Boss Core. Storage caps each common material; Boss Core is saved but exempt;
- normal, elite, and boss drops; ten boss upgrades including additive,
  multiplicative, and Chain Strike hit-resolution behavior;
- exactly Campfire, Workshop, Farm, Storage, and Healer, each with real L1-L3
  effects, placement, relocation, upgrades, and demolition/refunds; and
- explicit campfire-only version-2 browser saves with save-point respawn,
  25% carried-resource death loss, temporary/primary/backup recovery, and no
  automatic persistence.

## Truth boundary

This cut does **not** create `android/`, run `cap add android`, sync a native
wrapper, produce an APK/AAB, install to a device, test Capacitor lifecycle, or
claim Android/Play evidence. Native Android remains ungenerated and
unverified. See [ANDROID_BUILD.md](ANDROID_BUILD.md) for the separate
generated-wrapper follow-on.
