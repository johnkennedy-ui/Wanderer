import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import type { GameUiSnapshot } from "../../domain/notices";

/** Standalone exact-source real-DOM UI consumer, not live gameplay or dist QA. */
test("M5 combined HUD retains resources, skills and eight stats on identical input", async ({
  page,
}, testInfo) => {
  const sources: { path: string; sha256: string }[] = [];
  const moduleUrl = (
    path: string,
    dependencies: Readonly<Record<string, string>> = {},
  ): string => {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    sources.push({
      path,
      sha256: createHash("sha256").update(source).digest("hex"),
    });
    let emitted = transpileModule(source, {
      compilerOptions: {
        module: ModuleKind.ESNext,
        target: ScriptTarget.ES2022,
      },
    }).outputText;
    for (const [specifier, url] of Object.entries(dependencies))
      emitted = emitted.replaceAll(
        JSON.stringify(specifier),
        JSON.stringify(url),
      );
    if (
      /\bfrom\s+["'](?!data:)/.test(emitted) ||
      /\bimport\s*["']/.test(emitted)
    )
      throw new Error(`Unresolved runtime dependency in ${path}`);
    return `data:text/javascript;base64,${Buffer.from(emitted).toString("base64")}`;
  };
  const types = moduleUrl("../../domain/types.ts");
  const freeze = moduleUrl("../../data/deepFreeze.ts");
  const definitions = moduleUrl("../../data/definitions.ts", {
    "../domain/types": types,
    "./deepFreeze": freeze,
  });
  const lists = moduleUrl("../../ui/retainedLists.ts", {
    "../data/definitions": definitions,
  });
  const notices = moduleUrl("../../ui/noticePresentation.ts", {
    "../data/definitions": definitions,
  });
  const consumer = moduleUrl("../../ui/gameUi.ts", {
    "../data/definitions": definitions,
    "../domain/types": types,
    "./noticePresentation": notices,
    "./retainedLists": lists,
  });
  await testInfo.attach("combined-hud-source-provenance", {
    body: JSON.stringify(sources, null, 2),
    contentType: "application/json",
  });
  await page.setContent('<div id="first"></div><div id="second"></div>');
  const observation = await page.evaluate(async (url) => {
    const { createGameUi } = (await import(
      url
    )) as typeof import("../../ui/gameUi");
    const first = document.getElementById("first");
    const second = document.getElementById("second");
    if (!first || !second) throw new Error("Missing UI hosts");
    const intents: import("../../ui/gameUi").UiIntents = {
      save() {},
      reset() {},
      upgradeBuilding() {},
      demolish() {},
      chooseUpgrade() {},
      chooseClass() {},
      chooseClassSkill() {},
      place: () => ({ ok: false, rejection: { kind: "blocked-terrain" } }),
      relocate: () => ({ ok: false, rejection: { kind: "unknown-building" } }),
    };
    const ui = createGameUi(first, intents);
    const other = createGameUi(second, intents);
    const input: GameUiSnapshot = {
      world: { seed: "hud-consumer", generatorVersion: "wanderer-web-v1" },
      player: { position: { x: 0, y: 0 }, hp: 100, maxHp: 100 },
      playerStats: {
        strength: 0,
        dexterity: 0,
        agility: 3,
        luck: 0,
        vitality: 0,
        magic: 6,
        defense: 0,
        magicDefense: 3,
      },
      resources: {
        wood: 120,
        stone: 120,
        scrap: 120,
        essence: 20,
        bossCore: 0,
      },
      materialCapacity: 120,
      buildRadius: 6,
      inputSource: "system",
      combatStatus: "Stationary: seeking a target",
      wave: {
        active: false,
        waveIndex: 0,
        secondsRemaining: 0,
        nextWaveInSeconds: 120,
        bossName: null,
        bossActive: false,
      },
      projectileCount: 0,
      weaponRelicDropCount: 0,
      buildings: [],
      effects: ["Experience: 100", "Wizard"],
      pendingUpgradeChoices: [],
      pendingClassChoices: [],
      pendingClassSkillChoices: [],
      classProgression: {
        experience: 100,
        level: 2,
        playerClass: "wizard",
        skillIds: ["wizard-flame-orb"],
      },
      canSave: true,
      savePointLabel: "home Campfire",
      notice: { kind: "session.ready" },
    };
    const elements = () => [...first.querySelectorAll("*")];
    const byId = (id: string): HTMLElement => {
      const element = first.querySelector<HTMLElement>(`[data-testid="${id}"]`);
      if (!element) throw new Error(`Missing ${id}`);
      return element;
    };
    const observer = new MutationObserver(() => {});
    const options = {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    };
    try {
      ui.render(input);
      other.render(structuredClone(input));
      const before = elements();
      const secondBefore = [...second.querySelectorAll("*")];
      const inputBefore = JSON.stringify(input);
      const sampledInputs: string[] = [];
      let writes = 0;
      for (let frame = 0; frame < 8; frame += 1) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const fresh = structuredClone(input);
        sampledInputs.push(JSON.stringify(fresh));
        observer.observe(first, options);
        ui.render(fresh);
        writes += observer.takeRecords().length;
        observer.disconnect();
      }
      const after = elements();
      const stable =
        before.length === after.length &&
        before.every((node, index) => after[index] === node);
      const stats = byId("stats-list");
      const labels = [...stats.querySelectorAll("dt")].map(
        (node) => node.textContent,
      );
      const values = [...stats.querySelectorAll("dd")].map(
        (node) => node.textContent,
      );
      const resourceNodes = [...byId("resources").children];
      const skillNodes = [...byId("skill-tree-skills").children];
      observer.observe(first, options);
      ui.render({
        ...structuredClone(input),
        playerStats: { ...input.playerStats, magic: 7 },
      });
      const statChangeWrites = observer.takeRecords().length;
      observer.disconnect();
      const changedMagic = stats.querySelectorAll("dd")[5].textContent;
      const retainedAfterStatChange = before.every(
        (node, index) => elements()[index] === node,
      );
      ui.render({
        ...structuredClone(input),
        resources: { ...input.resources, wood: 119 },
        classProgression: {
          ...input.classProgression,
          skillIds: ["wizard-wide-blast"],
        },
      });
      const changedWood = resourceNodes[0].getAttribute("aria-label");
      const changedSkill = byId("skill-tree-skills").textContent;
      const resourcesRetained = resourceNodes.every(
        (node, index) => byId("resources").children[index] === node,
      );
      const oldSkillsRemoved = skillNodes.every((node) => !node.isConnected);
      ui.dispose();
      ui.dispose();
      ui.render(input);
      const disposedEmpty = first.childElementCount === 0;
      other.render(structuredClone(input));
      const isolated = secondBefore.every(
        (node, index) => second.querySelectorAll("*")[index] === node,
      );
      return {
        inputBefore,
        sampledInputs,
        writes,
        stable,
        labels,
        values,
        statChangeWrites,
        changedMagic,
        retainedAfterStatChange,
        changedWood,
        changedSkill,
        resourcesRetained,
        oldSkillsRemoved,
        disposedEmpty,
        isolated,
      };
    } finally {
      observer.disconnect();
      ui.dispose();
      other.dispose();
    }
  }, consumer);
  expect(observation.sampledInputs).toEqual(
    Array(8).fill(observation.inputBefore),
  );
  expect(observation.writes).toBe(0);
  expect(observation.stable).toBe(true);
  expect(observation.labels).toEqual([
    "Strength",
    "Dexterity",
    "Agility",
    "Luck",
    "Vitality",
    "Magic",
    "Defense",
    "Magic Defense",
  ]);
  expect(observation.values).toEqual(["0", "0", "3", "0", "0", "6", "0", "3"]);
  expect(observation.statChangeWrites).toBeGreaterThan(0);
  expect(observation.changedMagic).toBe("7");
  expect(observation.retainedAfterStatChange).toBe(true);
  expect(observation.changedWood).toBe("Wood: 119");
  expect(observation.changedSkill).toContain("Wide Blast: selected");
  expect(observation.changedSkill).not.toContain("Flame Orb: selected");
  expect(observation.resourcesRetained).toBe(true);
  expect(observation.oldSkillsRemoved).toBe(true);
  expect(observation.disposedEmpty).toBe(true);
  expect(observation.isolated).toBe(true);
  await expect(page.locator("#first")).toBeEmpty();
  await expect(page.locator("#second")).toBeEmpty();
  await testInfo.attach("combined-hud-observation", {
    body: JSON.stringify(observation, null, 2),
    contentType: "application/json",
  });
});
