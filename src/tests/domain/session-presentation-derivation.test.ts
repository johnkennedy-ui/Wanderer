import { describe, expect, it } from "vitest";
import { gameplayTuning } from "../../data/definitions";
import { GameSession } from "../../domain/GameSession";
import { playerHitRecoveryPresentationFor } from "../../domain/session/hitRecoveryPolicy";
import { presentationDerivationFor } from "../../domain/session/presentationDerivation";
import {
  describeProgressionEffects,
  pendingClassSkillChoicesFor,
  playerStatsFor,
  statPointsAvailableFor,
} from "../../domain/session/progressionRules";
import type { ChunkRecipeSource } from "../../domain/session/chunkRecipeCache";
import {
  emptyPlayerStatAllocations,
  type ClassProgression,
  type UpgradeId,
  type WorldIdentity,
} from "../../domain/types";
import { generateChunk, WANDERER_WEB_V3 } from "../../domain/world";
import { savedAtHome } from "./session-test-helpers";

const progressionFor = (
  level: ClassProgression["level"],
  playerClass: ClassProgression["playerClass"],
  skillIds: ClassProgression["skillIds"] = [],
): ClassProgression => ({
  experience: [0, ...gameplayTuning.experienceThresholds][level],
  level,
  playerClass,
  skillIds,
  allocatedStats: emptyPlayerStatAllocations(),
});

const expectedFor = (
  input: Parameters<typeof presentationDerivationFor>[0],
) => ({
  playerStats: playerStatsFor(input.classProgression),
  playerHitRecovery: playerHitRecoveryPresentationFor({
    elapsed: input.elapsed,
    recoveryEndsAt: input.recoveryEndsAt,
    recoverySeconds: gameplayTuning.playerHitRecoverySeconds,
    flashIntervalSeconds: gameplayTuning.playerHitRecoveryFlashIntervalSeconds,
  }),
  effects: describeProgressionEffects(
    input.buildings,
    input.upgrades,
    input.classProgression,
  ).filter((effect) => !effect.startsWith("Storage")),
  pendingClassChoices:
    input.classProgression.playerClass === null &&
    input.classProgression.level >= 1
      ? ["knight", "wizard", "archer"]
      : [],
  pendingClassSkillChoices: pendingClassSkillChoicesFor(input.classProgression),
  statPointsAvailable: statPointsAvailableFor(input.classProgression),
});

const verifySessionDerivation = (
  session: GameSession,
  recoveryEndsAt: number,
) => {
  const presentation = session.presentation();
  const before = session.diagnostics();
  const input = {
    elapsed: presentation.renderer.presentationElapsed,
    recoveryEndsAt,
    buildings: presentation.ui.buildings,
    upgrades: new Set(before.upgrades),
    classProgression: presentation.ui.classProgression,
  };
  const inputBefore = JSON.stringify({
    buildings: input.buildings,
    upgrades: [...input.upgrades],
    classProgression: input.classProgression,
  });

  const derived = presentationDerivationFor(input);
  expect(derived).toEqual(expectedFor(input));
  expect(presentation.ui.playerStats).toEqual(derived.playerStats);
  expect(presentation.renderer.playerHitRecovery).toEqual(
    derived.playerHitRecovery,
  );
  expect(presentation.ui.effects).toEqual(derived.effects);
  expect(presentation.ui.pendingClassChoices).toEqual(
    derived.pendingClassChoices,
  );
  expect(presentation.ui.pendingClassSkillChoices).toEqual(
    derived.pendingClassSkillChoices,
  );
  expect(presentation.ui.statPointsAvailable).toBe(derived.statPointsAvailable);
  expect(
    JSON.stringify({
      buildings: input.buildings,
      upgrades: [...input.upgrades],
      classProgression: input.classProgression,
    }),
  ).toBe(inputBefore);
  expect(session.diagnostics()).toEqual(before);
  return presentation;
};

describe("GameSession presentation derivation", () => {
  it("matches fresh-session projections without mutating their inputs", () => {
    const presentation = verifySessionDerivation(new GameSession(), 0);
    expect(presentation.ui.pendingClassChoices).toEqual([]);
    expect(presentation.renderer.playerHitRecovery).toEqual({
      active: false,
      flashOn: false,
    });
  });

  it("preserves progression stats, class choices, and skill choices", () => {
    const base = savedAtHome();
    const progressed = new GameSession({
      saved: {
        ...base,
        classProgression: progressionFor(5, "wizard"),
      },
    });
    const progressedPresentation = verifySessionDerivation(progressed, 0);
    expect(progressedPresentation.ui.playerStats).toEqual(
      playerStatsFor(progressionFor(5, "wizard")),
    );
    expect(
      progressedPresentation.ui.pendingClassSkillChoices.length,
    ).toBeGreaterThan(0);

    const classChoice = new GameSession({
      saved: {
        ...base,
        classProgression: progressionFor(1, null),
      },
    });
    expect(
      verifySessionDerivation(classChoice, 0).ui.pendingClassChoices,
    ).toEqual(["knight", "wizard", "archer"]);
  });

  it("keeps the moving-input state projection wired through the session", () => {
    const session = new GameSession();
    session.move({ intent: { x: 1, y: 0 }, source: "keyboard", at: 1 });
    const presentation = verifySessionDerivation(session, 0);
    expect(presentation.ui.inputSource).toBe("keyboard");
  });

  it("derives the same values after a successful harvest", () => {
    const world: WorldIdentity = {
      seed: "presentation-harvest",
      generatorVersion: WANDERER_WEB_V3,
    };
    const nodeId = "tree:presentation-harvest";
    const chunkRecipeSource: ChunkRecipeSource = (identity, coordinate) => {
      const recipe = generateChunk(identity, coordinate);
      return coordinate.x === 0 && coordinate.y === 0
        ? {
            ...recipe,
            obstacles: [
              ...recipe.obstacles,
              { id: nodeId, kind: "tree", position: { x: 1, y: 0 } },
            ],
          }
        : recipe;
    };
    const session = new GameSession({ world, chunkRecipeSource });
    const woodBefore = session.diagnostics().resources.wood;
    session.harvestNode(nodeId);
    expect(session.presentation().ui.notice).toMatchObject({
      kind: "resource-node.harvested",
      rewards: { wood: 24 },
    });
    expect(session.diagnostics().resources.wood).toBe(woodBefore + 24);
    verifySessionDerivation(session, 0);
  });

  it("uses reset progression defaults and keeps Storage out of effects", () => {
    const base = savedAtHome();
    const session = new GameSession({
      saved: {
        ...base,
        classProgression: progressionFor(5, "wizard"),
      },
    });
    session.resetWorld("presentation-reset");
    const reset = verifySessionDerivation(session, 0);
    expect(reset.ui.world.seed).toBe("presentation-reset");
    expect(reset.ui.pendingClassChoices).toEqual([]);
    expect(reset.ui.classProgression.playerClass).toBeNull();

    const input: Parameters<typeof presentationDerivationFor>[0] = {
      elapsed: 0,
      recoveryEndsAt: 0,
      buildings: [
        {
          id: "legacy-storage",
          kind: "Storage" as const,
          position: { x: 1, y: 1 },
          level: 1 as const,
        },
      ],
      upgrades: new Set<UpgradeId>(),
      classProgression: progressionFor(0, null),
    };
    const derived = presentationDerivationFor(input);
    expect(derived).toEqual(expectedFor(input));
    expect(derived.effects.some((effect) => effect.startsWith("Storage"))).toBe(
      false,
    );
  });

  it("preserves the configured active hit-recovery flash projection", () => {
    const input: Parameters<typeof presentationDerivationFor>[0] = {
      elapsed: 10.1,
      recoveryEndsAt: 10.5,
      buildings: [],
      upgrades: new Set<UpgradeId>(),
      classProgression: progressionFor(0, null),
    };
    expect(presentationDerivationFor(input).playerHitRecovery).toEqual(
      expectedFor(input).playerHitRecovery,
    );
    expect(presentationDerivationFor(input).playerHitRecovery).toEqual({
      active: true,
      flashOn: false,
    });
  });
});
