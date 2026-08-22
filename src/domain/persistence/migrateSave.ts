import type { CurrentSave } from "./currentSave";
import type { SaveV2Document } from "./saveV2";

/**
 * Pure in-memory migration from the released V2 DTO to the current model.
 * It deliberately performs no persistence or GameSession mutation.
 */
export const migrateSaveV2 = (document: SaveV2Document): CurrentSave => ({
  schemaVersion: 2,
  world: {
    seed: document.world.seed,
    generatorVersion: document.world.generatorVersion,
  },
  player: {
    position: { x: document.player.position.x, y: document.player.position.y },
    hp: document.player.hp,
    maxHp: document.player.maxHp,
  },
  resources: {
    wood: document.resources.wood,
    stone: document.resources.stone,
    scrap: document.resources.scrap,
    essence: document.resources.essence,
    bossCore: document.resources.bossCore,
  },
  buildings: document.buildings.map((building) => ({
    id: building.id,
    kind: building.kind,
    position: { x: building.position.x, y: building.position.y },
    level: building.level,
  })),
  defeatedBossIds: [...document.defeatedBossIds],
  upgrades: [...document.upgrades],
  nextBuildingSerial: document.nextBuildingSerial,
  committedAt: document.committedAt,
  savePointId: document.savePointId,
  savePointPosition: {
    x: document.savePointPosition.x,
    y: document.savePointPosition.y,
  },
});
