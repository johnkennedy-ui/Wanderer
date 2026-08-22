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

Wanderer requires Node 22 (pinned in [`.nvmrc`](.nvmrc)). Run this complete
validation sequence before handing off a compatibility-sensitive feature
branch:

Before the first browser run on a machine, install Playwright Chromium after an
initial dependency install. `npm ci` does not download the browser binary:

```bash
# Once per machine (after npm ci)
npx playwright install chromium

# Supported Linux environments that also need system libraries may use:
npx playwright install --with-deps chromium
```

After that browser prerequisite, run the canonical validation sequence:

```bash
npm ci
npm run verify
npm run test:browser
VITE_BASE_PATH=/Wanderer/ npm run build
```

`npm run verify` is the canonical local and CI gate: it format-checks,
typechecks, unit-tests, checks architecture, and produces the root production
build. `npm run test:browser` builds `dist/` for both the root and GitHub Pages
`/Wanderer/` base paths, then uses `vite preview` and Playwright to load each
path. It does not test the Vite development server. The final explicit Pages
build protects the deploy base-path contract independently. `dist/`,
`node_modules/`, Playwright output, and generated native wrappers are ignored.

The GitHub Actions workflow runs the verification and built-output browser
gates for pull requests and pushes to `main`. Its Pages build job depends on
that successful verification and checks out `github.sha`, so deployment
artefacts come from the validated commit. This describes the workflow policy;
it is not evidence that a deployment has occurred.

Use a feature branch, make reviewable bounded commits, and do not push directly
to `main`. See `AGENTS.md` for the compatibility workflow and required
completion report, `ARCHITECTURE.md` for dependency boundaries, `SAVE_FORMAT.md`
for the frozen schema-2 wire contract, and `WORLD_GENERATION.md` for released
generator compatibility.

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
