# Wanderer gameplay MVP

## Repeatable vertical slice

The default seed is `wanderer-known-seed`. The player begins at the home
campfire with resources, a nearby scout, an elite, and the Ember Wyrm to the
east. Reset creates a new unsaved runtime for the supplied seed, so the scenario
can be repeated without world RNG.

WASD, arrows, and the touch stick all issue a normalized movement command.
Intent at or above the meaningful-motion threshold immediately stops basic
auto-attacks. Releasing input lets the session deterministically select a
nearby valid enemy and attack it without mouse aim.

## Combat, enemies, and rewards

| Enemy           | Runtime reward                    |
| --------------- | --------------------------------- |
| Scout           | wood plus Forager's Instinct wood |
| Brute           | wood and ore                      |
| Spitter         | wood, ore, and food               |
| Elite           | larger mixed resource drop        |
| Ember Wyrm boss | Boss Core and a reward modal      |

Normal and elite enemies respawn after configured delays. The boss does not
respawn after runtime defeat. Boss defeat presents exactly three distinct
choices; selecting one applies it now but it becomes durable only at a later
manual campfire save.

The always-visible passive feedback includes **Hearth Ward** (campfire healing)
and **Forager's Instinct** (extra normal-kill wood). Workshop/Farm and selected
boss upgrades add further readable effects.

## Buildings and settlement rule

Every building has a stable session-generated ID, three levels, data-driven
costs, and a visible description. Placement validates before it changes any
resource or record. Invalid terrain, overlaps, unaffordable cost, and an
ordinary building beyond 6m of a campfire all reject atomically.

| Type     | Levelled effect                            | Placement rule             |
| -------- | ------------------------------------------ | -------------------------- |
| Campfire | settlement bootstrap and manual save point | valid isolated location    |
| Workshop | +4 basic damage per level                  | within any campfire radius |
| Farm     | stationary recovery                        | within any campfire radius |
| Storage  | visible settlement capacity concept        | within any campfire radius |
| Healer   | stronger campfire healing                  | within any campfire radius |

Relocation validates the destination before replacing the old record.
Demolition removes only the selected building and returns 50% of its invested
costs. No building action automatically saves.
