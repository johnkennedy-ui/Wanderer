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

Use Node 22.23.2 and npm 10.x. Start a repository mission on the clean feature
branch using the documented [agent workflow](Documentation~/agent-workflow.md),
then make bounded changes. After review, commit all source/configuration/docs
and run the supported completion route:

```bash
npm ci
npm run agent:doctor
npm run agent:finish
```

`agent:finish` runs `verify`, both built-browser base paths with root-build reuse,
fresh `security:check`, and the final artifact verifier through the existing
content-bound command recorder. It rehashes historical fixtures and writes
scoped JSON/Markdown under ignored `.agent/completions/`. Missing, stale or failed
mandatory local evidence is nonzero. `agent:evidence` alone is not completion.

`verify` preserves formatting, type/unit/soak/architecture checks, adds tested CI
policy, and creates the root build and artifact manifest. Public `test:browser`
still builds/tests both `/` and `/Wanderer/` using the static production preview,
not the Vite dev server. Its `--reuse-root-build` mode consumes the root build
from `verify` and leaves the verified Pages output. **Do not rebuild after the
browser gate**: pre-upload verification must use those exact bytes. `dist/`,
`node_modules/`, Playwright output and evidence/tool caches remain ignored.

The constrained workflow verifies PRs, main pushes, merge groups and manual
runs. Read-only code-executing jobs feed the fail-closed `ci-required` aggregate;
a separate minimal-privilege main-only job deploys the same-run tested artifact.
These are repository controls, not proof of live enforcement or deployment.
See the [CI/security contract](Documentation~/CI_SECURITY_CONTRACT.md) for scanner
acceptance, CSP limitations, independent review and owner-only settings actions.

Use a feature branch, make reviewable bounded commits, and do not push directly
to `main`. See `AGENTS.md` for the compatibility workflow and required
completion report, `ARCHITECTURE.md` for dependency boundaries, `SAVE_FORMAT.md`
for current schema-4 storage and frozen schema-2/schema-3 compatibility, and
`WORLD_GENERATION.md` for released generator compatibility.

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
- explicit campfire-only schema-4 browser saves (with schema-2/schema-3 recovery) plus
  save-point respawn, 25% carried-resource death loss,
  temporary/primary/backup recovery, and no automatic persistence.

## Truth boundary

This cut does **not** create `android/`, run `cap add android`, sync a native
wrapper, produce an APK/AAB, install to a device, test Capacitor lifecycle, or
claim Android/Play evidence. Native Android remains ungenerated and
unverified. See [ANDROID_BUILD.md](ANDROID_BUILD.md) for the separate
generated-wrapper follow-on.
