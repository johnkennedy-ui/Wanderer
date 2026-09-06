# M4: deterministic soak and retained-runtime evidence

Status: root Node 22 normalization and regression checks passed; independent
verification and release gates remain pending. The measurements below are
finite scenario observations, not a universal runtime-state bound.

## Product decision and compatibility

On 2026-09-06 at 15:06 BST the user decided: “Alright. Keep global chase for now
and continue.” This supersedes the incompatible original M4 pruning acceptance
only. Every retained non-defeated enemy continues global pursuit, even outside
the player's visible 3x3 neighbourhood. No activation radius, deletion, pause,
canonical reset, respawn change, or combat-order change is introduced.

**Pruning is DEFERRED, not passed. Enemy memory is not universally bounded.**
Visiting additional chunks retains additional canonical enemies, including
untouched entries. Moved/damaged enemies, defeated normal enemies awaiting
respawn, and defeated boss entries retain the existing semantics. Player-built
state and uncollected drops can also grow. Scenario maxima below are finite-run
observations only, not asymptotic memory bounds or heap-byte measurements.

Production changes consist only of GameSession's immutable diagnostic copy-out
and its pure projection owner. No save schema, storage keys, IDs, fixtures,
generator recipes, gameplay tuning, hydration, or persistence policy changed.
No M5 cache, renderer work, storage port, rules profile or later mission work is
included.

## Diagnostic contract

`GameSession.diagnostics()` is an opt-in evidence query, not a presentation port.
It copies world identity, player/resources/buildings, ordered runtime enemies
(including map keys and spawn positions), projectiles, drops, persistent ID
sets, pending choices, input/destination, save point, simulation timers, and
next serials into recursively frozen plain objects/arrays. It exposes no live
Map/Set, nested vectors or arrays. Ordinary UI/rendering consumers are unchanged.
Enemy/projectile/drop array order is deliberately preserved to detect ordering
drift. Hashing sorts object keys only; it does not round away floating-point
changes or sort meaningful simulation arrays. SHA-256 is test-only Node crypto.

Counts mean:

- `activeEnemies`: all retained non-defeated enemies, not just renderer-visible.
- `retainedEnemyDeltas`: the entire retained runtime enemy Map size, including
  canonical entries; the name does not imply a sparse/pruned delta store.
- `projectiles` and `floorDrops`: current retained array lengths.
- `cachedChunks`: zero because no retained recipe cache exists in M4. The 3x3
  generated recipe projection is transient, not a nine-entry cache.

Query cost is proportional to retained state. Diagnostics must not become an
ordinary UI dependency or an additional mutable authority. Old snapshots remain
unchanged after ticks and reset; attempted caller mutation cannot alter play.

## Deterministic schedule

Existing default rules and seed `wanderer-known-seed`, generator
`wanderer-web-v1`; no private state hooks, teleportation, sleeps, random commands,
or accelerated balance profiles. Each run has 4,160 ticks of 0.1 seconds. Two
2,080-step halves repeat this command schedule (indices are half-local):

| Steps    | Command                                                           |
| -------- | ----------------------------------------------------------------- |
| 0–199    | stationary auto-combat                                            |
| 200–279  | east                                                              |
| 280–439  | west                                                              |
| 440–519  | east                                                              |
| 520–599  | north                                                             |
| 600–759  | south                                                             |
| 760–839  | north                                                             |
| 840–2079 | repeatedly request home destination; stationary combat on arrival |

A Workshop is placed at (1,1) before the run and demolished at absolute step
200 through public commands; both must succeed. Movement is reissued every
scheduled step so death's input reset cannot silently cancel the remaining
schedule. Actual chunk visits/revisits are measured, not inferred from intent.
Positive/negative X and Y chunk visits, projectile/drop maxima above zero, and
retained-enemy growth above initial materialization are test assertions.

`deathReturns` counts observed >1m jumps to home at full health: a lower-bound
observation of actual death/respawn, not every death (deaths already at home are
not counted). The schedule asserts at least one such observed return. If that
coverage or any traversal assertion fails under Node 22, revise the public
command fixture and rerun; never change gameplay or silently relabel a failure
as a pass. Existing death/respawn policy suites remain regression gates.

At every tick, finite-number checks run before canonical JSON can mask NaN or
infinity as null. Checks cover resources, player health, enemy health/stat/timer
consistency, IDs/map keys, allocated serials and collision evidence, projectile
targets, floor-drop resources, buildings, and count consistency. Defeated enemy
HP can legitimately be negative after overkill until respawn: this existing
behavior is explicitly characterized, not "fixed" by diagnostics.

## Manual save midpoint: exact comparison boundary

At absolute step 2,080, require a valid campfire save request, use fixed
`committedAt = 2080`, and acknowledge the simulated explicit commit with
`recordSaveCommitted`. No storage adapter is used and no implicit save occurs.
Construct a new GameSession from that document and request a save again without
advancing time. Canonical hashes of the **entire durable document** must match,
including position/health, resources, buildings, boss/upgrades, world identity,
next building serial, save point and timestamp.

Hydration intentionally resets enemies from current visible recipes,
projectiles, drops, elapsed time, attack/harvest timers, runtime serials, input
and pending upgrade choices. Tests explicitly check the runtime reset. Full
runtime equality across hydration, or identical later durable resources after
divergent combat, is NOT promised by schema 2 and is not asserted.

The uninterrupted route continues the original instance; the reload route
continues the hydrated instance. Each route runs twice and must independently
produce the same final diagnostic hash, midpoint hashes, maxima, growth
checkpoints, chunk visits and death-return observations. This does not establish
a cross-platform floating-point guarantee or substitute for historical/golden
fixture and browser regression tests.

## Evidence capture and root handoff

Run `npm run test:soak` under the repository's Node 22 toolchain. Capture each
`M4_SOAK_EVIDENCE` JSON line from the successful run. It includes step count,
step size, route, final SHA-256, durable midpoint and hydrated SHA-256, reset
result, maxima for every runtime count, initial/final retained counts, growth,
280-step retained checkpoints, visited chunks, revisits and death returns.
These values are emitted only after repeated-run and coverage assertions pass.

Root validation on 2026-09-06 under Node 22.23.2: 33 focused tests and 137
full-suite tests passed; format, typecheck, architecture, build/rebuild and
44 built-browser cases (22 each at `/` and `/Wanderer/`) passed. All eight
schema-v2/generator-v1 fixture files are byte-identical to accepted M3.

| Scenario        | Initial retained | Final retained | Maximum retained | Maximum active | Maximum projectiles | Maximum drops |
| --------------- | ---------------: | -------------: | ---------------: | -------------: | ------------------: | ------------: |
| Uninterrupted   |               28 |            100 |              100 |             99 |                   1 |            28 |
| Midpoint reload |               28 |             93 |              100 |             99 |                   1 |            28 |

Both routes' repeated evidence matched. The uninterrupted run observed seven
death returns; the reload route observed eleven. These are lower-bound event
observations, not universal guarantees. The focused run took 24.62 seconds on
the validation host; this is an observation, not a CI timing threshold.

Final hashes:

- Uninterrupted: `a932c26ff1b2cdc496cf41aaaf370b87f49766d486b8e0239d337addcf0d0ef5`
- Reloaded: `a0ce2fafc2cbf294f45632f45358f506b6ebe8035dfc373502a2e6a5bd937b8f`
- Durable midpoint before/after hydration: `eaf97b32419d1a84987e2fc2be6ffd86e2aee64d6d0c426fb1991cac610ef72d`

The existing production bundle warning above 500 kB remains; no new bundle-limit
waiver or native Android validation is implied by these checks.

Root owns changed-file formatting normalization, focused/full verification,
built-output browser regression, compatibility fingerprints and distinct
Luna/QA/Sol review before integration. A larger opt-in variant is not introduced
without first measuring this CI-sized route. No commit, push, integration,
deployment, install or native Android action was performed by the worker.
