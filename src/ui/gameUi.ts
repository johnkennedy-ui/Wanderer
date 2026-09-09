import {
  buildingDefinitions,
  gameplayTuning,
  upgradeDefinitionFor,
} from "../data/definitions";
import type { GameUiSnapshot, PlacementResult } from "../domain/notices";
import { buildingKinds } from "../domain/types";
import type { BuildingKind, UpgradeId, Vector2 } from "../domain/types";
import {
  presentGameNotice,
  presentPlacementNotice,
  presentPlacementResult,
} from "./noticePresentation";

export interface UiIntents {
  save(): void;
  reset(seed: string): void;
  place(kind: BuildingKind, position: Vector2): PlacementResult;
  relocate(id: string, position: Vector2): PlacementResult;
  upgradeBuilding(id: string): void;
  demolish(id: string): void;
  chooseUpgrade(id: UpgradeId): void;
}

type PlacementMode =
  | { readonly kind: "place"; readonly buildingKind: BuildingKind }
  | {
      readonly kind: "relocate";
      readonly buildingId: string;
      readonly buildingKind: BuildingKind;
    }
  | null;

export interface GameUi {
  readonly worldHost: HTMLElement;
  readonly virtualStick: HTMLElement;
  isTapToMoveEnabled(): boolean;
  isWorldPlacementEnabled(): boolean;
  applyWorldPlacement(position: Vector2): void;
  render(snapshot: GameUiSnapshot): void;
  showTransient(message: string): void;
  dispose(): void;
}

const text = (element: HTMLElement, value: string): void => {
  element.textContent = value;
};

const placementModeDescription = (mode: PlacementMode): string => {
  if (mode === null) return "Placement mode inactive.";
  const label = buildingDefinitions[mode.buildingKind].label;
  return mode.kind === "place"
    ? `${label} selected. Tap an open location in the world to place it.`
    : `${label} relocation selected. Tap an open location in the world to move it.`;
};

export const createGameUi = (root: HTMLElement, intents: UiIntents): GameUi => {
  root.replaceChildren();
  const worldHost = document.createElement("div");
  worldHost.className = "world-host";
  const ui = document.createElement("main");
  ui.className = "game-ui";
  ui.innerHTML = `
    <nav class="hud-action-dock" aria-label="Game menus">
      <button type="button" class="hud-circle-button" data-testid="build-menu-toggle" aria-label="Build" aria-controls="build-menu-panel" aria-expanded="false" title="Build">
        Build
      </button>
      <button type="button" class="hud-circle-button" data-testid="character-status-toggle" aria-label="Character Status" aria-controls="character-status-panel" aria-expanded="false" title="Character Status">
        Status
      </button>
    </nav>
    <section id="character-status-panel" data-testid="character-status-panel" class="top-panel panel" aria-label="Character Status" hidden>
      <header class="panel-heading"><h2>Character Status</h2><button type="button" class="panel-close" data-testid="close-character-status" aria-label="Close Character Status">×</button></header>
      <div><strong>Wanderer</strong> <span class="subtle">browser MVP · manual campfire saves</span></div>
      <div class="status-grid">
        <span data-testid="seed"></span>
        <span data-testid="position"></span>
        <span data-testid="health"></span>
        <span data-testid="combat-status"></span>
        <span data-testid="projectile-status"></span>
      </div>
      <div class="resources" data-testid="resources"></div>
      <p class="message" data-testid="message" aria-live="polite"></p>
      <p class="subtle" data-testid="boss-route-cue">Ember Wyrm route: the boss is 6m east of the home Campfire. Move east, then stop within basic-attack range.</p>
      <label class="seed-control">Known seed <input data-testid="seed-input" value="wanderer-known-seed" maxlength="48" /></label>
      <div class="status-actions">
        <button data-testid="new-world">New / reset world</button>
        <button data-testid="save-button">Save at campfire</button>
      </div>
      <label class="tap-to-move-toggle"><input data-testid="tap-to-move-toggle" type="checkbox" /> Tap-to-move</label>
      <p class="subtle">When enabled, tap an open part of the world to travel there. A selected building placement always takes priority for its next tap.</p>
      <p data-testid="save-message" class="subtle">No automatic save. Reload restores only the last explicit campfire commit.</p>
      <hr />
      <h2>Passive effects</h2>
      <ul data-testid="effects" class="effects"></ul>
      <p class="subtle" data-testid="native-truth-boundary">Browser MVP evidence only: native Android wrapper/device, APK/AAB, and Google Play evidence are unverified.</p>
    </section>
    <section id="build-menu-panel" data-testid="build-menu-panel" class="side-panel panel" aria-label="Build" hidden>
      <header class="panel-heading"><h2>Build</h2><button type="button" class="panel-close" data-testid="close-build-menu" aria-label="Close Build">×</button></header>
      <p class="subtle" data-testid="build-radius">Campfire can bootstrap anywhere valid. Other buildings use the active Campfire L1–L3 radius.</p>
      <div class="build-buttons" data-testid="build-buttons"></div>
      <div class="building-list" data-testid="building-list"></div>
    </section>
    <section class="placement-feedback" data-testid="placement-feedback" aria-label="Building placement feedback">
      <p data-testid="placement-mode" class="placement-mode" role="status" aria-live="polite">Placement mode inactive.</p>
      <button type="button" data-testid="cancel-placement" class="placement-cancel" hidden>Cancel placement</button>
      <p data-testid="placement-message" class="subtle" aria-live="polite"></p>
    </section>
    <section class="touch-controls" aria-label="Touch movement">
      <div class="virtual-stick" data-testid="virtual-stick" data-active="false" aria-label="Virtual movement stick">
        <div class="stick-knob" data-stick-knob></div>
      </div>
      <p>WASD / arrows · tap or drag the stick to move</p>
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
  const buildButtons = byTestId<HTMLDivElement>("build-buttons");
  const buildingList = byTestId<HTMLDivElement>("building-list");
  const saveButton = byTestId<HTMLButtonElement>("save-button");
  const tapToMoveToggle = byTestId<HTMLInputElement>("tap-to-move-toggle");
  const saveMessage = byTestId<HTMLParagraphElement>("save-message");
  const placementMessage = byTestId<HTMLParagraphElement>("placement-message");
  const placementModeElement = byTestId<HTMLParagraphElement>("placement-mode");
  const cancelPlacement = byTestId<HTMLButtonElement>("cancel-placement");
  const upgradeModal = byTestId<HTMLElement>("upgrade-modal");
  const upgradeChoices = byTestId<HTMLDivElement>("upgrade-choices");
  const virtualStick = byTestId<HTMLDivElement>("virtual-stick");
  const statusPanel = byTestId<HTMLElement>("character-status-panel");
  const buildMenuPanel = byTestId<HTMLElement>("build-menu-panel");
  const statusPanelToggle = byTestId<HTMLButtonElement>(
    "character-status-toggle",
  );
  const buildMenuToggle = byTestId<HTMLButtonElement>("build-menu-toggle");
  const closeStatusPanel = byTestId<HTMLButtonElement>(
    "close-character-status",
  );
  const closeBuildMenu = byTestId<HTMLButtonElement>("close-build-menu");

  const setPanelVisibility = (
    panel: HTMLElement,
    toggle: HTMLButtonElement,
    visible: boolean,
  ): void => {
    panel.hidden = !visible;
    toggle.setAttribute("aria-expanded", String(visible));
  };
  let statusPanelVisible = false;
  let buildMenuVisible = false;
  let placementMode: PlacementMode = null;
  let placementFeedback = "";
  let renderedBuildingStateKey: string | null = null;

  const setPlacementFeedback = (message: string): void => {
    placementFeedback = message;
    text(placementMessage, message);
  };

  const setStatusPanelVisible = (visible: boolean): void => {
    statusPanelVisible = visible;
    setPanelVisibility(statusPanel, statusPanelToggle, visible);
  };
  const setBuildMenuVisible = (visible: boolean): void => {
    buildMenuVisible = visible;
    setPanelVisibility(buildMenuPanel, buildMenuToggle, visible);
  };
  const setPlacementMode = (mode: PlacementMode): void => {
    placementMode = mode;
    worldHost.dataset.placementMode = mode === null ? "inactive" : "active";
    placementModeElement.hidden = mode === null;
    text(placementModeElement, placementModeDescription(mode));
    cancelPlacement.hidden = mode === null;
    for (const button of buildButtons.querySelectorAll<HTMLButtonElement>(
      'button[data-testid^="build-"]',
    ))
      button.setAttribute(
        "aria-pressed",
        String(
          mode?.kind === "place" &&
            button.dataset.testid === `build-${mode.buildingKind}`,
        ),
      );
  };
  statusPanelToggle.addEventListener("click", () => {
    setStatusPanelVisible(!statusPanelVisible);
  });
  buildMenuToggle.addEventListener("click", () => {
    setBuildMenuVisible(!buildMenuVisible);
  });
  closeStatusPanel.addEventListener("click", () =>
    setStatusPanelVisible(false),
  );
  closeBuildMenu.addEventListener("click", () => setBuildMenuVisible(false));
  cancelPlacement.addEventListener("click", () => setPlacementMode(null));

  const startPlacement = (mode: Exclude<PlacementMode, null>): void => {
    setPlacementFeedback("");
    setPlacementMode(mode);
    // Placement needs an unobstructed world surface. Selecting any build or
    // relocation mode therefore dismisses both informational panels while the
    // dedicated placement feedback remains visible.
    setStatusPanelVisible(false);
    setBuildMenuVisible(false);
  };
  for (const kind of buildingKinds) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "build-option";
    button.dataset.testid = `build-${kind}`;
    button.textContent = `Place ${buildingDefinitions[kind].label}`;
    button.title = buildingDefinitions[kind].description;
    button.addEventListener("click", () =>
      startPlacement({ kind: "place", buildingKind: kind }),
    );
    buildButtons.append(button);
  }
  setPlacementMode(null);
  byTestId<HTMLButtonElement>("new-world").addEventListener("click", () => {
    setPlacementMode(null);
    setPlacementFeedback("");
    intents.reset(seedInput.value);
  });
  saveButton.addEventListener("click", intents.save);

  return {
    worldHost,
    virtualStick,
    isTapToMoveEnabled(): boolean {
      return tapToMoveToggle.checked;
    },
    isWorldPlacementEnabled(): boolean {
      return placementMode !== null;
    },
    applyWorldPlacement(position: Vector2): void {
      const mode = placementMode;
      if (mode === null) return;
      const result =
        mode.kind === "place"
          ? intents.place(mode.buildingKind, position)
          : intents.relocate(mode.buildingId, position);
      setPlacementFeedback(presentPlacementResult(result));
      if (result.ok) setPlacementMode(null);
    },
    showTransient(message: string): void {
      text(saveMessage, message);
    },
    render(snapshot: GameUiSnapshot): void {
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
        byTestId("projectile-status"),
        snapshot.projectileCount === 1
          ? "Projectile: 1 in flight"
          : `Projectile: ${snapshot.projectileCount} in flight`,
      );
      text(
        byTestId("resources"),
        `Wood ${snapshot.resources.wood} · Stone ${snapshot.resources.stone} · Metal / Scrap ${snapshot.resources.scrap} · Essence ${snapshot.resources.essence} · Boss Core ${snapshot.resources.bossCore} · capacity ${snapshot.materialCapacity} each (Boss Core exempt)`,
      );
      text(
        byTestId("build-radius"),
        `Campfire can bootstrap anywhere valid. Nearby settlement placement currently reaches ${snapshot.buildRadius}m; Campfire L1/L2/L3 use 6m/9m/12m. Healing Hut L1/L2/L3 auras use 3m/4m/5m.`,
      );
      text(byTestId("message"), presentGameNotice(snapshot.notice));
      saveButton.disabled = !snapshot.canSave;
      saveButton.textContent = snapshot.canSave
        ? `Save at ${snapshot.savePointLabel}`
        : "Save at campfire (move closer)";
      const placementNotice = presentPlacementNotice(snapshot.notice);
      if (placementNotice !== "") setPlacementFeedback(placementNotice);

      const buildingStateKey = snapshot.buildings
        .map(
          (building) =>
            `${building.id}:${building.kind}:${building.level}:${building.position.x}:${building.position.y}`,
        )
        .join("|");
      if (buildingStateKey !== renderedBuildingStateKey) {
        renderedBuildingStateKey = buildingStateKey;
        buildingList.replaceChildren();
        for (const building of snapshot.buildings) {
          const definition = buildingDefinitions[building.kind];
          const row = document.createElement("div");
          row.className = "building-row";
          row.dataset.testid = `building-${building.id}`;
          const label = document.createElement("span");
          label.textContent = `${definition.label} L${building.level} @ ${building.position.x.toFixed(1)}, ${building.position.y.toFixed(1)}`;
          row.append(label);
          if (building.kind === "Healer") {
            const radius =
              gameplayTuning.healingHutRadiusByLevel[building.level - 1];
            const bonus =
              gameplayTuning.healerHealingBonusByLevel[building.level - 1];
            const aura = document.createElement("span");
            aura.className = "healing-radius";
            aura.dataset.testid = `healing-radius-${building.id}`;
            aura.setAttribute(
              "aria-label",
              `Healing Hut healing radius, level ${building.level}: ${radius} metres`,
            );
            aura.textContent = `Healing aura: ${radius}m radius · +${bonus} health/s while stationary inside`;
            row.append(aura);
          }
          const upgrade = document.createElement("button");
          upgrade.type = "button";
          upgrade.textContent = "Upgrade";
          upgrade.disabled = building.level === 3;
          upgrade.addEventListener("click", () =>
            intents.upgradeBuilding(building.id),
          );
          const move = document.createElement("button");
          move.type = "button";
          move.textContent = "Relocate on canvas";
          move.addEventListener("click", () =>
            startPlacement({
              kind: "relocate",
              buildingId: building.id,
              buildingKind: building.kind,
            }),
          );
          const demolish = document.createElement("button");
          demolish.type = "button";
          demolish.textContent = "Demolish";
          demolish.addEventListener("click", () => {
            if (
              placementMode?.kind === "relocate" &&
              placementMode.buildingId === building.id
            )
              setPlacementMode(null);
            intents.demolish(building.id);
          });
          row.append(upgrade, move, demolish);
          buildingList.append(row);
        }
      }

      const effects = byTestId<HTMLUListElement>("effects");
      effects.replaceChildren(
        ...snapshot.effects.map((effect) =>
          Object.assign(document.createElement("li"), { textContent: effect }),
        ),
      );
      upgradeModal.hidden = snapshot.pendingUpgradeChoices.length === 0;
      const choiceKey = snapshot.pendingUpgradeChoices.join("|");
      if (upgradeChoices.dataset.choiceKey !== choiceKey) {
        upgradeChoices.replaceChildren();
        for (const id of snapshot.pendingUpgradeChoices) {
          const definition = upgradeDefinitionFor(id);
          const button = document.createElement("button");
          button.dataset.testid = `upgrade-${id}`;
          button.textContent = `${definition.label}: ${definition.description}`;
          button.addEventListener("click", () => intents.chooseUpgrade(id));
          upgradeChoices.append(button);
        }
        upgradeChoices.dataset.choiceKey = choiceKey;
      }
    },
    dispose(): void {
      root.replaceChildren();
    },
  };
};
