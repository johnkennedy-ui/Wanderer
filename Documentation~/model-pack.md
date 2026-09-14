# Wanderer static model pack

The task-supplied `model-pack.zip` is installed verbatim under
`public/assets/models/`: its 16 `.glb` files, `README.md`, and
`model-manifest.json` retain their supplied names and content. The archive did
not include licensing information, so no license is asserted here.

The pack contains static low-poly geometry with embedded PBR base-color
materials. It contains no animation, skinning, external texture URI, or
external buffer URI. The manifest is the complete mapping for projectiles,
enemies, player classes, and buildings. The historical runtime building ID
`Healer` maps to `building_healing_hut.glb` (the Healing Hut presentation).

`Tools~/generate_wanderer_models.py` is the supplied standard-library-only
generator with its destination adapted to `public/assets/models/`. It accepts
one optional output directory, allowing deterministic reproduction without
overwriting tracked assets:

```bash
python3 Tools~/generate_wanderer_models.py .vite/generated-models
cmp public/assets/models/player_knight.glb .vite/generated-models/player_knight.glb
```

Focused tests in `src/tests/assets/modelPack.test.ts` verify that every manifest
mapping resolves exactly once and parse each GLB's header, chunks, buffer
views, accessors, position bounds, and primitive indices.
