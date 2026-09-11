import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import type { BuildingState } from "../../domain/types";

/** Standalone REAL-DOM consumer fixture, not built-app or gameplay QA.
 * Transpile the exact checked-out consumers and their three existing runtime
 * dependencies in memory using the already-declared TypeScript dependency.
 * No copied implementation, DOM double, dev server, build/config modification,
 * generated file, extra dependency, app instance or browser-global registry.
 * Unknown runtime imports fail closed instead of silently substituting a stub. */
test("M5 standalone real-DOM consumers: fixed explicit inputs retain nodes with zero writes for exactly eight frames", async ({
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
  const consumers = moduleUrl("../../ui/retainedLists.ts", {
    "../data/definitions": definitions,
  });
  await testInfo.attach("standalone-consumer-source-provenance", {
    body: JSON.stringify(sources, null, 2),
    contentType: "application/json",
  });

  // This page never boots createGameApplication. These are explicit consumer
  // values, not a save document or injected gameplay/progression authority.
  await page.setContent(
    '<main><div id="rows"></div><ul id="effects"></ul></main>',
  );
  const observation = await page.evaluate(async (url) => {
    const { RetainedBuildingRows, RetainedEffects } = (await import(
      url
    )) as typeof import("../../ui/retainedLists");
    const rowHost = document.getElementById("rows");
    const effectHost = document.getElementById("effects");
    if (!rowHost || !effectHost)
      throw new Error("Missing real DOM fixture hosts");
    const buildings: readonly BuildingState[] = Object.freeze([
      Object.freeze({
        id: "building:m5-consumer:1",
        kind: "Campfire",
        level: 1,
        position: Object.freeze({ x: 1, y: 1 }),
      }),
      Object.freeze({
        id: "building:m5-consumer:2",
        kind: "Campfire",
        level: 1,
        position: Object.freeze({ x: 4, y: 0 }),
      }),
    ]);
    const effects = Object.freeze([
      "Campfire L1: fixed consumer effect",
      "Experience: 29 / 30 · choose a class at level 1.",
    ]);
    const rows = new RetainedBuildingRows(rowHost, {
      startRelocation() {},
      upgradeBuilding() {},
      demolish() {},
    });
    const effectList = new RetainedEffects(effectHost);
    let writes = 0;
    const observer = new MutationObserver((records) => {
      writes += records.length;
    });
    const observerOptions = {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    };
    try {
      rows.render(buildings);
      effectList.render(effects);
      const rowsBefore = [...rowHost.children];
      const controlsBefore = [...rowHost.querySelectorAll("button")];
      const effectsBefore = [...effectHost.children];
      const inputBefore = JSON.stringify({ buildings, effects });
      const sampledInputs: string[] = [];
      observer.observe(rowHost, observerOptions);
      observer.observe(effectHost, observerOptions);
      for (let frame = 0; frame < 8; frame += 1) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        // Independent, complete argument witness, not inferred from mutations.
        // New arrays with identical values also exclude a reference-only cache.
        const frameBuildings = Object.freeze(
          buildings.map((building) =>
            Object.freeze({
              ...building,
              position: Object.freeze({ ...building.position }),
            }),
          ),
        );
        const frameEffects = Object.freeze([...effects]);
        sampledInputs.push(
          JSON.stringify({ buildings: frameBuildings, effects: frameEffects }),
        );
        rows.render(frameBuildings);
        effectList.render(frameEffects);
      }
      writes += observer.takeRecords().length;
      observer.disconnect();
      const sameNodes = (
        before: readonly Element[],
        after: readonly Element[],
      ): boolean =>
        before.length === after.length &&
        before.every((node, index) => after[index] === node);
      const stable = {
        writes,
        rowsStable: sameNodes(rowsBefore, [...rowHost.children]),
        controlsStable: sameNodes(controlsBefore, [
          ...rowHost.querySelectorAll("button"),
        ]),
        effectsStable: sameNodes(effectsBefore, [...effectHost.children]),
      };
      const counts = {
        rows: rowsBefore.length,
        controls: controlsBefore.length,
        effects: effectsBefore.length,
      };
      // Positive control: changing XP MUST be observed and update the effect.
      // No filtering, masking or muting XP to manufacture zero writes.
      observer.observe(effectHost, observerOptions);
      effectList.render([
        effects[0],
        "Experience: 28 / 30 · choose a class at level 1.",
      ]);
      const changedXpWrites = observer.takeRecords().length;
      observer.disconnect();
      return {
        inputBefore,
        inputAfter: JSON.stringify({ buildings, effects }),
        sampledInputs,
        counts,
        stable,
        changedXpWrites,
        changedXpText: effectHost.textContent,
        changedXpReplacedEffects: effectsBefore.every(
          (node) => !node.isConnected,
        ),
        changedXpRetainedRows: sameNodes(rowsBefore, [...rowHost.children]),
      };
    } finally {
      observer.disconnect();
      rows.dispose();
      effectList.dispose();
    }
  }, consumers);
  expect(observation.counts).toEqual({ rows: 2, controls: 6, effects: 2 });
  expect(observation.sampledInputs).toHaveLength(8);
  expect(observation.sampledInputs).toEqual(
    Array(8).fill(observation.inputBefore),
  );
  expect(observation.inputAfter).toBe(observation.inputBefore);
  expect(observation.inputBefore).toContain("Experience: 29 / 30");
  expect(observation.stable).toEqual({
    writes: 0,
    rowsStable: true,
    controlsStable: true,
    effectsStable: true,
  });
  expect(observation.changedXpWrites).toBeGreaterThan(0);
  expect(observation.changedXpText).toContain("Experience: 28 / 30");
  expect(observation.changedXpReplacedEffects).toBe(true);
  expect(observation.changedXpRetainedRows).toBe(true);
  await expect(page.locator("#rows")).toBeEmpty();
  await expect(page.locator("#effects")).toBeEmpty();
  await testInfo.attach("fixed-input-eight-frame-observation", {
    body: JSON.stringify(observation, null, 2),
    contentType: "application/json",
  });
});
