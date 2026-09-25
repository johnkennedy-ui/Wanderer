# Wanderer model assets

## 2026-09-22 real 3D asset pack

The user-supplied `Wanderer_Real_3D_Asset_Pack_2026-09-22.zip` contains 48 GLB
models and inventories 74 embedded animation clips. Its SHA-256 is
`eb836e2ec5bd97808818adb21f0f641cd54209eb91e629753e454658186edd05`. The pack
has no separate license file or explicit license terms; no license is asserted
here.

Thirty GLBs replace the bytes at existing renderer-mapped public paths; runtime
mappings and gameplay authority are unchanged. The 18 additional tower, wall,
projectile, weapon, pickup, and effect models have no current model mapping and
are being held outside `public/` for later review. They are not part of the
shipped asset set. The original supplied archive remains the source of truth.

The archive also contains 53 PNGs and one GIF under `previews/`. These are
previews, not verified runtime sprites or sprite sheets; this update adds no
sprite assets. The pack's embedded clips are not evidence of animation
playback: the current renderer uses its existing procedural poses, and this
asset update does not add clip playback.

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
