import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import type { GameNotice, PlacementRejection } from "../../domain/notices";
import {
  presentGameNotice,
  presentPlacementNotice,
  presentPlacementRejection,
  presentPlacementResult,
} from "../../ui/noticePresentation";

describe("notice presentation", () => {
  it("maps every current typed notice to the established user-facing wording", () => {
    const notices = [
      { kind: "session.ready" },
      { kind: "world.reset", seed: "fixture-world" },
      { kind: "tap-to-move.rejected.invalid-destination" },
      {
        kind: "building.placed",
        buildingId: "building:fixture:0001",
        buildingKind: "Workshop",
      },
      {
        kind: "building.relocated",
        buildingId: "building:fixture:0001",
        buildingKind: "Workshop",
      },
      {
        kind: "building.upgraded",
        buildingId: "building:fixture:0001",
        buildingKind: "Workshop",
        level: 2,
      },
      {
        kind: "building.demolished",
        buildingId: "building:fixture:0001",
        buildingKind: "Workshop",
        refundRate: 0.5,
      },
      {
        kind: "building.rejected",
        rejection: { kind: "outside-settlement-radius", radius: 6 },
      },
      { kind: "upgrade.rejected.invalid-choice" },
      { kind: "upgrade.applied", upgradeId: "quick-hands" },
      { kind: "save.rejected.not-near-campfire" },
      { kind: "save.committed", savePointId: "campfire:home" },
      {
        kind: "player.died",
        savePointLabel: "home campfire",
        resourceLossRate: 0.25,
      },
      { kind: "enemy.defeated", enemyKind: "scout", respawns: true },
      { kind: "boss.defeated", hasUpgradeChoices: true },
      { kind: "drop.collected" },
      { kind: "farm.harvested" },
    ] as const satisfies readonly GameNotice[];

    expect(presentGameNotice(notices[0])).toBe(
      "Reach the nearby scout, then travel east to challenge the Ember Wyrm.",
    );
    expect(presentGameNotice(notices[6])).toBe(
      "Workshop demolished safely; 50% of its invested resources were refunded.",
    );
    expect(presentGameNotice(notices[7])).toBe(
      "Building action rejected: outside the 6m campfire settlement radius. No resources or records changed.",
    );
    expect(presentGameNotice(notices[10])).toBe(
      "Save rejected: stand within 2m of a home, wild, or player Campfire.",
    );
    expect(presentGameNotice(notices[13])).toBe(
      "scout defeated: data-defined resource drops remain on the ground. It will respawn later; no save was made.",
    );
    for (const notice of notices)
      expect(presentGameNotice(notice)).not.toBe("");
  });

  it("maps placement visibility from notice kinds and structured rejections", () => {
    const rejections = [
      { kind: "invalid-coordinates" },
      { kind: "blocked-terrain" },
      { kind: "overlaps-existing-building" },
      { kind: "outside-settlement-radius", radius: 9 },
      { kind: "insufficient-resources" },
      { kind: "unknown-building" },
      { kind: "already-level-3" },
    ] as const satisfies readonly PlacementRejection[];
    expect(rejections.map(presentPlacementRejection)).toEqual([
      "invalid coordinates",
      "blocked terrain",
      "overlaps an existing building",
      "outside the 9m campfire settlement radius",
      "insufficient resources",
      "unknown building",
      "already level 3",
    ]);
    expect(
      presentPlacementNotice({
        kind: "building.rejected",
        rejection: { kind: "unknown-building" },
      }),
    ).toContain("unknown building");
    expect(presentPlacementNotice({ kind: "drop.collected" })).toBe("");
    expect(
      presentPlacementResult({
        ok: false,
        rejection: { kind: "outside-settlement-radius", radius: 6 },
      }),
    ).toContain("outside the 6m campfire settlement radius");
  });

  it("keeps UI placement behaviour independent of English message fragments", () => {
    const uiSource = readFileSync(
      new URL("../../ui/gameUi.ts", import.meta.url),
      "utf8",
    );
    expect(uiSource).not.toMatch(/\.(?:startsWith|includes)\(/);
    expect(uiSource).not.toContain("snapshot.message");
    expect(uiSource).toContain("presentPlacementNotice(snapshot.notice)");
  });
});
