# Wanderer gameplay MVP

## Repeatable vertical slice

The default seed is `wanderer-known-seed`. The player begins at the home campfire with resources, a nearby scout, an elite, and the Ember Wyrm to the east. Reset creates a new unsaved runtime for the supplied seed, so the scenario can be repeated without world RNG.

WASD, arrows, and the touch stick all issue a normalized movement command. Intent at or above the meaningful-motion threshold immediately stops basic auto-attacks. Releasing input lets the session deterministically select a nearby valid enemy and attack it without mouse aim.

## Combat, danger, and rewards

| Enemy           | Data-defined runtime reward                        |
| --------------- | -------------------------------------------------- |
| Scout           | Wood and Stone                                     |
| Brute           | Stone and Metal / Scrap                            |
| Spitter         | Wood, Stone, and Metal / Scrap                     |
| Elite           | larger common-material bundle plus Essence         |
| Ember Wyrm boss | Boss Core and a three-choice unowned upgrade modal |

World identity, terrain, POI placement, named domains, and object IDs are unchanged by danger. Chunk distance instead deterministically scales enemy health, damage, and ordinary drops from Home through Frontier, Wilds, and Deep Wilds.

Normal and elite enemies respawn after configured delays. The boss does not respawn after runtime defeat. Boss defeat offers exactly three deterministic, distinct, unowned upgrade choices only when three or more remain; it never falls back to owned options. The immutable ten-upgrade pool includes additive damage, multiplicative attack/movement/range effects, health, healing, and **Chain Strike**, which causes a basic hit to resolve a second nearby target at 50% damage.

Selecting an upgrade and gaining a Boss Core change runtime state immediately. They become durable only after a later manual campfire save.

## Resources and storage

The only resource keys are `wood`, `stone`, `scrap`, `essence`, and `bossCore`. The UI labels `scrap` as **Metal / Scrap**. Wood, Stone, Metal / Scrap, and Essence have one enforced per-material capacity. Boss Core is a real saved resource and is deliberately exempt from Storage capacity. Capacity applies to enemy drops, Farm harvests, and demolition refunds.

## Buildings and settlement rule

Every building has a stable session-generated ID, three levels, data-driven costs, and a visible description. Placement validates before it changes any resource or record. Invalid terrain, overlaps, unaffordable cost, and an ordinary building outside the applicable campfire radius reject atomically.

| Type     | L1                          | L2                              | L3                                          |
| -------- | --------------------------- | ------------------------------- | ------------------------------------------- |
| Campfire | 6m build radius, save point | 9m build radius, save point     | 12m build radius, save point                |
| Workshop | +4 basic attack damage      | +9 basic attack damage          | +15 basic attack damage                     |
| Farm     | 2 Wood + 1 Stone / 2s       | 4 Wood + 2 Stone + 1 Scrap / 2s | 6 Wood + 3 Stone + 2 Scrap + 1 Essence / 2s |
| Storage  | 180 each common material    | 260 each common material        | 360 each common material                    |
| Healer   | +1 campfire health/s        | +3 campfire health/s            | +6 campfire health/s                        |

Relocation validates the destination before replacing the old record. Demolition removes only the selected building and returns 50% of its invested resources, subject to current common-material capacity. No building action automatically saves.

## Death and explicit saves

The visible campfire save action is the only persistence authority. A death does not commit anything: it returns the player to the last committed save-point identity and position, restores health, and removes the configured 25% of every carried resource (rounded down). Unsaved boss defeat, Boss Core, upgrades, buildings, and movement disappear when the browser reloads the last committed campfire document.
