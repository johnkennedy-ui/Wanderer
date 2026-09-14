/**
 * Stable FNV-1a-derived unit roll for gameplay events. It intentionally uses
 * no mutable PRNG or Math.random so a roll is reproducible from its authored
 * world/event identity across frame partitioning and reloads.
 */
const hashText = (text: string): number => {
  let hash = 2_166_136_261;
  for (const character of text) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

export interface DeterministicRollInput {
  readonly worldSeed: string;
  readonly domain: "physical-crit" | "enemy-dodge";
  readonly eventSerial: number;
  readonly subjectId?: string;
}

/** Returns a deterministic half-open probability value in [0, 1). */
export const deterministicUnitRollFor = ({
  worldSeed,
  domain,
  eventSerial,
  subjectId = "",
}: DeterministicRollInput): number =>
  hashText(`${worldSeed}|${domain}|${subjectId}|${eventSerial}`) / 4_294_967_296;

export const deterministicChanceSucceeds = (
  chance: number,
  input: DeterministicRollInput,
): boolean =>
  chance > 0 &&
  deterministicUnitRollFor(input) < Math.max(0, Math.min(1, chance));
