import { describe, expect, it } from "vitest";
import { GameSession } from "../../domain/GameSession";
import { emptyPlayerStatAllocations } from "../../domain/types";
import { savedAtHome } from "./session-test-helpers";

const sessionWithProgression = (
  experience: number,
  playerClass: "knight" | "wizard" | null,
) =>
  new GameSession({
    saved: {
      ...savedAtHome(),
      classProgression: {
        experience,
        level: experience >= 20 ? 2 : 1,
        playerClass,
        skillIds: [],
        allocatedStats: emptyPlayerStatAllocations(),
        weaponRank: 0,
      },
    },
  });

const enemyFor = (session: GameSession, id: string) => {
  const enemy = session.diagnostics().enemies.find((entry) => entry.id === id);
  if (enemy === undefined) throw new Error(`expected ${id}`);
  return enemy;
};

describe("GameSession enemy health scaling", () => {
  it("refreshes materialized world enemies on class selection and preserves health fraction", () => {
    const session = sessionWithProgression(20, null);
    expect(enemyFor(session, "enemy:starter-scout")).toMatchObject({
      hp: 24,
      maxHp: 24,
      spawnHealthMultiplier: 1,
    });

    for (let step = 0; step < 8; step += 1) session.tick(0.1);
    expect(enemyFor(session, "enemy:starter-scout")).toMatchObject({
      hp: 12,
      maxHp: 24,
    });

    expect(session.chooseClass("knight")).toBe(true);
    expect(enemyFor(session, "enemy:starter-scout")).toMatchObject({
      hp: 26.4,
      maxHp: 52.8,
      spawnHealthMultiplier: 1,
    });
  });

  it("refreshes retained enemies when earned experience crosses a level", () => {
    const session = sessionWithProgression(19, "knight");
    expect(enemyFor(session, "enemy:starter-brute").maxHp).toBe(38);

    for (let step = 0; step < 12; step += 1) session.tick(0.1);
    expect(session.presentation().ui.classProgression.level).toBe(2);
    expect(enemyFor(session, "enemy:starter-brute").maxHp).toBe(52.8);
  });

  it("does not rescale materialized enemies for optional skill or stat power", () => {
    const session = sessionWithProgression(20, "wizard");
    const before = enemyFor(session, "enemy:starter-scout");

    expect(session.chooseClassSkill("wizard-flame-orb")).toBe(true);
    expect(session.allocateStat("magic")).toBe(true);

    const after = enemyFor(session, "enemy:starter-scout");
    expect(after.maxHp).toBe(before.maxHp);
    expect(after.hp).toBe(before.hp);
  });
});
