# M5: shared recipes and retained presentation

This document describes the composed implementation, not a release verdict.
Normalization and independent browser/review evidence must bind the final
candidate; results from the earlier M5 base do not transfer automatically.

## Recipe ownership and bounds

Each GameSession owns a deterministic LRU keyed by seed, generator version and
both chunk axes. Visible-world, enemy-neighbourhood, campfire, building-radius
and terrain queries share its narrow recipe function. Standalone helper callers
retain a pure `generateChunk` default. Inputs are copied and recipes deeply
frozen; runtime enemy drafts copy mutable positions rather than acquiring recipe
authority. Recipes and counters are not persisted.

Capacity 27 holds three 3x3 neighbourhoods: a fixed allowance for visibility and
nearby revisits, not the full exploration history or a measured optimal memory
budget. Hits refresh insertion order. Misses count attempted generation calls,
including rejected versions; failed generation inserts no recipe. Identity
replacement and explicit reset clear entries and counters. Diagnostics expose
capacity, hits, misses, size and evictions without warming the cache.

Both released generators remain supported and current new/reset v2 selection is
preserved. Eviction never removes enemy deltas or changes pursuit, progression,
passive healing, save rules or other gameplay policy. The fixed-step soak records
actual cache maxima and deterministic durable state; it is not an FPS benchmark.

## Retained renderer

A player mesh and seven keyed maps retain obstacles, campfires, buildings,
Healing Hut auras, enemies, projectiles and floor drops. Departed IDs detach;
finite equivalent geometry/material variants remain instance-owned until final
disposal. Level/style/recovery changes select suitable shared variants without
recolouring unrelated meshes. No module-level resource registry is introduced.

Current aura radii/materials, projectile styles and hit-recovery flash/reset are
preserved. Legacy cylinders remain at their actual Y=0; auras use Y=0.025,
projectiles Y=0.72 and drops Y=0.24. Camera tuning and raycast contracts remain;
camera matrices are explicitly refreshed before projecting the health label,
rather than relying on a previous WebGL-render side effect. Browser checks must
cover the label during movement as well as the current visual variants.

Identical warm frames must create no additional geometry, material or mesh.
Visible maps remain bounded by current visible IDs, while resource variants are
bounded by authored presentation variants. Removal is distinct from disposal:
Three meshes detach, and each owned geometry/material is disposed exactly once.
Adapter teardown also releases its floor, observer, label, canvas and WebGL
renderer once; disposed owners cannot recreate their presentation.

## DOM ownership and current UI

Building-ID rows retain nodes and listeners. Changed values update their own
row; reordered or removed IDs are reconciled without rebuilding unchanged rows.
Listeners use the latest ID/kind and begin current canvas placement, including
relocation; no legacy coordinate-input path is restored. Effects rebuild only
when their value signature changes. Existing upgrade-choice keys remain intact,
and equal text/attribute writes are skipped where practical.

The targeted lists are buildings and effects, as specified by M5. This does not
claim zero mutation for the entire newer HUD. Current resource/skill panels,
class choices, icon controls, Healing Hut labels, placement cancellation and
manual-save behaviour remain preserved. Browser assertions inspect their current
public labels/counts/capacity fields rather than obsolete visible label text.

## Verification boundary

CPU tests exercise actual Three resource objects with a narrow mocked WebGL
adapter; UI tests use DOM-operation doubles. Neither proves GPU appearance,
physical-device behaviour or FPS. Real desktop/touch browser cases run at both
root and `/Wanderer/` paths with trusted input and the existing public progression
preconditions. No hidden gameplay hooks or implicit save route are added.

Keep historical save/world fixtures and M4 evidence unchanged. Verify the final
composed source, full/soak suites, allocation and mutation invariants, reproducible
builds and complete browser error evidence before independent acceptance and
publication. Native Android and later M6-M9 objectives remain separate work.
