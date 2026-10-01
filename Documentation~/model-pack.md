# Wanderer model assets

## 2026-09-22 real 3D asset pack

The user-supplied `Wanderer_Real_3D_Asset_Pack_2026-09-22.zip` contains 48 GLB
models and inventories 74 embedded animation clips. Its SHA-256 is
`eb836e2ec5bd97808818adb21f0f641cd54209eb91e629753e454658186edd05`. The pack
has no separate license file or explicit license terms; no license is asserted
here.

Thirty GLBs replace the bytes at existing renderer-mapped public paths; runtime
mappings and gameplay authority are unchanged. Five of the 18 additional models
are installed under `public/assets/models/tower-expansion-v1/`: Archer, Sword
and Mage towers plus ballista and crystal bolts. Their manifest records the
source archive and individual byte hashes. The remaining 13 wall, projectile,
weapon, pickup and effect models remain outside `public/` for later review and
are not part of the shipped asset set. The original supplied archive remains the
source of truth.

The archive also contains 53 PNGs and one GIF under `previews/`. These are
previews, not verified runtime sprites or sprite sheets; this update adds no
sprite assets. The mapped towers retain their embedded `idle` and `attack`
clips in the renderer cache. During a tower attack cue the renderer applies the
`attack` clip and rotates only the model's `aim_pivot`; the grounded base stays
static. Those clips remain presentation-only: domain mechanics, IDs, saves and
world generation remain authoritative outside the renderer.

The installed and held GLBs were checked byte-for-byte against the supplied
manifest hashes and for GLB v2 headers and declared file lengths. Browser
integration must still be described from the candidate-bound production browser
results; those results do not establish GPU or native-device behavior.

## Historical generated model pack

The earlier `model-pack.zip` import and `Tools~/generate_wanderer_models.py`
remain historical provenance for the original generated assets. The previous
notes about that pack's static meshes, 16 files, and regeneration procedure do
not describe the 2026 real 3D pack or the current bytes at paths replaced by it.
The persistent building ID `Healer` continues to use the Healing Hut
presentation; this asset update does not rename or migrate that ID.

Focused asset tests in `src/tests/assets/modelPack.test.ts` parse GLB headers,
chunks, buffer views, accessors, position bounds, and primitive indices.

## 2026-09-25 run-animation pack

`Wanderer_Run_Animation_Pack_2026-09-25.zip` is retained outside the repository
as the supplied source archive. Its SHA-256 is
`d64ef6ed68caeda7952e3c7aea5e3fa7acea3654c0bdbfc6493c124948b4640d`.
The eight actor GLBs are installed under `public/assets/models/run-animation-v1/`
with their individual byte hashes and clip names in that directory's manifest.

The renderer retains embedded GLTF clips for actor instances and advances them
from `presentationElapsed`: `run` while an actor's rendered position is moving,
`idle` while it is stationary, and `attack` for an active attack cue. If a
future mapped actor has no `run` clip, it falls back to `move`; if it has no
usable actor clip, the prior procedural pose path remains active. These are
presentation-only animations: movement, collisions, combat, saves, IDs and
world generation remain domain-owned.
