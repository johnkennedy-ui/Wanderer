import { buildingDefinitions, upgradeDefinitions } from "../data/definitions";
import type {
  BuildingKind,
  GameSnapshot,
  UpgradeId,
  Vector2,
} from "../domain/types";

export interface UiIntents {
  save(): void;
  reset(seed: string): void;
  place(kind: BuildingKind, position: Vector2): void;
  relocate(id: string, position: Vector2): void;
  upgradeBuilding(id: string): void;
  demolish(id: string): void;
  chooseUpgrade(id: UpgradeId): void;
}

export interface GameUi {
  readonly worldHost: HTMLElement;
  readonly virtualStick: HTMLElement;
  render(snapshot: GameSnapshot): void;
  showTransient(message: string): void;
  dispose(): void;
}

const buildingKinds: readonly BuildingKind[] = [
  "Campfire",
  "Workshop",
  "Farm",
  "Storage",
  "Healer",
];

const text = (element: HTMLElement, value: string): void => {
  element.textContent = value;
};

export const createGameUi = (root: HTMLElement, intents: UiIntents): GameUi => {
  root.replaceChildren();
  const worldHost = document.createElement("div");
  worldHost.className = "world-host";
  const ui = document.createElement("main");
  ui.className = "game-ui";
  ui.innerHTML = `
    <section class="top-panel panel" aria-label="Wanderer status">
      <div><strong>Wanderer</strong> <span class="subtle">browser MVP · manual campfire saves</span></div>
      <div class="status-grid">
        <span data-testid="seed"></span>
        <span data-testid="position"></span>
        <span data-testid="health"></span>
        <span data-testid="combat-status"></span>
      </div>
      <div class="resources" data-testid="resources"></div>
      <p class="message" data-testid="message" aria-live="polite"></p>
    </section>
    <section class="side-panel panel" aria-label="World controls">
      <label>Known seed <input data-testid="seed-input" value="wanderer-known-seed" maxlength="48" /></label>
      <button data-testid="new-world">New / reset world</button>
      <button data-testid="save-button">Save at campfire</button>
      <p data-testid="save-message" class="subtle">No automatic save. Reload restores only the last explicit campfire commit.</p>
      <hr />
      <h2>Freeform building</h2>
      <div class="coordinates">
        <label>X <input data-testid="building-x" type="number" step="0.5" value="1" /></label>
        <label>Y <input data-testid="building-y" type="number" step="0.5" value="1" /></label>
      </div>
      <p class="subtle">Campfire can bootstrap anywhere valid. Other buildings must be within 6m of a campfire.</p>
      <div class="build-buttons" data-testid="build-buttons"></div>
      <p data-testid="placement-message" class="subtle"></p>
      <div class="building-list" data-testid="building-list"></div>
      <hr />
      <h2>Passive effects</h2>
      <ul data-testid="effects" class="effects"></ul>
    </section>
    <section class="touch-controls" aria-label="Touch movement">
      <div class="virtual-stick" data-testid="virtual-stick" aria-label="Virtual movement stick">
        <div class="stick-knob" data-stick-knob></div>
      </div>
      <p>WASD / arrows · drag the stick to move</p>
    </section>
    <section class="upgrade-modal" data-testid="upgrade-modal" hidden aria-live="assertive">
      <div class="upgrade-card">
        <h2>Boss Core: choose one upgrade</h2>
        <p>Exactly one choice applies now. It becomes durable only after a later campfire Save.</p>
        <div data-testid="upgrade-choices" class="upgrade-choices"></div>
      </div>
    </section>
  `;
  root.append(worldHost, ui);

  const byTestId = <T extends HTMLElement>(testId: string): T => {
    const element = ui.querySelector<T>(`[data-testid="${testId}"]`);
    if (element === null) throw new Error(`Missing UI element ${testId}`);
    return element;
  };
  const seedInput = byTestId<HTMLInputElement>("seed-input");
  const xInput = byTestId<HTMLInputElement>("building-x");
  const yInput = byTestId<HTMLInputElement>("building-y");
  const buildButtons = byTestId<HTMLDivElement>("build-buttons");
  const buildingList = byTestId<HTMLDivElement>("building-list");
  const saveButton = byTestId<HTMLButtonElement>("save-button");
  const saveMessage = byTestId<HTMLParagraphElement>("save-message");
  const placementMessage = byTestId<HTMLParagraphElement>("placement-message");
  const upgradeModal = byTestId<HTMLElement>("upgrade-modal");
  const upgradeChoices = byTestId<HTMLDivElement>("upgrade-choices");
  const virtualStick = byTestId<HTMLDivElement>("virtual-stick");

  const readPosition = (): Vector2 => ({
    x: Number(xInput.value),
    y: Number(yInput.value),
  });
  for (const kind of buildingKinds) {
    const button = document.createElement("button");
    button.dataset.testid = `build-${kind}`;
    button.textContent = `Place ${kind}`;
    button.title = buildingDefinitions[kind].description;
    button.addEventListener("click", () => intents.place(kind, readPosition()));
    buildButtons.append(button);
  }
  byTestId<HTMLButtonElement>("new-world").addEventListener("click", () =>
    intents.reset(seedInput.value),
  );
  saveButton.addEventListener("click", intents.save);

  return {
    worldHost,
    virtualStick,
    showTransient(message: string): void {
      text(saveMessage, message);
    },
    render(snapshot: GameSnapshot): void {
      text(
        byTestId("seed"),
        `Seed: ${snapshot.world.seed} · generator ${snapshot.world.generatorVersion}`,
      );
      text(
        byTestId("position"),
        `Position: ${snapshot.player.position.x.toFixed(1)}, ${snapshot.player.position.y.toFixed(1)} · input: ${snapshot.inputSource}`,
      );
      text(
        byTestId("health"),
        `Health: ${Math.ceil(snapshot.player.hp)} / ${snapshot.player.maxHp}`,
      );
      text(byTestId("combat-status"), snapshot.combatStatus);
      text(
        byTestId("resources"),
        `Wood ${snapshot.resources.wood} · Ore ${snapshot.resources.ore} · Food ${snapshot.resources.food} · Boss Cores ${snapshot.resources.bossCore}`,
      );
      text(byTestId("message"), snapshot.message);
      saveButton.disabled = !snapshot.canSave;
      saveButton.textContent = snapshot.canSave
        ? `Save at ${snapshot.savePointLabel}`
        : "Save at campfire (move closer)";
      placementMessage.textContent =
        snapshot.message.startsWith("Building") ||
        snapshot.message.includes("placed") ||
        snapshot.message.includes("relocated") ||
        snapshot.message.includes("demolished")
          ? snapshot.message
          : "";

      buildingList.replaceChildren();
      for (const building of snapshot.buildings) {
        const row = document.createElement("div");
        row.className = "building-row";
        row.dataset.testid = `building-${building.id}`;
        const label = document.createElement("span");
        label.textContent = `${building.kind} L${building.level} @ ${building.position.x.toFixed(1)}, ${building.position.y.toFixed(1)}`;
        const upgrade = document.createElement("button");
        upgrade.textContent = "Upgrade";
        upgrade.disabled = building.level === 3;
        upgrade.addEventListener("click", () =>
          intents.upgradeBuilding(building.id),
        );
        const move = document.createElement("button");
        move.textContent = "Move to X/Y";
        move.addEventListener("click", () =>
          intents.relocate(building.id, readPosition()),
        );
        const demolish = document.createElement("button");
        demolish.textContent = "Demolish";
        demolish.addEventListener("click", () => intents.demolish(building.id));
        row.append(label, upgrade, move, demolish);
        buildingList.append(row);
      }

      const effects = byTestId<HTMLUListElement>("effects");
      effects.replaceChildren(
        ...snapshot.effects.map((effect) =>
          Object.assign(document.createElement("li"), { textContent: effect }),
        ),
      );
      upgradeModal.hidden = snapshot.pendingUpgradeChoices.length === 0;
      upgradeChoices.replaceChildren();
      for (const id of snapshot.pendingUpgradeChoices) {
        const definition = upgradeDefinitions.find(
          (upgrade) => upgrade.id === id,
        );
        const button = document.createElement("button");
        button.dataset.testid = `upgrade-${id}`;
        button.textContent = `${definition?.label ?? id}: ${definition?.description ?? ""}`;
        button.addEventListener("click", () => intents.chooseUpgrade(id));
        upgradeChoices.append(button);
      }
    },
    dispose(): void {
      root.replaceChildren();
    },
  };
};
