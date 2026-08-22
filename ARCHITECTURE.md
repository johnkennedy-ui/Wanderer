# Browser architecture boundaries

```text
src/main.ts
  -> src/app/createGameApplication.ts (the only composition root)
       -> one explicitly retained GameSession
       -> immutable authored definitions
       -> explicit platform and UI adapters

domain contracts and policy <-> immutable data definitions
             ^                         ^
             |                         |
        application wiring ------ platform / UI projections
```

`GameSession` is the sole mutable gameplay authority, but it is an ordinary
object held by `createGameApplication`. It is never a singleton, static
`current`, registry entry, DOM lookup result, or service-locator result.
`src/main.ts` only starts the explicit application composition root.

## Session lifecycle and presentation boundaries

`GameSession` remains the public gameplay façade, while bounded lifecycle work
is kept explicit. `src/domain/session/sessionState.ts` creates a complete fresh
or reset state with `createFreshSessionState` and clones a validated current
save with `hydrateSessionState`. `src/domain/session/saveProjection.ts` copies
only the persistence fields into `CurrentSave` through `projectCurrentSave`.
These helpers create or copy state for one session instance; none retains a
global session, cache, registry, or authority.

Commands leave the session with typed `GameNotice` values rather than
English-message conventions. `src/ui/noticePresentation.ts` owns wording and
must exhaustively present each notice kind. Behavioural UI code must use the
notice kind/facts, never `startsWith`, `includes`, or an exact display phrase.

Presentation gets narrow read models: `GameUiSnapshot` for the DOM UI and
`GameRendererSnapshot` for the disposable Three.js renderer. `GameSnapshot`
remains a transitional aggregate for existing consumers, but new consumers
must not use it to acquire unrelated authority or mutable session internals.

## Allowed dependency direction

| Source area     | May depend on                                           | Must not depend on                                                            |
| --------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/domain/`   | domain modules and immutable `src/data/` definitions    | app, platform, UI, DOM, browser storage, Three.js, Capacitor, `Math.random()` |
| `src/data/`     | domain type contracts and data helpers                  | app, platform, UI, runtime/session state                                      |
| `src/app/`      | domain, data, platform adapters, UI adapters            | generic container, registry, or hidden authority                              |
| `src/platform/` | narrow domain/data contracts and platform-local helpers | app ownership, UI ownership, concrete sibling platform adapters               |
| `src/ui/`       | narrow domain/data snapshots and explicit intents       | world, player, save, or renderer authority                                    |
| `src/main.ts`   | the application root and presentation stylesheet        | direct session construction                                                   |

The apparent domain/data two-way type relationship is intentional: data uses
stable domain identifiers for exhaustiveness, while the domain reads immutable
authored tuning. Neither pure area may import an adapter. Platform input
adapters share `src/platform/input/inputContracts.ts`; platform adapters use
narrow contract/helper modules rather than importing concrete platform peers.
Movement thresholding and intent normalisation live in the pure
`src/domain/inputPolicy.ts`, so input adapters never import `GameSession`.

## Ownership and persistence

```text
immutable definitions != runtime session != committed save document != presentation
deterministic base world != persisted player/world deltas
ordinary mutation != explicit campfire save commit
input source != gameplay command
```

- Definitions are deeply readonly and created through `deepFreeze`. Costs,
  drops, and nested tuning records cannot be mutated through TypeScript or at
  runtime. Exported authored catalogues require runtime freezing through
  `deepFreeze` or `Object.freeze`; TypeScript-only `readonly` or `as const`
  does not protect them at runtime. This does not freeze `GameSession` runtime
  state.
- `GameSession` copies caller-supplied world identity during construction,
  including `saved.world`, rather than retaining mutable external references.
- Manual campfire save is the only committed persistence transition. Storage
  remains responsible only for validated temporary/primary/backup browser-key
  handling; it does not decide whether a save is permitted.
- Deterministic generation receives explicit world seed/version and named
  domains. Presentation projections, Three meshes, DOM rows, and input visuals
  are disposable and never own gameplay or save state.

## Allowed and prohibited authority patterns

Allowed: immutable module constants; deeply frozen authored definitions;
immutable version-dispatch tables; pure functions; narrow explicit contracts;
test-only factories and fixtures; and non-authoritative, disposable local
caches owned by a session, application, renderer, or adapter instance.

Prohibited: mutable module-level `let`/`var`; exported mutable singleton
objects; module-level runtime `Map`, `Set`, or arrays; mutable static fields;
global stores; global event buses; service locators; generic `Services` bags;
application-wide dependency containers; automatic runtime registration;
reflection-based feature discovery; concrete platform-adapter imports; and
domain imports from application, UI, or platform layers. A platform adapter
may share a narrow contract/helper module, but it must not reach through a
concrete sibling adapter.

## Executable architecture guard

`npm run check:architecture` uses the TypeScript compiler API with the
repository `tsconfig` module-resolution options. It scans every production
TypeScript source below `src/`, excluding `src/tests/`, resolves imports, and
reports stable rule IDs with `file:line:column` locations.

| Rule      | Enforced boundary                                                                   |
| --------- | ----------------------------------------------------------------------------------- |
| `ARCH001` | `new GameSession()` only in `src/app/createGameApplication.ts` (tests are excluded) |
| `ARCH002` | production value imports of `GameSession` only in that composition root             |
| `ARCH003` | domain/data cannot import app, platform, or UI                                      |
| `ARCH004` | concrete platform adapters cannot import concrete sibling platform adapters         |
| `ARCH005` | domain/data cannot use browser APIs, Three, Capacitor, or `Math.random()`           |
| `ARCH006` | no mutable module-level state or mutable exported state bags                        |
| `ARCH007` | no module-level or static singleton instances                                       |
| `ARCH008` | no mutable static fields                                                            |
| `ARCH009` | no production import cycles                                                         |
| `ARCH010` | no automatic feature/service registration                                           |
| `ARCH011` | no service locator or generic service access                                        |
| `ARCH012` | direct browser storage only in `src/platform/storage/`                              |
| `ARCH013` | direct DOM access only in platform/UI adapters or `src/main.ts` bootstrap           |
| `ARCH014` | `src/main.ts` delegates composition to `createGameApplication`                      |

Focused fixtures deliberately introduce every prohibited pattern and also prove
that immutable constants and deeply frozen catalogues remain accepted. They are
test-only evidence; the production scan is never narrowed to accommodate them.

## Machine enforcement versus review rules

`npm run check:architecture` mechanically enforces the rule IDs above across
all production TypeScript under `src/`. `npm run verify` also typechecks,
unit-tests, and builds the root production output; those tests cover frozen
save and generator fixtures. The guard intentionally does not decide whether a
new save field needs a schema, whether a generator recipe changed, whether an
ID remains compatible, or whether a storage adapter preserves recovery
semantics. Those are compatibility review rules backed by the relevant
fixtures, focused tests, and the validation sequence in `AGENTS.md` and
`TEST_MATRIX.md`.

Tests are excluded from the production import scan so they can create local
fixtures and explicit test sessions; this is not permission for production
code to create a second composition root.

Run the full local gate before handing a candidate off:

```bash
npm ci
npm run verify
npm run test:browser
VITE_BASE_PATH=/Wanderer/ npm run build
```
