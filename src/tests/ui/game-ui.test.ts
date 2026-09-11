import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RetainedBuildingRows,
  RetainedEffects,
  setText,
} from "../../ui/retainedLists";
import { createGameUi, type UiIntents } from "../../ui/gameUi";
import type { BuildingState } from "../../domain/types";
import type { GameUiSnapshot, PlacementResult } from "../../domain/notices";

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
  materialCapacity: 120,
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
  buildings,
  effects: ["same effect"],
  pendingUpgradeChoices: [],
  classProgression: {
    experience: 0,
    level: 0,
    playerClass: null,
    skillIds: [],
  },
  pendingClassChoices: [],
  pendingClassSkillChoices: [],
  canSave: true,
  savePointLabel: "Home",
  notice: { kind: "session.ready" },
});
const setupUi = () => {
  installDom();
  const root = new ElementDouble();
  const intents = {
    save: vi.fn(),
    reset: vi.fn(),
    place: vi.fn<UiIntents["place"]>(),
    relocate: vi.fn<UiIntents["relocate"]>(),
    upgradeBuilding: vi.fn(),
    demolish: vi.fn(),
    chooseUpgrade: vi.fn(),
    chooseClass: vi.fn(),
    chooseClassSkill: vi.fn(),
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
  it("retained relocation waits for the latest next tap, retains rejection, and cancels on success/demolition/reset", () => {
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
    expect(intents.relocate).not.toHaveBeenCalled();
    expect(ui.isWorldPlacementEnabled()).toBe(true);
    intents.relocate.mockReturnValue({
      ok: false,
      rejection: { kind: "overlaps-existing-building" },
    });
    ui.applyWorldPlacement({ x: 9, y: -4 });
    expect(intents.relocate).toHaveBeenLastCalledWith("a", { x: 9, y: -4 });
    const rejected = get("placement-message").textContent;
    expect(rejected).toContain("overlaps an existing building");
    ui.render(
      snapshot([{ ...building("a"), kind: "Healer" }, building("b", 5)]),
    );
    expect(get("placement-message").textContent).toBe(rejected);
    expect(ui.isWorldPlacementEnabled()).toBe(true);
    intents.relocate.mockReturnValue({
      ok: true,
      outcome: "relocated",
      building: building("a"),
    });
    ui.applyWorldPlacement({ x: -2, y: 7 });
    expect(intents.relocate).toHaveBeenLastCalledWith("a", { x: -2, y: 7 });
    expect(ui.isWorldPlacementEnabled()).toBe(false);
    move.click();
    get("cancel-placement").click();
    ui.applyWorldPlacement({ x: 99, y: 99 });
    expect(intents.relocate).toHaveBeenCalledTimes(2);
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
    expect(get("placement-message").textContent).toBe("");
    ui.render(snapshot());
    expect(get("building-list").children).toHaveLength(0);
    move.click();
    expect(ui.isWorldPlacementEnabled()).toBe(false);
    ui.dispose();
    ui.render(snapshot());
  });

  it("keeps four icon panels, exclusive resources/skills, placement visibility and save/quick stats", () => {
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
    get("tap-to-move-toggle").checked = true;
    get("build-buttons").children[0].click();
    expect(ui.isTapToMoveEnabled()).toBe(true);
    expect(ui.isWorldPlacementEnabled()).toBe(true);
    expect(intents.place).not.toHaveBeenCalled();
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
    intents.place.mockReturnValue(placed);
    ui.applyWorldPlacement({ x: 3, y: 8 });
    expect(intents.place).toHaveBeenCalledExactlyOnceWith("Campfire", {
      x: 3,
      y: 8,
    });
    expect(ui.isWorldPlacementEnabled()).toBe(false);
    expect(get("placement-message").textContent).toContain("Campfire placed");
    expect(get("quick-health").textContent).toBe("♥ 90/100");
    expect(get("quick-level").textContent).toBe("✦ L0 · 0 XP");
    expect(get("resource-capacity").textContent).toContain(
      "Boss Core is exempt",
    );
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
    expect(get("build-buttons").children[4].textContent).toBe("✚");
    expect(get("build-buttons").children[4].getAttribute("aria-label")).toBe(
      "Place Healing Hut",
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
      "Wizard · level 2 · 1/4",
    );
    boss.click();
    expect(intents.chooseUpgrade).toHaveBeenCalledExactlyOnceWith(
      "sharpened-blade",
    );
    ui.dispose();
  });
});
