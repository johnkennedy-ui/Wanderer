# Game Design MVP

## Status

This is the planned MVP design contract. No Unity gameplay feature described
below is implemented or validated by this document. Unity, Android, and physical
device gameplay results are **NOT YET VERIFIED**.

## Core loop

~~~
Explore -> stop moving -> auto-fight -> collect resources -> build/improve camps
-> defeat boss -> choose one permanent combat upgrade -> explicit campfire save
-> reload the same committed world
~~~

Progress since the most recent explicit campfire save is in memory only. A
process kill, quit, death, pause, focus loss, or scene transition must not turn
that progress into a committed save.

## Player controls and combat

Phase 1 targets one player, one weapon, one normal auto-attack, two
automatic/passive skills, three normal enemy archetypes, one elite, and one
boss. These are scope targets, not current content.

- Movement is on the X/Z plane under an angled top-down camera.
- WASD and a virtual movement stick emit the same gameplay-command shape; mouse
  and touch may differ only for UI.
- A configurable meaningful-motion threshold rejects tiny joystick drift.
- Meaningful movement immediately stops normal basic attack.
- When stationary, the player automatically acquires a valid target and attacks.
- Targeting filters valid/range candidates and uses a stable deterministic
  tie-breaker plus tuneable priority; dead, invalid, or out-of-range targets are
  re-evaluated.
- No click, tap, or manual aim is required for the normal attack.

## World, resources, and progression

The target MVP has one biome, deterministic streamed chunks, an initial safer
territory, multiple deterministic wild campfires, one boss location, and
increasing danger by distance/progression region. The base map is regenerated
from WorldSeed and WorldGeneratorVersion; player-caused changes are saved as
deltas.

Ordinary enemies and elites may repopulate using tuneable data and do not need
individual permanent death deltas. A boss defeat is a permanent delta only after
a valid manual save commits it.

| Tier/source | Resources | Primary use |
| --- | --- | --- |
| Common | Wood, Stone, Metal/Scrap | Construction, building upgrades, workshop upgrades |
| Elite | Essence | Stronger or higher-tier upgrades |
| Boss | Boss Core | Persistent boss reward; future sink may expand |

All loot tables, costs, enemy composition, and upgrade eligibility are authored
data rather than hard-coded save state.

## Camps and buildings

The intended MVP contains five building types with at least three configurable
levels each:

1. Campfire/Camp Core — starts a settlement and is a manual save point.
2. Workshop — provides a simple weapon/combat upgrade function.
3. Farm/Resource Building — provides passive production or a simple benefit.
4. Storage — changes a testable capacity/progression limit.
5. Healer/Infirmary — restores health and/or supports health upgrades.

Only a Campfire can create a new settlement in isolated valid territory. Other
buildings require valid terrain, overlap, slope, and configurable
connection-radius/network checks against their settlement. Placement is freeform,
not grid-locked.

Relocation validates the destination first, preserves building GUID, type, level,
and local state, then applies one transaction. On failure, the old building stays
intact. Demolition gives a configurable partial refund and must not leave unsafe
orphaned settlement state.

## Boss and death contracts

A first boss defeat records runtime boss state, grants Boss Core, presents three
valid non-duplicate upgrade choices, and applies exactly one selected upgrade in
memory. It is durable only at the next explicit campfire save. Upgrade
definitions support additive, multiplicative, and qualitative effects while
selection stays reproducible for debugging.

On death, the target behavior is respawn at the suitable previously committed
home/save point; retain committed buildings, upgrades, boss state, and deltas;
and lose a tuneable share of carried resources (default target: 25%). Death
never writes a save.

## Non-MVP scope and acceptance narrative

Do not add multiplayer, networking, cloud saves, accounts, monetisation, ads,
IAP, leaderboards, social/PvP systems, complex towns, crafting trees, many
biomes, final art/audio, or a live-service backend unless a later scoped
requirement explicitly needs one.

The final route is known-seed exploration, auto-combat, tiered loot, valid and
rejected placement, Campfire settlement creation, upgrade/relocation, chunk
return, boss reward, explicit save, restart/load equality, then force-close
rollback of later unsaved progress — repeated on Android. This is **NOT YET
VERIFIED**.
