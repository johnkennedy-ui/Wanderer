import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RetainedBuildingRows,
  RetainedEffects,
  setText,
} from "../../ui/retainedLists";
import { createGameUi, type UiIntents } from "../../ui/gameUi";
import type { BuildingState } from "../../domain/types";
import type { GameUiSnapshot, PlacementResult } from "../../domain/notices";
import type {
  PlacementPreview,
  PlacementRequest,
} from "../../domain/placement";

/** Narrow DOM-operation double, not a browser substitute. Playwright covers layout,
 * accessibility, trusted canvas input and the actual parsed DOM. */
class ElementDouble extends EventTarget {
  readonly children: ElementDouble[] = [];
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly testIds = new Map<string, ElementDouble>();
  parent: ElementDouble | null = null;
  className = "";
  type = "";
  title = "";
  hidden = false;
  checked = false;
  disabled = false;
  value = "";
  writes = 0;
  mutations = 0;
  private content = "";
  get textContent(): string {
    return this.content;
  }
  set textContent(value: string) {
    this.writes += 1;
    this.content = value;
  }
  set innerHTML(html: string) {
    // Only indexed shell elements are needed by the UI's explicit lookup port.
    for (const match of html.matchAll(/<[^>]*data-testid="([^"]+)"[^>]*>/g)) {
      const child = new ElementDouble();
      child.dataset.testid = match[1];
      child.hidden = /\shidden(?:\s|>)/.test(match[0]);
      for (const attr of match[0].matchAll(/([\w-]+)="([^"]*)"/g))
        child.attributes.set(attr[1], attr[2]);
      this.testIds.set(match[1], child);
    }
  }
  querySelector(selector: string): ElementDouble | null {
    const id = /\[data-testid="([^"]+)"\]/.exec(selector)?.[1];
    return id === undefined ? null : (this.testIds.get(id) ?? null);
  }
  querySelectorAll(): ElementDouble[] {
    return this.children;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    this.mutations += 1;
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  get firstChild(): ElementDouble | null {
    return this.children[0] ?? null;
  }
  get nextSibling(): ElementDouble | null {
    if (this.parent === null) return null;
    return this.parent.children[this.parent.children.indexOf(this) + 1] ?? null;
  }
  append(...children: ElementDouble[]): void {
    for (const child of children) this.insertBefore(child, null);
  }
  insertBefore(child: ElementDouble, before: ElementDouble | null): void {
    child.remove();
    this.children.splice(
      before === null ? this.children.length : this.children.indexOf(before),
      0,
      child,
    );
    child.parent = this;
    this.mutations += 1;
  }
  replaceChildren(...children: ElementDouble[]): void {
    for (const child of [...this.children]) child.remove();
    this.append(...children);
    this.mutations += 1;
  }
  remove(): void {
    if (this.parent === null) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent.mutations += 1;
    this.parent = null;
  }
  click(): void {
    this.dispatchEvent(new Event("click"));
  }
}
const primaryTouchUp = (): Event => {
  const event = new Event("pointerup");
  Object.defineProperties(event, {
    pointerType: { value: "touch" },
    isPrimary: { value: true },
    button: { value: 0 },
  });
  return event;
};
const asElement = (element: ElementDouble): HTMLElement =>
  element as unknown as HTMLElement;
const installDom = (): void => {
  vi.stubGlobal("document", { createElement: () => new ElementDouble() });
};
const building = (id: string, x = 1): BuildingState => ({
  id,
  kind: "Workshop",
  level: 1,
  position: { x, y: 1 },
});
afterEach(() => vi.unstubAllGlobals());

describe("retained UI list operations", () => {
  it("keeps rows/listeners stable, targets changed labels, and starts current relocation instead of reading coordinates", () => {
    installDom();
    const host = new ElementDouble();
    const intents = {
      startRelocation: vi.fn(),
      upgradeBuilding: vi.fn(),
      demolish: vi.fn(),
    };
    const rows = new RetainedBuildingRows(asElement(host), intents);
    rows.render([building("a"), building("b", 3)]);
    const [a, b] = host.children;
    const aWrites = a.children[0].writes,
      bWrites = b.children[0].writes;
    const listeners = [a.children[2], b.children[1], b.children[3]];
    const mutations = host.mutations;
    for (let frame = 0; frame < 20; frame += 1)
      rows.render([building("a"), building("b", 3)]);
    expect(host.children).toEqual([a, b]);
    expect(host.mutations).toBe(mutations);
    expect(a.children[0].writes).toBe(aWrites);
    expect(b.children[0].writes).toBe(bWrites);
    rows.render([{ ...building("a", 2), level: 3 }, building("b", 3)]);
    expect(a.children[0].textContent).toBe("Workshop L3 @ 2.0, 1.0");
    expect(a.children[1].disabled).toBe(true);
    expect(b.children[0].writes).toBe(bWrites);
    // Even a new kind for the same ID must not leave a stale listener closure.
    rows.render([{ ...building("a", 2), kind: "Campfire" }, building("b", 3)]);
    expect(a.children[2]).toBe(listeners[0]);
    listeners.forEach((button) => button.click());
    expect(intents.startRelocation).toHaveBeenCalledExactlyOnceWith(
      "a",
      "Campfire",
    );
    expect(intents.upgradeBuilding).toHaveBeenCalledExactlyOnceWith("b");
    expect(intents.demolish).toHaveBeenCalledExactlyOnceWith("b");
    rows.dispose();
  });

  it("starts retained relocation from a primary touch release without double-activating its paired click", () => {
    installDom();
    const host = new ElementDouble();
    const intents = {
      startRelocation: vi.fn(),
      upgradeBuilding: vi.fn(),
      demolish: vi.fn(),
    };
    const rows = new RetainedBuildingRows(asElement(host), intents);
    rows.render([building("wall")]);
    const relocate = host.children[0].children[2];

    relocate.dispatchEvent(primaryTouchUp());
    expect(intents.startRelocation).toHaveBeenCalledExactlyOnceWith(
      "wall",
      "Workshop",
    );
    relocate.click();
    expect(intents.startRelocation).toHaveBeenCalledExactlyOnceWith(
      "wall",
      "Workshop",
    );
    rows.dispose();
  });

  it("preserves order by moving only needed rows and removes detached listeners", () => {
    installDom();
    const host = new ElementDouble();
    const intents = {
      startRelocation: vi.fn(),
      upgradeBuilding: vi.fn(),
      demolish: vi.fn(),
    };
    const rows = new RetainedBuildingRows(asElement(host), intents);
    rows.render([building("a"), building("b")]);
    const [a, b] = host.children;
    rows.render([building("b"), building("a")]);
    expect(host.children).toEqual([b, a]);
    rows.render([building("b")]);
    expect(a.parent).toBeNull();
    a.children[2].click();
    expect(intents.startRelocation).not.toHaveBeenCalled();
    rows.dispose();
    rows.dispose();
    b.children[1].click();
    expect(intents.upgradeBuilding).not.toHaveBeenCalled();
    rows.render([building("c")]);
    expect(host.children).toHaveLength(0);
  });

  it("retains Healing Hut aura nodes and buttons across level/radius and unrelated row changes", () => {
    installDom();
    const host = new ElementDouble();
    const rows = new RetainedBuildingRows(asElement(host), {
      startRelocation: vi.fn(),
      upgradeBuilding: vi.fn(),
      demolish: vi.fn(),
    });
    const hut: BuildingState = { ...building("hut"), kind: "Healer" };
    rows.render([hut, building("other")]);
    const [row, other] = host.children;
    const [label, aura, upgrade, move] = row.children;
    const writes = aura.writes,
      mutations = aura.mutations;
    rows.render([{ ...hut }, building("other", 4)]);
    expect(aura.writes).toBe(writes);
    expect(aura.mutations).toBe(mutations);
    expect(host.children[0]).toBe(row);
    expect(host.children[1]).toBe(other);
    const otherWrites = other.children[0].writes;
    for (const level of [2, 3] as const) {
      rows.render([{ ...hut, level }, building("other", 4)]);
      expect(row.children.slice(0, 4)).toEqual([label, aura, upgrade, move]);
      expect(label.textContent).toContain(`Healing Hut L${level}`);
      expect(aura.dataset.testid).toBe("healing-radius-hut");
      expect(aura.getAttribute("aria-label")).toBe(
        `Healing Hut healing radius, level ${level}: ${level + 2} metres`,
      );
      expect(aura.textContent).toBe(
        `Healing aura: ${level + 2}m radius · +${level === 2 ? 3 : 6} health/s while stationary inside`,
      );
      expect(other.children[0].writes).toBe(otherWrites);
    }
    expect(upgrade.disabled).toBe(true);
    rows.dispose();
  });

  it("keeps a legacy Storage row visible but removes its upgrade and relocation actions", () => {
    installDom();
    const host = new ElementDouble();
    const intents = {
      startRelocation: vi.fn(),
      upgradeBuilding: vi.fn(),
      demolish: vi.fn(),
    };
    const rows = new RetainedBuildingRows(asElement(host), intents);
    rows.render([{ ...building("legacy"), kind: "Storage" }]);
    const [row] = host.children;
    const [label, upgrade, move, demolish] = row.children;
    expect(label.textContent).toBe("Legacy Storage L1 @ 1.0, 1.0");
    expect(upgrade.disabled).toBe(true);
    expect(upgrade.getAttribute("title")).toBe(
      "Legacy Storage cannot be upgraded.",
    );
    expect(move.disabled).toBe(true);
    expect(move.getAttribute("title")).toBe(
      "Legacy Storage cannot be relocated.",
    );
    expect(demolish.disabled).toBe(false);
    demolish.click();
    expect(intents.demolish).toHaveBeenCalledExactlyOnceWith("legacy");
    rows.dispose();
  });

  it("keeps wall relocation and demolition available but disables their single-tier upgrade", () => {
    installDom();
    const host = new ElementDouble();
    const intents = {
      startRelocation: vi.fn(),
      upgradeBuilding: vi.fn(),
      demolish: vi.fn(),
    };
    const rows = new RetainedBuildingRows(asElement(host), intents);
    rows.render([{ ...building("wall"), kind: "WoodWall" }]);
    const [row] = host.children;
    const [, upgrade, move, demolish] = row.children;
    expect(upgrade.disabled).toBe(true);
    expect(upgrade.getAttribute("title")).toBe(
      "Walls are single-tier and cannot be upgraded.",
    );
    expect(move.disabled).toBe(false);
    move.click();
    demolish.click();
    expect(intents.startRelocation).toHaveBeenCalledWith("wall", "WoodWall");
    expect(intents.demolish).toHaveBeenCalledWith("wall");
    rows.dispose();
  });

  it("keeps tower upgrades available through level two and disables only level three", () => {
    installDom();
    const host = new ElementDouble();
    const intents = {
      startRelocation: vi.fn(),
      upgradeBuilding: vi.fn(),
      demolish: vi.fn(),
    };
    const rows = new RetainedBuildingRows(asElement(host), intents);
    rows.render([{ ...building("tower"), kind: "ArcherTower", level: 1 }]);
    const [row] = host.children;
    const [, upgrade] = row.children;
    expect(upgrade.disabled).toBe(false);
    upgrade.click();
    expect(intents.upgradeBuilding).toHaveBeenCalledExactlyOnceWith("tower");

    rows.render([{ ...building("tower"), kind: "ArcherTower", level: 3 }]);
    expect(upgrade.disabled).toBe(true);
    rows.dispose();
  });

  it("uses an unambiguous effects value signature and suppresses identical text writes", () => {
    installDom();
    const host = new ElementDouble();
    const effects = new RetainedEffects(asElement(host));
    effects.render(["a|b", "c"]);
    const nodes = [...host.children],
      mutations = host.mutations;
    effects.render(["a|b", "c"]);
    expect(host.mutations).toBe(mutations);
    expect(host.children[0]).toBe(nodes[0]);
    effects.render(["a", "b|c"]);
    expect(host.children[0]).not.toBe(nodes[0]);
    expect(host.children.map((node) => node.textContent)).toEqual(["a", "b|c"]);
    const label = new ElementDouble();
    setText(asElement(label), "same");
    setText(asElement(label), "same");
    expect(label.writes).toBe(1);
    setText(asElement(label), "changed");
    expect(label.writes).toBe(2);
    effects.dispose();
    effects.dispose();
    effects.render(["ignored"]);
    expect(host.children).toHaveLength(0);
  });
});

const snapshot = (
  buildings: readonly BuildingState[] = [],
): GameUiSnapshot => ({
  world: { seed: "ui", generatorVersion: "wanderer-web-v2" },
  player: { position: { x: 0, y: 0 }, hp: 90, maxHp: 100 },
  playerStats: {
    strength: 0,
    dexterity: 0,
    agility: 0,
    luck: 0,
    vitality: 0,
    magic: 0,
    defense: 0,
    magicDefense: 0,
  },
  resources: { wood: 120, stone: 120, scrap: 120, essence: 120, bossCore: 1 },
  buildRadius: 6,
  inputSource: "system",
  combatStatus: "Ready",
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
  statPointsAvailable: 0,
  buildings,
  effects: ["same effect"],
  pendingUpgradeChoices: [],
  classProgression: {
    experience: 0,
    level: 0,
    playerClass: null,
    skillIds: [],
    allocatedStats: {
      strength: 0,
      dexterity: 0,
      agility: 0,
      luck: 0,
      vitality: 0,
      magic: 0,
    },
  },
  pendingClassChoices: [],
  pendingClassSkillChoices: [],
  canSave: true,
  savePointLabel: "Home",
  notice: { kind: "session.ready" },
});
const previewFor = (request: PlacementRequest): PlacementPreview => {
  const buildingKind =
    request.kind === "place" ? request.buildingKind : "Workshop";
  const tiles =
    request.kind === "place" && request.endPosition !== undefined
      ? [
          { position: request.position, valid: true, rejection: null },
          { position: request.endPosition, valid: true, rejection: null },
        ]
      : [{ position: request.position, valid: true, rejection: null }];
  return {
    buildingKind,
    level: 1,
    tiles,
    valid: true,
    rejection: null,
    cost: { wood: 3, stone: 2, scrap: 0, essence: 0, bossCore: 0 },
  };
};

const resultFor = (request: PlacementRequest): PlacementResult =>
  request.kind === "place"
    ? {
        ok: true,
        outcome: "placed",
        building: { ...building("placed"), kind: request.buildingKind },
      }
    : {
        ok: true,
        outcome: "relocated",
        building: building(request.buildingId),
      };

const setupUi = () => {
  installDom();
  const root = new ElementDouble();
  const intents = {
    save: vi.fn(),
    reset: vi.fn(),
    previewPlacement: vi.fn<UiIntents["previewPlacement"]>((request) =>
      previewFor(request),
    ),
    confirmPlacement: vi.fn<UiIntents["confirmPlacement"]>((request) =>
      resultFor(request),
    ),
    resetPlacementInput: vi.fn(),
    upgradeBuilding: vi.fn(),
    demolish: vi.fn(),
    chooseUpgrade: vi.fn(),
    chooseClass: vi.fn(),
    chooseClassSkill: vi.fn(),
    allocateStat: vi.fn(),
    setSimulationSpeed: vi.fn(),
  } satisfies UiIntents;
  const ui = createGameUi(asElement(root), intents);
  const shell = root.children[1];
  const get = (id: string): ElementDouble => {
    const element = shell.testIds.get(id);
    if (element === undefined) throw new Error(`Missing ${id}`);
    return element;
  };
  return { root, ui, intents, get };
};

describe("current HUD placement port", () => {
  it("starts a build choice from a primary touch release without waiting for a synthetic click", () => {
    const { ui, get } = setupUi();
    ui.render(snapshot());
    const wood = get("build-buttons").children.find(
      (button) => button.dataset.testid === "build-WoodWall",
    );
    if (wood === undefined) throw new Error("Missing Wood Wall build choice");

    wood.dispatchEvent(primaryTouchUp());

    expect(ui.isWorldPlacementEnabled()).toBe(true);
    expect(get("placement-mode").textContent).toContain("Wood Wall selected");
    expect(get("build-menu-panel").hidden).toBe(true);
    expect(wood.getAttribute("aria-pressed")).toBe("true");
    // The paired synthetic click from the same touch must leave the choice
    // active rather than toggling or cancelling it.
    wood.click();
    expect(ui.isWorldPlacementEnabled()).toBe(true);
    expect(wood.getAttribute("aria-pressed")).toBe("true");
    ui.dispose();
  });

  it("cancels placement from a primary touch release before a synthetic click", () => {
    const { ui, get } = setupUi();
    ui.render(snapshot());
    const wood = get("build-buttons").children.find(
      (button) => button.dataset.testid === "build-WoodWall",
    );
    if (wood === undefined) throw new Error("Missing Wood Wall build choice");

    wood.click();
    expect(ui.isWorldPlacementEnabled()).toBe(true);

    const cancel = get("cancel-placement");
    cancel.dispatchEvent(primaryTouchUp());

    expect(ui.isWorldPlacementEnabled()).toBe(false);
    expect(get("placement-mode").hidden).toBe(true);
    // The paired synthetic click must not reactivate or otherwise change the
    // already-cancelled placement state.
    cancel.click();
    expect(ui.isWorldPlacementEnabled()).toBe(false);
    ui.dispose();
  });

  it("shows live wall ghosts, stages drag-release lines, and commits only on a preview tile tap", () => {
    const { ui, intents, get } = setupUi();
    ui.render(snapshot());
    const woodWall = get("build-buttons").children.find(
      (button) => button.dataset.testid === "build-WoodWall",
    );
    if (woodWall === undefined) throw new Error("Missing Wood Wall choice");
    woodWall.click();
    expect(ui.isWallPlacementEnabled()).toBe(true);

    const start = { x: 1, y: 1 };
    const end = { x: 3, y: 1 };
    ui.previewWorldPlacement(start, end);
    expect(ui.hasStagedPlacementPreview()).toBe(false);
    expect(get("placement-preview").hidden).toBe(true);
    expect(ui.placementPreview()).not.toBeNull();

    ui.applyWorldPlacement(start, end);
    expect(intents.confirmPlacement).not.toHaveBeenCalled();
    expect(intents.previewPlacement).toHaveBeenLastCalledWith({
      kind: "place",
      buildingKind: "WoodWall",
      position: start,
      endPosition: end,
    });
    expect(get("placement-preview").hidden).toBe(false);
    expect(get("placement-preview").getAttribute("data-count")).toBe("2");
    expect(get("placement-preview-message").textContent).toContain(
      "Wall line staged",
    );
    expect(get("placement-preview-message").textContent).toContain(
      "Tap any line tile",
    );

    ui.applyWorldPlacement(end);
    expect(intents.confirmPlacement).toHaveBeenCalledExactlyOnceWith({
      kind: "place",
      buildingKind: "WoodWall",
      position: start,
      endPosition: end,
    });
    expect(ui.isWorldPlacementEnabled()).toBe(false);
    expect(ui.placementPreview()).toBeNull();
    ui.dispose();
  });

  it.each(["WoodWall", "StoneWall"] as const)(
    "plans %s from two separate taps without placing either endpoint",
    (kind) => {
      const { ui, intents, get } = setupUi();
      ui.render(snapshot());
      const choice = get("build-buttons").children.find(
        (button) => button.dataset.testid === "build-" + kind,
      );
      if (choice === undefined) throw new Error("Missing wall choice");
      choice.click();
      const start = { x: 1, y: 1 };
      const end = { x: 3, y: 1 };
      ui.applyWorldPlacement(start);
      expect(intents.confirmPlacement).not.toHaveBeenCalled();
      expect(ui.placementPreview()?.tiles).toHaveLength(1);
      expect(get("placement-preview-message").textContent).toContain(
        "Tap another tile to choose the end",
      );
      ui.applyWorldPlacement(end);
      const line = {
        kind: "place",
        buildingKind: kind,
        position: start,
        endPosition: end,
      };
      expect(intents.previewPlacement).toHaveBeenLastCalledWith(line);
      expect(intents.confirmPlacement).not.toHaveBeenCalled();
      expect(ui.placementPreview()?.tiles).toHaveLength(2);
      expect(get("placement-preview-message").textContent).toContain(
        "Wall line staged",
      );
      get("confirm-placement").click();
      expect(intents.confirmPlacement).toHaveBeenCalledExactlyOnceWith(line);
      expect(ui.placementPreview()).toBeNull();
      ui.dispose();
    },
  );

  it("adjusts the second endpoint without moving the wall anchor or prematurely building", () => {
    const { ui, intents, get } = setupUi();
    ui.render(snapshot());
    get("build-buttons")
      .children.find((button) => button.dataset.testid === "build-WoodWall")!
      .click();
    const start = { x: 1, y: 1 };
    const end = { x: 3, y: 1 };
    const changedEnd = { x: 1, y: 4 };
    ui.applyWorldPlacement(start);
    ui.applyWorldPlacement(end);
    ui.applyWorldPlacement(changedEnd);
    expect(intents.previewPlacement).toHaveBeenLastCalledWith({
      kind: "place",
      buildingKind: "WoodWall",
      position: start,
      endPosition: changedEnd,
    });
    expect(intents.confirmPlacement).not.toHaveBeenCalled();
    ui.applyWorldPlacement(changedEnd);
    expect(intents.confirmPlacement).toHaveBeenCalledExactlyOnceWith({
      kind: "place",
      buildingKind: "WoodWall",
      position: start,
      endPosition: changedEnd,
    });
    ui.dispose();
  });

  it("treats a repeated start tap as a one-tile line preview, not automatic placement", () => {
    const { ui, intents, get } = setupUi();
    ui.render(snapshot());
    get("build-buttons")
      .children.find((button) => button.dataset.testid === "build-WoodWall")!
      .click();
    const start = { x: 2, y: 2 };
    ui.applyWorldPlacement(start);
    ui.applyWorldPlacement(start);
    expect(intents.confirmPlacement).not.toHaveBeenCalled();
    expect(intents.previewPlacement).toHaveBeenLastCalledWith({
      kind: "place",
      buildingKind: "WoodWall",
      position: start,
      endPosition: start,
    });
    get("cancel-placement").click();
    expect(ui.placementPreview()).toBeNull();
    expect(intents.confirmPlacement).not.toHaveBeenCalled();
    ui.dispose();
  });

  it("keeps a rejected two-tap line uncommitted and forgets its anchor on cancellation", () => {
    const { ui, intents, get } = setupUi();
    ui.render(snapshot());
    const wall = get("build-buttons").children.find(
      (button) => button.dataset.testid === "build-WoodWall",
    )!;
    wall.click();
    const start = { x: 1, y: 1 };
    const end = { x: 3, y: 1 };
    ui.applyWorldPlacement(start);
    intents.previewPlacement.mockImplementation((request) => ({
      ...previewFor(request),
      valid: false,
      rejection: { kind: "occupied-by-actor" },
    }));
    ui.applyWorldPlacement(end);
    expect(intents.previewPlacement).toHaveBeenLastCalledWith({
      kind: "place",
      buildingKind: "WoodWall",
      position: start,
      endPosition: end,
    });
    expect(get("placement-preview").getAttribute("data-valid")).toBe("false");
    expect(get("confirm-placement").disabled).toBe(true);
    get("confirm-placement").click();
    expect(intents.confirmPlacement).not.toHaveBeenCalled();
    get("cancel-placement").click();
    wall.click();
    intents.previewPlacement.mockImplementation(previewFor);
    const fresh = { x: 4, y: 2 };
    ui.applyWorldPlacement(fresh);
    expect(intents.previewPlacement).toHaveBeenLastCalledWith({
      kind: "place",
      buildingKind: "WoodWall",
      position: fresh,
    });
    expect(intents.confirmPlacement).not.toHaveBeenCalled();
    ui.dispose();
  });

  it("disables a previously valid wall line when an actor enters and recovers without committing", () => {
    let now = 0;
    vi.stubGlobal("performance", { now: () => now });
    const { ui, intents, get } = setupUi();
    const initial = snapshot();
    ui.render(initial, "actor-outside");
    get("build-buttons")
      .children.find((button) => button.dataset.testid === "build-WoodWall")!
      .click();
    const start = { x: 1, y: 1 };
    const end = { x: 3, y: 1 };
    ui.applyWorldPlacement(start);
    ui.applyWorldPlacement(end);
    expect(get("placement-preview").getAttribute("data-valid")).toBe("true");
    expect(get("confirm-placement").disabled).toBe(false);

    intents.previewPlacement.mockImplementation((request) => {
      const valid = previewFor(request);
      const rejection = { kind: "occupied-by-actor" } as const;
      return {
        ...valid,
        valid: false,
        rejection,
        tiles: valid.tiles.map((tile, index) =>
          index === 0 ? { ...tile, valid: false, rejection } : tile,
        ),
      };
    });
    now = 120;
    ui.render(initial, "actor-inside");
    expect(get("placement-preview").getAttribute("data-valid")).toBe("false");
    expect(get("placement-preview-message").textContent).toContain(
      "blocks a character",
    );
    expect(get("confirm-placement").disabled).toBe(true);
    expect(ui.placementPreview()?.tiles[0].valid).toBe(false);
    get("confirm-placement").click();
    expect(intents.confirmPlacement).not.toHaveBeenCalled();
    expect(intents.save).not.toHaveBeenCalled();

    intents.previewPlacement.mockImplementation(previewFor);
    now = 240;
    ui.render(initial, "actor-outside-again");
    expect(get("placement-preview").getAttribute("data-valid")).toBe("true");
    expect(get("confirm-placement").disabled).toBe(false);
    expect(intents.confirmPlacement).not.toHaveBeenCalled();
    get("confirm-placement").click();
    expect(intents.confirmPlacement).toHaveBeenCalledExactlyOnceWith({
      kind: "place",
      buildingKind: "WoodWall",
      position: start,
      endPosition: end,
    });
    expect(intents.save).not.toHaveBeenCalled();
    ui.dispose();
  });

  it("refreshes a staged preview only after placement context changes and the bounded refresh interval", () => {
    let now = 0;
    vi.stubGlobal("performance", { now: () => now });
    const { ui, intents, get } = setupUi();
    const initial = snapshot();
    ui.render(initial);
    get("build-buttons").children[0].click();
    ui.applyWorldPlacement({ x: 2, y: 4 });
    const afterStage = intents.previewPlacement.mock.calls.length;
    ui.render(initial);
    expect(intents.previewPlacement).toHaveBeenCalledTimes(afterStage);

    const changed = {
      ...initial,
      resources: { ...initial.resources, wood: initial.resources.wood - 1 },
    };
    now = 60;
    ui.render(changed);
    expect(intents.previewPlacement).toHaveBeenCalledTimes(afterStage);
    now = 120;
    ui.render(changed);
    expect(intents.previewPlacement).toHaveBeenCalledTimes(afterStage + 1);
    now = 250;
    ui.render(changed);
    expect(intents.previewPlacement).toHaveBeenCalledTimes(afterStage + 1);
    expect(get("placement-preview").hidden).toBe(false);
    ui.dispose();
  });

  it("opens Settings above runtime-only 1×, 2×, and 5× speed controls", () => {
    const { ui, intents, get } = setupUi();
    ui.render(snapshot());
    const settings = get("settings-toggle");
    const controls = get("settings-speed-controls");
    const atOne = get("speed-1x");
    const atTwo = get("speed-2x");
    const atFive = get("speed-5x");

    expect(settings.getAttribute("aria-label")).toBe("Settings");
    expect(settings.getAttribute("aria-controls")).toBe(
      "settings-speed-controls",
    );
    expect(settings.getAttribute("aria-expanded")).toBe("false");
    expect(controls.hidden).toBe(true);
    expect(atOne.getAttribute("aria-pressed")).toBe("true");
    expect(atTwo.getAttribute("aria-pressed")).toBe("false");
    expect(atFive.getAttribute("aria-pressed")).toBe("false");

    settings.click();
    expect(controls.hidden).toBe(false);
    expect(settings.getAttribute("aria-expanded")).toBe("true");
    atTwo.click();
    expect(intents.setSimulationSpeed).toHaveBeenLastCalledWith(2);
    expect(atOne.getAttribute("aria-pressed")).toBe("false");
    expect(atTwo.getAttribute("aria-pressed")).toBe("true");
    expect(atFive.getAttribute("aria-pressed")).toBe("false");
    atFive.click();
    expect(intents.setSimulationSpeed).toHaveBeenLastCalledWith(5);
    expect(atTwo.getAttribute("aria-pressed")).toBe("false");
    expect(atFive.getAttribute("aria-pressed")).toBe("true");
    atOne.click();
    expect(intents.setSimulationSpeed).toHaveBeenLastCalledWith(1);
    expect(atOne.getAttribute("aria-pressed")).toBe("true");

    get("resources-toggle").click();
    expect(controls.hidden).toBe(true);
    settings.click();
    get("build-menu-toggle").click();
    expect(controls.hidden).toBe(true);
    get("build-buttons").children[0].click();
    expect(ui.isWorldPlacementEnabled()).toBe(true);
    expect(controls.hidden).toBe(true);
    ui.dispose();
  });

  it("projects six primary stat controls through intents without changing the eight-stat list", () => {
    const { ui, intents, get } = setupUi();
    ui.render({
      ...snapshot(),
      playerStats: {
        ...snapshot().playerStats,
        strength: 8,
      },
      statPointsAvailable: 3,
      classProgression: {
        experience: 6,
        level: 1,
        playerClass: "knight",
        skillIds: [],
        allocatedStats: {
          strength: 2,
          dexterity: 0,
          agility: 0,
          luck: 0,
          vitality: 0,
          magic: 0,
        },
      },
    });
    const stats = get("stats-list");
    const controls = get("stat-allocation-controls");
    expect(get("stat-points").textContent).toBe("Stat points available: 3");
    expect(stats.children).toHaveLength(16);
    expect(controls.children.map((button) => button.dataset.testid)).toEqual([
      "allocate-stat-strength",
      "allocate-stat-dexterity",
      "allocate-stat-agility",
      "allocate-stat-luck",
      "allocate-stat-vitality",
      "allocate-stat-magic",
    ]);
    expect(controls.children.every((button) => !button.disabled)).toBe(true);
    expect(controls.children[0].textContent).toBe("+ Strength");
    expect(controls.children[0].getAttribute("data-allocation")).toBe("2");
    expect(controls.children[0].getAttribute("aria-label")).toBe(
      "Add one Strength point (2 allocated)",
    );
    controls.children[0].click();
    expect(intents.allocateStat).toHaveBeenCalledExactlyOnceWith("strength");

    ui.render({
      ...snapshot(),
      statPointsAvailable: 0,
      classProgression: {
        experience: 6,
        level: 1,
        playerClass: "knight",
        skillIds: [],
        allocatedStats: {
          strength: 3,
          dexterity: 0,
          agility: 0,
          luck: 0,
          vitality: 0,
          magic: 0,
        },
      },
    });
    expect(get("stat-points").textContent).toBe("Stat points available: 0");
    expect(controls.children.every((button) => button.disabled)).toBe(true);
    ui.dispose();
  });

  it("stages relocation previews, never commits a stale tap, and clears on cancel, success, demolition, and reset", () => {
    const { ui, intents, get } = setupUi();
    ui.render(snapshot([building("a"), building("b")]));
    const [a, b] = get("building-list").children;
    const move = a.children[2];
    ui.render(
      snapshot([
        { ...building("a"), kind: "Healer", level: 2 },
        building("b", 4),
      ]),
    );
    move.click();
    expect(get("placement-mode").textContent).toContain(
      "Healing Hut relocation selected",
    );
    expect(ui.isWorldPlacementEnabled()).toBe(true);
    expect(intents.confirmPlacement).not.toHaveBeenCalled();

    ui.applyWorldPlacement({ x: 9, y: -4 });
    expect(intents.previewPlacement).toHaveBeenLastCalledWith({
      kind: "relocate",
      buildingId: "a",
      position: { x: 9, y: -4 },
    });
    expect(intents.confirmPlacement).not.toHaveBeenCalled();
    expect(get("placement-preview").hidden).toBe(false);
    expect(get("placement-preview").getAttribute("data-valid")).toBe("true");
    expect(get("placement-preview").getAttribute("data-count")).toBe("1");
    expect(get("placement-preview-message").textContent).toContain(
      "Cost: Wood 3",
    );
    expect(get("placement-preview-message").textContent).toContain(
      "tap elsewhere to reposition",
    );

    // An off-target tap is a fresh preview, never confirmation of the old tile.
    ui.applyWorldPlacement({ x: -2, y: 7 });
    expect(intents.confirmPlacement).not.toHaveBeenCalled();
    expect(intents.previewPlacement).toHaveBeenLastCalledWith({
      kind: "relocate",
      buildingId: "a",
      position: { x: -2, y: 7 },
    });
    ui.applyWorldPlacement({ x: 9, y: -4 });
    expect(intents.confirmPlacement).not.toHaveBeenCalled();

    intents.confirmPlacement.mockReturnValueOnce({
      ok: false,
      rejection: { kind: "overlaps-existing-building" },
    });
    intents.previewPlacement.mockImplementationOnce((request) => {
      const preview = previewFor(request);
      const rejection = { kind: "overlaps-existing-building" } as const;
      return {
        ...preview,
        valid: false,
        rejection,
        tiles: preview.tiles.map((tile) => ({
          ...tile,
          valid: false,
          rejection,
        })),
      };
    });
    get("confirm-placement").click();
    expect(intents.confirmPlacement).toHaveBeenCalledExactlyOnceWith({
      kind: "relocate",
      buildingId: "a",
      position: { x: 9, y: -4 },
    });
    expect(get("placement-message").textContent).toContain(
      "overlaps an existing building",
    );
    expect(get("placement-preview").getAttribute("data-valid")).toBe("false");
    expect(get("placement-preview-message").textContent).toContain(
      "Rejected: overlaps an existing building",
    );
    expect(get("confirm-placement").disabled).toBe(true);
    get("confirm-placement").click();
    expect(intents.confirmPlacement).toHaveBeenCalledOnce();
    expect(ui.isWorldPlacementEnabled()).toBe(true);

    const cancel = get("cancel-placement");
    expect(cancel.hidden).toBe(false);
    expect(cancel.getAttribute("aria-label")).toBe("Cancel placement");
    cancel.click();
    expect(ui.isWorldPlacementEnabled()).toBe(false);
    expect(get("placement-preview").hidden).toBe(true);
    expect(ui.placementPreview()).toBeNull();
    ui.applyWorldPlacement({ x: 99, y: 99 });
    expect(intents.confirmPlacement).toHaveBeenCalledOnce();

    move.click();
    ui.applyWorldPlacement({ x: -2, y: 7 });
    get("confirm-placement").click();
    expect(intents.confirmPlacement).toHaveBeenCalledTimes(2);
    expect(intents.confirmPlacement).toHaveBeenLastCalledWith({
      kind: "relocate",
      buildingId: "a",
      position: { x: -2, y: 7 },
    });
    expect(ui.isWorldPlacementEnabled()).toBe(false);
    expect(get("placement-preview").hidden).toBe(true);

    move.click();
    b.children[3].click();
    expect(ui.isWorldPlacementEnabled()).toBe(true);
    intents.demolish.mockImplementation((id) => {
      if (id === "a") expect(ui.isWorldPlacementEnabled()).toBe(false);
    });
    a.children[a.children.length - 1].click();
    expect(intents.demolish).toHaveBeenLastCalledWith("a");
    move.click();
    get("seed-input").value = "reset-seed";
    get("new-world").click();
    expect(intents.reset).toHaveBeenCalledExactlyOnceWith("reset-seed");
    expect(ui.isWorldPlacementEnabled()).toBe(false);
    expect(get("placement-preview").hidden).toBe(true);
    ui.render(snapshot());
    expect(get("building-list").children).toHaveLength(0);
    move.click();
    expect(ui.isWorldPlacementEnabled()).toBe(false);
    ui.dispose();
    ui.render(snapshot());
  });

  it("keeps icon panels, exclusive resources/skills, placement visibility and save/quick stats", () => {
    const { ui, intents, get } = setupUi();
    ui.render(snapshot());
    for (const name of [
      "build-menu",
      "character-status",
      "resources",
      "skill-tree",
    ]) {
      expect(get(`${name}-panel`).hidden).toBe(true);
      expect(get(`${name}-toggle`).getAttribute("aria-expanded")).toBe("false");
    }
    get("resources-toggle").click();
    get("skill-tree-toggle").click();
    expect(get("resources-panel").hidden).toBe(true);
    expect(get("skill-tree-panel").hidden).toBe(false);
    get("resources-toggle").click();
    expect(get("skill-tree-panel").hidden).toBe(true);
    get("character-status-toggle").click();
    get("build-menu-toggle").click();
    get("build-buttons").children[0].click();
    expect(ui.isWorldPlacementEnabled()).toBe(true);
    expect(intents.confirmPlacement).not.toHaveBeenCalled();
    for (const name of [
      "build-menu",
      "character-status",
      "resources",
      "skill-tree",
    ])
      expect(get(`${name}-panel`).hidden).toBe(true);
    expect(get("build-buttons").children[0].getAttribute("aria-pressed")).toBe(
      "true",
    );
    const placed: PlacementResult = {
      ok: true,
      outcome: "placed",
      building: { ...building("c"), kind: "Campfire" },
    };
    intents.confirmPlacement.mockReturnValue(placed);
    ui.applyWorldPlacement({ x: 3, y: 8 });
    expect(intents.confirmPlacement).not.toHaveBeenCalled();
    expect(get("placement-preview").hidden).toBe(false);
    ui.applyWorldPlacement({ x: 3, y: 8 });
    expect(intents.confirmPlacement).toHaveBeenCalledExactlyOnceWith({
      kind: "place",
      buildingKind: "Campfire",
      position: { x: 3, y: 8 },
    });
    expect(ui.isWorldPlacementEnabled()).toBe(false);
    expect(get("placement-message").textContent).toContain("Campfire placed");
    expect(get("quick-health").textContent).toBe("♥ 90/100");
    expect(get("quick-level").textContent).toBe("✦ L0 · 0 XP");
    expect(
      get("resources").children.map((chip) => chip.getAttribute("aria-label")),
    ).toEqual([
      "Wood: 120",
      "Stone: 120",
      "Metal / Scrap: 120",
      "Essence: 120",
      "Boss Core: 1",
    ]);
    expect(get("resources").children[4].textContent).toBe("◉ 1");
    expect(get("build-buttons").children).toHaveLength(9);
    expect(get("build-buttons").children[3].textContent).toBe("✚ Healing Hut");
    expect(get("build-buttons").children[3].getAttribute("aria-label")).toBe(
      "Place Healing Hut",
    );
    expect(get("build-buttons").children[4].textContent).toBe("🪵 Wood Wall");
    expect(get("build-buttons").children[4].getAttribute("aria-label")).toBe(
      "Place Wood Wall",
    );
    expect(get("build-buttons").children[5].textContent).toBe("🪨 Stone Wall");
    expect(get("build-buttons").children[6].textContent).toBe(
      "🏹 Archer Tower",
    );
    expect(get("build-buttons").children[7].textContent).toBe("⚔ Sword Tower");
    expect(get("build-buttons").children[8].textContent).toBe("✦ Mage Tower");
    expect(get("build-radius").textContent).toContain(
      "snap to 1m tile centres",
    );
    const save = get("save-button"),
      writes = save.writes;
    ui.render(snapshot());
    expect(save.writes).toBe(writes);
    save.click();
    expect(intents.save).toHaveBeenCalledOnce();
    ui.render({ ...snapshot(), canSave: false });
    expect(save.disabled).toBe(true);
    expect(save.textContent).toBe("Save at campfire (move closer)");
    ui.dispose();
    save.click();
    expect(intents.save).toHaveBeenCalledOnce();
  });

  it("retains keyed choices with class and skill modals preceding boss choices", () => {
    const { ui, intents, get } = setupUi();
    const pending: GameUiSnapshot = {
      ...snapshot(),
      pendingClassChoices: ["knight", "wizard", "archer"],
      pendingUpgradeChoices: ["sharpened-blade", "quick-hands", "iron-skin"],
    };
    ui.render(pending);
    const wizard = get("class-choices").children[1];
    const boss = get("upgrade-choices").children[0];
    ui.render({ ...pending });
    expect(get("class-choices").children[1]).toBe(wizard);
    expect(get("upgrade-choices").children[0]).toBe(boss);
    expect(get("class-modal").hidden).toBe(false);
    expect(get("upgrade-modal").hidden).toBe(true);
    wizard.click();
    expect(intents.chooseClass).toHaveBeenCalledExactlyOnceWith("wizard");
    const skills: GameUiSnapshot = {
      ...pending,
      pendingClassChoices: [],
      pendingClassSkillChoices: ["wizard-flame-orb", "wizard-wide-blast"],
      classProgression: {
        experience: 100,
        level: 2,
        playerClass: "wizard",
        skillIds: [],
        allocatedStats: {
          strength: 0,
          dexterity: 0,
          agility: 0,
          luck: 0,
          vitality: 0,
          magic: 0,
        },
      },
    };
    ui.render(skills);
    expect(get("upgrade-modal").hidden).toBe(true);
    get("class-choices").children[0].click();
    expect(intents.chooseClassSkill).toHaveBeenCalledExactlyOnceWith(
      "wizard-flame-orb",
    );
    ui.render({
      ...skills,
      pendingClassSkillChoices: [],
      classProgression: {
        ...skills.classProgression,
        skillIds: ["wizard-flame-orb"],
      },
    });
    expect(get("class-modal").hidden).toBe(true);
    expect(get("upgrade-modal").hidden).toBe(false);
    expect(get("skill-tree-skills").children[0].textContent).toContain(
      "Flame Orb: selected",
    );
    expect(get("skill-tree-summary").textContent).toContain(
      "Wizard · level 2 · 1/24",
    );
    boss.click();
    expect(intents.chooseUpgrade).toHaveBeenCalledExactlyOnceWith(
      "sharpened-blade",
    );
    ui.dispose();
  });
});
