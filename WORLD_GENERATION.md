# World Generation and Identity Contract

## Status

This specifies planned deterministic-generation rules. No chunk generator, Unity
scene, streaming implementation, or device performance result exists yet.
Unity/Android/device evidence is **NOT YET VERIFIED**.

## Canonical world and chunk identity

A world is the tuple WorldSeed + WorldGeneratorVersion. WorldSeed is a signed
64-bit value serialized as canonical base-10 text. WorldGeneratorVersion is an
explicit, monotonically managed generation contract version, never an implicit
app build number.

Chunk coordinates are signed X/Z cells obtained by mathematical floor division
of world position by one authored ChunkSize. A chunk owns a half-open area
[minX, maxX) x [minZ, maxZ), so an edge object has one owner.

The canonical UTF-8 chunk key is:

~~~
pcamp/chunk/v1|seed=<signed decimal>|generator=<unsigned decimal>|x=<signed decimal>|z=<signed decimal>
~~~

This string is the durable ChunkId. A SHA-256 digest of its UTF-8 bytes may be a
fixed-width index but cannot be an alternate source of truth.

## Procedural object identity

Every base-world object that can receive a persistent delta uses a deterministic
ID:

~~~
pcamp/object/v1|<ChunkId>|domain=<domain>|definition=<definitionId>|slot=<stable slot>
~~~

Domains include poi, wildCampfire, boss, and oneTimeObject. Stable slot is the
deterministic position in explicitly sorted recipe output, never a Unity
instance ID or incidental GameObject order. Objects that never need a delta need
no durable identity. Player-created buildings use independently generated stable
GUIDs plus persisted chunk lookup; they are not procedural objects.

## Independent random streams

Generation must not use one global random stream. Per chunk/domain derive the
following canonical UTF-8 material:

~~~
pcamp/rng/v1|<ChunkId>|domain=<domain>|subkey=<optional stable key>
~~~

Hash it with SHA-256 and interpret the first 64 bits in documented big-endian
order as a seed for one named deterministic PRNG (for example xoshiro256**).
Consume only that domain stream in explicitly sorted order.

Keep terrain, POIs, wild campfires, bosses, decoration, encounter composition,
and spawn variation separate. Adding decoration therefore cannot shift a boss or
wild campfire. Hash/PRNG vector tests become part of generator compatibility
before WorldGeneratorVersion advances.

## Planned chunk recipe and overlay

For a requested chunk:

1. Derive ChunkId and domain seeds.
2. Generate terrain/obstacle structure.
3. Generate sorted POIs, wild campfires, and boss locations from their domains.
4. Generate encounter/spawn recipe from its domain and distance/progression
   danger function.
5. Assign stable IDs to each persistent candidate.
6. Return data recipe, not authoritative GameObjects.

The MVP target is one biome, multiple variations, deterministic POIs, multiple
wild campfires, one boss location, and safer starting territory. The model must
permit future biomes without changing save ownership.

~~~
base deterministic recipe
  + WorldDeltaStore (defeated/consumed/activated IDs)
  + BuildingStore (GUID records assigned to chunk)
  = loaded chunk projection
~~~

On load, apply deltas before projection, then buildings and transient
populations. On unload, dispose/pool projection only. Ordinary death is
transient/repopulatable; boss defeat becomes persistent only when a manual save
commits it.

## Determinism tests

Future tests must prove same seed/version/coordinate has equivalent recipe
output; chunk request order does not affect output; domain isolation prevents
decoration changes from perturbing POI/campfire/boss/encounter streams; IDs
survive restart/unload; deltas apply only to matching IDs; and changed generator
contract requires explicit version/compatibility handling. All results are
**NOT YET VERIFIED**.
