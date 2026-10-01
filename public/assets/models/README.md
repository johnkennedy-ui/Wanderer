# Wanderer low-poly model pack

These are dependency-free, static GLB meshes designed around the current
Wanderer browser MVP: a top-down Three.js survival game with strong silhouettes,
short combat read distances, and a forest / ember / bronze palette.

## Files

| Group | Runtime ID | Asset |
| --- | --- | --- |
| Projectile | Knight crescent slash | `projectile_knight_blade_arc.glb` |
| Projectile | Wizard flame orb | `projectile_wizard_flame_orb.glb` |
| Projectile | Archer arrow | `projectile_archer_arrow.glb` |
| Enemy | `scout` | `enemy_scout.glb` |
| Enemy | `brute` | `enemy_brute.glb` |
| Enemy | `spitter` | `enemy_spitter.glb` |
| Enemy | `elite` | `enemy_elite.glb` |
| Enemy | `boss` / Ember Wyrm | `enemy_ember_wyrm.glb` |
| Player class | `knight` | `player_knight.glb` |
| Player class | `wizard` | `player_wizard.glb` |
| Player class | `archer` | `player_archer.glb` |
| Building | `Campfire` | `building_campfire.glb` |
| Building | `Workshop` | `building_workshop.glb` |
| Building | `Farm` | `building_farm.glb` |
| Building | `Storage` | `building_storage.glb` |
| Building | `Healer` | `building_healing_hut.glb` |
| Building | `ArcherTower` | `tower-expansion-v1/tower_archer.glb` |
| Building | `SwordTower` | `tower-expansion-v1/tower_sword.glb` |
| Building | `MageTower` | `tower-expansion-v1/tower_mage.glb` |
| Tower projectile | Ballista bolt | `tower-expansion-v1/projectile_ballista_bolt.glb` |
| Tower projectile | Crystal bolt | `tower-expansion-v1/projectile_crystal_bolt.glb` |

The meshes use embedded PBR base-color materials with no external texture
files, so each GLB can be loaded independently with Three.js `GLTFLoader`.
The three tower models retain their embedded `idle` and `attack` clips; during
an attack cue only their named `aim_pivot` rotates.

The source generator is kept at `tools/generate_wanderer_models.py` so the
pack can be regenerated or edited without a model-generation service.
