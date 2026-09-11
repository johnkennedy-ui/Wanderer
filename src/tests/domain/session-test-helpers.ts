import { GameSession } from "../../domain/GameSession";
import type { SaveDocument } from "../../domain/types";
import type { KeyValueStore } from "../../platform/storage/browserSaveStorage";

export const advance = (session: GameSession, seconds: number): void => {
  for (let tick = 0; tick < Math.ceil(seconds * 10); tick += 1)
    session.tick(0.1);
};

export class MemoryStore implements KeyValueStore {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

export const savedAtHome = (): SaveDocument => {
  const request = new GameSession().createValidCampfireSaveRequest(42);
  if (request === null)
    throw new Error("home campfire should issue a save request");
  return request.document;
};

export const placeAndUpgradeTo = (
  session: GameSession,
  kind: "Workshop" | "Farm" | "Healer",
  level: 1 | 2 | 3,
) => {
  const built = session.placeBuilding(kind, { x: 1, y: 1 });
  if (!built.ok || built.building === undefined)
    throw new Error(`could not place ${kind}`);
  let building = built.building;
  while (building.level < level) {
    const upgraded = session.upgradeBuilding(building.id);
    if (!upgraded.ok || upgraded.building === undefined)
      throw new Error(`could not upgrade ${kind}`);
    building = upgraded.building;
  }
  return building;
};
