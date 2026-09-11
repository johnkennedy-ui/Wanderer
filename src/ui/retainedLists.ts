import { buildingDefinitions, gameplayTuning } from "../data/definitions";
import type { BuildingKind, BuildingState } from "../domain/types";

export const setText = (element: HTMLElement, value: string): void => {
  if (element.textContent !== value) element.textContent = value;
};

export const setAttribute = (
  element: HTMLElement,
  name: string,
  value: string,
): void => {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
};

interface BuildingRowIntents {
  startRelocation(id: string, kind: BuildingKind): void;
  upgradeBuilding(id: string): void;
  demolish(id: string): void;
}
interface BuildingRow {
  readonly element: HTMLDivElement;
  readonly label: HTMLSpanElement;
  readonly upgrade: HTMLButtonElement;
  kind: BuildingKind;
  aura: HTMLSpanElement | null;
  dispose(): void;
}

/** Disposable projection only. Stable listeners read the latest rendered kind;
 * world coordinates belong to the subsequent public placement tap, not a row. */
export class RetainedBuildingRows {
  private readonly rows = new Map<string, BuildingRow>();
  private disposed = false;
  constructor(
    private readonly host: HTMLElement,
    private readonly intents: BuildingRowIntents,
  ) {}

  render(buildings: readonly BuildingState[]): void {
    if (this.disposed) return;
    const visible = new Set(buildings.map((building) => building.id));
    for (const [id, row] of this.rows) {
      if (visible.has(id)) continue;
      row.dispose();
      this.rows.delete(id);
    }
    let previous: HTMLElement | null = null;
    for (const building of buildings) {
      let row = this.rows.get(building.id);
      if (row === undefined) {
        row = this.createRow(building);
        this.rows.set(building.id, row);
      }
      row.kind = building.kind;
      setText(
        row.label,
        `${buildingDefinitions[building.kind].label} L${building.level} @ ${building.position.x.toFixed(1)}, ${building.position.y.toFixed(1)}`,
      );
      if (building.kind === "Healer") {
        if (row.aura === null) {
          row.aura = document.createElement("span");
          row.aura.className = "healing-radius";
          row.aura.dataset.testid = `healing-radius-${building.id}`;
          row.element.insertBefore(row.aura, row.upgrade);
        }
        const radius =
          gameplayTuning.healingHutRadiusByLevel[building.level - 1];
        const bonus =
          gameplayTuning.healerHealingBonusByLevel[building.level - 1];
        setAttribute(
          row.aura,
          "aria-label",
          `Healing Hut healing radius, level ${building.level}: ${radius} metres`,
        );
        setText(
          row.aura,
          `Healing aura: ${radius}m radius · +${bonus} health/s while stationary inside`,
        );
      } else if (row.aura !== null) {
        row.aura.remove();
        row.aura = null;
      }
      const disabled = building.level === 3;
      if (row.upgrade.disabled !== disabled) row.upgrade.disabled = disabled;
      const expected: ChildNode | null =
        previous === null ? this.host.firstChild : previous.nextSibling;
      if (expected !== row.element)
        this.host.insertBefore(row.element, expected);
      previous = row.element;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const row of this.rows.values()) row.dispose();
    this.rows.clear();
  }

  private createRow(building: BuildingState): BuildingRow {
    const id = building.id;
    const element = document.createElement("div");
    element.className = "building-row";
    element.dataset.testid = `building-${id}`;
    const label = document.createElement("span");
    const upgrade = document.createElement("button");
    upgrade.type = "button";
    upgrade.textContent = "Upgrade";
    const move = document.createElement("button");
    move.type = "button";
    move.textContent = "Relocate on canvas";
    const demolish = document.createElement("button");
    demolish.type = "button";
    demolish.textContent = "Demolish";
    const onUpgrade = (): void => this.intents.upgradeBuilding(id);
    const onMove = (): void => this.intents.startRelocation(id, row.kind);
    const onDemolish = (): void => this.intents.demolish(id);
    const row: BuildingRow = {
      element,
      label,
      upgrade,
      kind: building.kind,
      aura: null,
      dispose(): void {
        upgrade.removeEventListener("click", onUpgrade);
        move.removeEventListener("click", onMove);
        demolish.removeEventListener("click", onDemolish);
        element.remove();
      },
    };
    upgrade.addEventListener("click", onUpgrade);
    move.addEventListener("click", onMove);
    demolish.addEventListener("click", onDemolish);
    element.append(label, upgrade, move, demolish);
    return row;
  }
}

export class RetainedEffects {
  private signature: string | null = null;
  private disposed = false;
  constructor(private readonly host: HTMLElement) {}
  render(effects: readonly string[]): void {
    if (this.disposed) return;
    const signature = JSON.stringify(effects);
    if (signature === this.signature) return;
    this.host.replaceChildren(
      ...effects.map((effect) =>
        Object.assign(document.createElement("li"), { textContent: effect }),
      ),
    );
    this.signature = signature;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.host.replaceChildren();
    this.signature = null;
  }
}
