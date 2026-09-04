import { upgradeDefinitions } from "../../data/definitions";
import type { UpgradeId } from "../types";

const hashText = (text: string): number => {
  let hash = 2_166_136_261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

/**
 * Returns exactly three deterministic, distinct, currently unowned choices.
 * It deliberately offers no fallback when fewer than three upgrades remain.
 */
export const selectBossUpgradeChoices = (
  seed: string,
  owned: Iterable<UpgradeId>,
): UpgradeId[] => {
  const ownedIds = new Set(owned);
  const available = upgradeDefinitions
    .map((upgrade) => upgrade.id)
    .filter((id) => !ownedIds.has(id));
  if (available.length < 3) return [];
  const start = hashText(`${seed}|boss:ember-wyrm`) % available.length;
  return [0, 1, 2].map(
    (offset) => available[(start + offset) % available.length],
  );
};
