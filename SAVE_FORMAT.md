# Save Format and Commit Contract

## Status

This is a planned persistence contract, not an implemented serializer. Save
execution, Unity load/save behavior, Android storage behavior, and device
recovery behavior are **NOT YET VERIFIED**.

## Manual-only save semantics

The MVP has one local save for the active world, structured so a future slot ID
can select a separate root. The committed save is the last successful explicit
manual campfire save, not a log of all runtime mutations.

Only an explicit player action at a currently valid home Campfire, player-built
Campfire, or deterministic wild campfire may request a commit. Enemy death, loot
pickup, building placement/upgrade/relocation/demolition, boss death, scene
transition, pause, focus loss, quit, timer, and chunk unload must never call the
commit path.

## Versioned save-data model

A readable JSON format is acceptable initially if performance permits. These
field semantics are required even if the representation changes.

~~~json
{
  "saveVersion": 1,
  "worldGeneratorVersion": 1,
  "worldSeed": "signed-64-bit decimal string",
  "slotId": "active-world",
  "commitId": "unique commit ID",
  "createdUtc": "ISO-8601",
  "savedUtc": "ISO-8601",
  "integrity": { "algorithm": "SHA-256", "payloadHash": "..." },
  "player": {
    "committedPosition": { "x": 0, "y": 0, "z": 0 },
    "health": 0,
    "weaponProgression": {},
    "permanentCombatUpgradeIds": [],
    "resources": {},
    "storageProgression": {}
  },
  "buildings": [{
    "buildingGuid": "stable GUID",
    "typeId": "authored definition ID",
    "settlementId": "stable camp GUID",
    "position": { "x": 0, "y": 0, "z": 0 },
    "rotation": { "y": 0 },
    "level": 1,
    "state": {}
  }],
  "worldDeltas": {
    "defeatedBossIds": [],
    "consumedOneTimeObjectIds": [],
    "discoveredOrActivatedIds": []
  },
  "savePoint": {
    "id": "stable campfire ID",
    "kind": "home|playerCampfire|wildCampfire",
    "respawn": { "x": 0, "y": 0, "z": 0 }
  }
}
~~~

WorldSeed and WorldGeneratorVersion are mandatory reconstruction inputs. The
document intentionally excludes terrain meshes, ordinary transient enemies,
pools, GameObjects, Unity instance IDs, and uncommitted changes.

## Snapshot validation

At a valid manual save, GameSession produces a deep immutable snapshot.
Validation rejects at least missing IDs, duplicate building GUIDs, unknown
definition IDs, invalid numbers, invalid settlement references, unsupported
versions, and integrity mismatch. Failure leaves the prior committed save
untouched and surfaces a save failure.

Boss defeat and permanent upgrade selection can change runtime state but are
durable only after this exact commit succeeds. Losing the process first reloads
the previous snapshot, including a previously living boss when appropriate.

## Atomic backup save model

All slot files live in one storage directory so the platform adapter can use
same-volume atomic replacement:

~~~
save.json          current committed primary
save.backup.json   independently validated known-good predecessor
save.tmp           candidate only; never authoritative
~~~

Commit sequence:

1. Confirm a valid explicit campfire request and capture an immutable snapshot.
2. Serialize to save.tmp, flush as supported, parse it back, validate schema and
   payload hash.
3. If a primary exists, validate it; produce and validate a durable backup
   candidate; atomically replace save.backup.json. If this cannot preserve a
   known-good backup, do not replace the primary.
4. Atomically replace save.json with the validated temporary file, then flush
   file/directory metadata where supported.
5. Report UI success only after replacement succeeds.

Use supported atomic-replace APIs, not delete-then-move. A crash before step 4
leaves the old primary; a crash after it leaves a valid new primary and known-good
predecessor. Temporary files are ignored or only cleaned after
primary/backup validation.

## Load, recovery, and migration

1. Validate primary schema, integrity, and referenced definition/generator
   versions.
2. If valid, regenerate base world from seed/version and apply deltas, buildings,
   player state, resources, upgrades, and save point.
3. If primary is invalid, validate backup; if valid, load it with a visible
   recovery notice and do not silently overwrite it.
4. If both fail, fail safely without overwrite and offer a recover/new-world
   decision.

Unsupported future saveVersion or unknown generator version fails safely.
Migrations are explicit, deterministic, tested, and write a new snapshot through
the same backup-preserving path. A generator-version mismatch must preserve
structural compatibility or reject the load; it must never silently regenerate a
different world.

## Acceptance requirements

- Save/load equality covers required player state, resources, buildings,
  building-local state, permanent upgrades, boss/world deltas, and save point.
- Primary corruption recovers from backup; interrupted temp write cannot destroy
  primary.
- A save outside a valid campfire causes no storage mutation.
- Android pause/resume/forced-loss must restore only the last commit. This
  physical-device result is **NOT YET VERIFIED**.
