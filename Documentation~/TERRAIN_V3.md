# V3 terrain

Fresh and explicitly reset worlds use `wanderer-web-v3`. Loading an existing
V1/V2 save retains its recorded generator, layouts, IDs, movement and placement
rules. No save schema, storage key or manual-campfire-save transition changes.
Resetting a world is an explicit gameplay action, not a save migration.

V3 recipes provide low-poly tree trunks/canopies, mountain and rock footprints,
river cells and connected lake lobes. The renderer projects the recipe's kind
and radius; the domain alone resolves movement and building placement. Tree
collision follows the trunk, not its overhanging foliage. Mountains, rocks and
water use their ground footprints. Nearby chunk recipes participate in collision
and placement so footprints do not end at chunk borders.

Water is generated before solid scenery. Deterministic ford bands preserve
crossings and authored actor approaches; scenery does not independently remove
water cells. Entire lake groups are accepted or rejected. Seeded recipes are
independent of chunk traversal order. V1/V2 generators remain unchanged.

The shared swept-circle movement query constrains keyboard, canvas-destination
and enemy pursuit movement. Blocked canvas destinations terminate rather than
continually requesting movement through a footprint. Players can retreat from a
collision. Terrain does not add swimming, climbing, harvesting or automatic path
finding: choose a clear approach or a river crossing using the existing controls.

Projection resources are shared for the renderer lifetime; departed terrain
objects are removed, and renderer disposal releases their geometry/materials.
The ground plane follows the player. Existing model-pack GLBs remain unchanged.

## Verification coverage

Domain tests cover seeded generation, connected water/actor clearance,
neighbor-chunk placement, swept collision, retreat, real session movement and
enemy constraints. Renderer tests cover typed footprints, unchanged legacy
markers and grouped-mesh lifetime. Browser terrain scenarios use validated save
fixtures, real keyboard/canvas input, placement rejection and a generated river
crossing, with screenshots and browser-fault capture on desktop and touch-sized
profiles. The canonical browser command builds and tests both `/` and
`/Wanderer/`. Execution evidence and final candidate identity are recorded by the
mission owner; this document alone is not evidence of acceptance or deployment.
