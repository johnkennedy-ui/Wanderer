import {
  buildingDefinitions,
  classDefinitionFor,
  classSkillDefinitionFor,
  classSkillDefinitions,
  upgradeDefinitionFor,
} from "../data/definitions";
import type { GameUiSnapshot, PlacementResult } from "../domain/notices";
import { buildingKinds } from "../domain/types";
import type {
  BuildingKind,
  ClassSkillId,
  PlayerClass,
  UpgradeId,
  Vector2,
} from "../domain/types";
import {
  presentGameNotice,
  presentPlacementNotice,
  presentPlacementResult,
} from "./noticePresentation";
import {
  RetainedBuildingRows,
  RetainedEffects,
  setAttribute,
  setText as text,
} from "./retainedLists";

export interface UiIntents {
  save(): void;
  reset(seed: string): void;
  place(kind: BuildingKind, position: Vector2): PlacementResult;
  relocate(id: string, position: Vector2): PlacementResult;
  upgradeBuilding(id: string): void;
  demolish(id: string): void;
  chooseUpgrade(id: UpgradeId): void;
  chooseClass(playerClass: PlayerClass): void;
  chooseClassSkill(skillId: ClassSkillId): void;
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

/** Deliberately replaceable visual tokens; accessible labels carry the meaning. */
const buildingPlaceholderIcons: Record<BuildingKind, string> = {
  Campfire: "⌁",
  Workshop: "⚒",
  Farm: "⌘",
  Storage: "▣",
  Healer: "✚",
};

const resourcePlaceholderIcons = {
  wood: "◫",
  stone: "◆",
  scrap: "⛓",
  essence: "✦",
  bossCore: "◉",
} as const;

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
        <span aria-hidden="true">⌁</span>
      </button>
      <button type="button" class="hud-circle-button" data-testid="character-status-toggle" aria-label="Character Status" aria-controls="character-status-panel" aria-expanded="false" title="Character Status">
        <span aria-hidden="true">♥</span>
      </button>
      <button type="button" class="hud-circle-button" data-testid="resources-toggle" aria-label="Resources" aria-controls="resources-panel" aria-expanded="false" title="Resources">
        <span aria-hidden="true">◉</span>
      </button>
      <button type="button" class="hud-circle-button" data-testid="skill-tree-toggle" aria-label="Skill Tree" aria-controls="skill-tree-panel" aria-expanded="false" title="Skill Tree">
        <span aria-hidden="true">✦</span>
      </button>
      <button type="button" class="hud-circle-button" data-testid="stats-toggle" aria-label="Stats" aria-controls="stats-panel" aria-expanded="false" title="Stats">
        <span aria-hidden="true">◈</span>
      </button>
    </nav>
    <div class="hud-quick-stats" data-testid="quick-stats" aria-label="Current health and level">
      <span data-testid="quick-health"></span>
      <span data-testid="quick-level"></span>
    </div>
    <section id="character-status-panel" data-testid="character-status-panel" class="top-panel panel" aria-label="Character Status" hidden>
      <header class="panel-heading"><h2>Character Status</h2><button type="button" class="panel-close" data-testid="close-character-status" aria-label="Close Character Status">×</button></header>
      <div><strong>Wanderer</strong> <span class="subtle">browser MVP · manual campfire saves</span></div>
      <div class="status-grid">
        <span data-testid="seed"></span>
        <span data-testid="position"></span>
        <span data-testid="health"></span>
        <span data-testid="class-progression"></span>
        <span data-testid="combat-status"></span>
        <span data-testid="wave-status" aria-live="polite"></span>
        <span data-testid="projectile-status"></span>
      </div>
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
    <section id="resources-panel" data-testid="resources-panel" class="side-panel panel resources-panel" aria-label="Resources" hidden>
      <header class="panel-heading"><h2>Resources</h2><button type="button" class="panel-close" data-testid="close-resources" aria-label="Close Resources">×</button></header>
      <div class="resource-list" data-testid="resources"></div>
      <p class="subtle" data-testid="resource-capacity"></p>
    </section>
    <section id="skill-tree-panel" data-testid="skill-tree-panel" class="side-panel panel skill-tree-panel" aria-label="Skill Tree" hidden>
      <header class="panel-heading"><h2>Skill Tree</h2><button type="button" class="panel-close" data-testid="close-skill-tree" aria-label="Close Skill Tree">×</button></header>
      <p data-testid="skill-tree-summary" class="subtle"></p>
      <ul data-testid="skill-tree-skills" class="effects"></ul>
    </section>
    <section id="stats-panel" data-testid="stats-panel" class="side-panel panel stats-panel" aria-label="Stats" hidden>
      <header class="panel-heading"><h2>Stats</h2><button type="button" class="panel-close" data-testid="close-stats" aria-label="Close Stats">×</button></header>
      <dl data-testid="stats-list" class="stats-list"></dl>
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
    <section class="upgrade-modal class-modal" data-testid="class-modal" hidden aria-live="assertive">
      <div class="upgrade-card">
        <h2 data-testid="class-modal-title">Choose a class</h2>
        <p data-testid="class-modal-description">Your class changes your stationary auto-attack.</p>
        <div data-testid="class-choices" class="upgrade-choices"></div>
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
  const classModal = byTestId<HTMLElement>("class-modal");
  const classModalTitle = byTestId<HTMLElement>("class-modal-title");
  const classModalDescription = byTestId<HTMLElement>(
    "class-modal-description",
  );
  const classChoices = byTestId<HTMLDivElement>("class-choices");
  const virtualStick = byTestId<HTMLDivElement>("virtual-stick");
  const statusPanel = byTestId<HTMLElement>("character-status-panel");
  const buildMenuPanel = byTestId<HTMLElement>("build-menu-panel");
  const resourcesPanel = byTestId<HTMLElement>("resources-panel");
  const skillTreePanel = byTestId<HTMLElement>("skill-tree-panel");
  const statsPanel = byTestId<HTMLElement>("stats-panel");
  const statusPanelToggle = byTestId<HTMLButtonElement>(
    "character-status-toggle",
  );
  const buildMenuToggle = byTestId<HTMLButtonElement>("build-menu-toggle");
  const resourcesToggle = byTestId<HTMLButtonElement>("resources-toggle");
  const skillTreeToggle = byTestId<HTMLButtonElement>("skill-tree-toggle");
  const statsToggle = byTestId<HTMLButtonElement>("stats-toggle");
  const closeStatusPanel = byTestId<HTMLButtonElement>(
    "close-character-status",
  );
  const closeBuildMenu = byTestId<HTMLButtonElement>("close-build-menu");
  const closeResources = byTestId<HTMLButtonElement>("close-resources");
  const closeSkillTree = byTestId<HTMLButtonElement>("close-skill-tree");
  const closeStats = byTestId<HTMLButtonElement>("close-stats");

  const setPanelVisibility = (
    panel: HTMLElement,
    toggle: HTMLButtonElement,
    visible: boolean,
  ): void => {
    if (panel.hidden !== !visible) panel.hidden = !visible;
    setAttribute(toggle, "aria-expanded", String(visible));
  };
  let statusPanelVisible = false;
  let buildMenuVisible = false;
  let resourcesPanelVisible = false;
  let skillTreePanelVisible = false;
  let statsPanelVisible = false;
  let placementMode: PlacementMode = null;
  let placementFeedback = "";
  let disposed = false;

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
  const setResourcesPanelVisible = (visible: boolean): void => {
    resourcesPanelVisible = visible;
    setPanelVisibility(resourcesPanel, resourcesToggle, visible);
  };
  const setSkillTreePanelVisible = (visible: boolean): void => {
    skillTreePanelVisible = visible;
    setPanelVisibility(skillTreePanel, skillTreeToggle, visible);
  };
  const setStatsPanelVisible = (visible: boolean): void => {
    statsPanelVisible = visible;
    setPanelVisibility(statsPanel, statsToggle, visible);
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
  resourcesToggle.addEventListener("click", () => {
    const visible = !resourcesPanelVisible;
    setResourcesPanelVisible(visible);
    if (visible) {
      setSkillTreePanelVisible(false);
      setStatsPanelVisible(false);
    }
  });
  skillTreeToggle.addEventListener("click", () => {
    const visible = !skillTreePanelVisible;
    setSkillTreePanelVisible(visible);
    if (visible) {
      setResourcesPanelVisible(false);
      setStatsPanelVisible(false);
    }
  });
  statsToggle.addEventListener("click", () => {
    const visible = !statsPanelVisible;
    setStatsPanelVisible(visible);
    if (visible) {
      setResourcesPanelVisible(false);
      setSkillTreePanelVisible(false);
    }
  });
  closeStats.addEventListener("click", () => setStatsPanelVisible(false));
  closeStatusPanel.addEventListener("click", () =>
    setStatusPanelVisible(false),
  );
  closeBuildMenu.addEventListener("click", () => setBuildMenuVisible(false));
  closeResources.addEventListener("click", () =>
    setResourcesPanelVisible(false),
  );
  closeSkillTree.addEventListener("click", () =>
    setSkillTreePanelVisible(false),
  );
  cancelPlacement.addEventListener("click", () => setPlacementMode(null));

  const startPlacement = (mode: Exclude<PlacementMode, null>): void => {
    setPlacementFeedback("");
    setPlacementMode(mode);
    // Placement needs an unobstructed world surface. Selecting any build or
    // relocation mode therefore dismisses both informational panels while the
    // dedicated placement feedback remains visible.
    setStatusPanelVisible(false);
    setBuildMenuVisible(false);
    setResourcesPanelVisible(false);
    setSkillTreePanelVisible(false);
    setStatsPanelVisible(false);
  };
  for (const kind of buildingKinds) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "build-option";
    button.dataset.testid = `build-${kind}`;
    button.textContent = buildingPlaceholderIcons[kind];
    button.setAttribute(
      "aria-label",
      `Place ${buildingDefinitions[kind].label}`,
    );
    button.title = `${buildingDefinitions[kind].label}: ${buildingDefinitions[kind].description}`;
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
  const buildingRows = new RetainedBuildingRows(buildingList, {
    startRelocation(id, kind): void {
      startPlacement({ kind: "relocate", buildingId: id, buildingKind: kind });
    },
    upgradeBuilding: (id) => intents.upgradeBuilding(id),
    demolish(id): void {
      if (placementMode?.kind === "relocate" && placementMode.buildingId === id)
        setPlacementMode(null);
      intents.demolish(id);
    },
  });
  const effects = new RetainedEffects(byTestId<HTMLUListElement>("effects"));
  const skillTree = new RetainedEffects(
    byTestId<HTMLUListElement>("skill-tree-skills"),
  );
  const resourceChips = (
    [
      ["wood", "Wood"],
      ["stone", "Stone"],
      ["scrap", "Metal / Scrap"],
      ["essence", "Essence"],
      ["bossCore", "Boss Core"],
    ] as const
  ).map(([kind, label]) => {
    const element = document.createElement("span");
    element.className = "resource-chip";
    element.title = label;
    byTestId("resources").append(element);
    return { kind, label, element };
  });
  const statRows = (
    [
      ["strength", "Strength"],
      ["dexterity", "Dexterity"],
      ["agility", "Agility"],
      ["luck", "Luck"],
      ["vitality", "Vitality"],
      ["magic", "Magic"],
      ["defense", "Defense"],
      ["magicDefense", "Magic Defense"],
    ] as const
  ).map(([kind, label]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const value = document.createElement("dd");
    byTestId("stats-list").append(term, value);
    return { kind, value };
  });

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
      if (disposed || mode === null) return;
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
      if (disposed) return;
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
      text(
        byTestId("class-progression"),
        snapshot.classProgression.playerClass === null
          ? `Experience: ${snapshot.classProgression.experience} · level ${snapshot.classProgression.level} · class unselected`
          : `Experience: ${snapshot.classProgression.experience} · level ${snapshot.classProgression.level} · ${classDefinitionFor(snapshot.classProgression.playerClass).label}`,
      );
      text(
        byTestId("quick-health"),
        `♥ ${Math.ceil(snapshot.player.hp)}/${snapshot.player.maxHp}`,
      );
      text(
        byTestId("quick-level"),
        `✦ L${snapshot.classProgression.level} · ${snapshot.classProgression.experience} XP`,
      );
      text(byTestId("combat-status"), snapshot.combatStatus);
      text(
        byTestId("wave-status"),
        snapshot.wave.active
          ? `Wave ${snapshot.wave.waveIndex} active · ${Math.ceil(snapshot.wave.secondsRemaining)}s remaining · ${snapshot.wave.bossName ?? "large boss"}`
          : snapshot.wave.bossActive
            ? `Wave ${snapshot.wave.waveIndex} boss remains: ${snapshot.wave.bossName}`
            : `Next wave in ${Math.ceil(snapshot.wave.nextWaveInSeconds)}s`,
      );
      text(
        byTestId("projectile-status"),
        snapshot.projectileCount === 1
          ? "Projectile: 1 in flight"
          : `Projectile: ${snapshot.projectileCount} in flight`,
      );
      for (const { kind, label, element } of resourceChips) {
        setAttribute(
          element,
          "aria-label",
          `${label}: ${snapshot.resources[kind]}`,
        );
        text(
          element,
          `${resourcePlaceholderIcons[kind]} ${snapshot.resources[kind]}`,
        );
      }
      text(
        byTestId("resource-capacity"),
        `Capacity ${snapshot.materialCapacity} each; Boss Core is exempt.`,
      );
      text(
        byTestId("build-radius"),
        `Campfire can bootstrap anywhere valid. Nearby settlement placement currently reaches ${snapshot.buildRadius}m; Campfire L1/L2/L3 use 6m/9m/12m. Healing Hut L1/L2/L3 auras use 3m/4m/5m.`,
      );
      text(byTestId("message"), presentGameNotice(snapshot.notice));
      if (saveButton.disabled !== !snapshot.canSave)
        saveButton.disabled = !snapshot.canSave;
      text(
        saveButton,
        snapshot.canSave
          ? `Save at ${snapshot.savePointLabel}`
          : "Save at campfire (move closer)",
      );
      const placementNotice = presentPlacementNotice(snapshot.notice);
      if (placementNotice !== "") setPlacementFeedback(placementNotice);

      buildingRows.render(snapshot.buildings);
      effects.render(snapshot.effects);
      const skillTreeSummary = byTestId<HTMLElement>("skill-tree-summary");
      if (snapshot.classProgression.playerClass === null) {
        text(
          skillTreeSummary,
          `Level ${snapshot.classProgression.level} · choose a class when the class choice appears.`,
        );
        skillTree.render([]);
      } else {
        const playerClass = snapshot.classProgression.playerClass;
        const selectedSkillIds = new Set(snapshot.classProgression.skillIds);
        text(
          skillTreeSummary,
          `${classDefinitionFor(playerClass).label} · level ${snapshot.classProgression.level} · ${snapshot.classProgression.skillIds.length}/4 class skills selected.`,
        );
        skillTree.render(
          classSkillDefinitions
            .filter((skill) => skill.playerClass === playerClass)
            .map((skill) => {
              const selected = selectedSkillIds.has(skill.id);
              return `T${skill.tier} · ${skill.label}: ${selected ? "selected" : skill.description}`;
            }),
        );
      }
      for (const { kind, value } of statRows)
        text(value, String(snapshot.playerStats[kind]));
      const hasClassChoice =
        snapshot.pendingClassChoices.length > 0 ||
        snapshot.pendingClassSkillChoices.length > 0;
      const hideUpgrades =
        hasClassChoice || snapshot.pendingUpgradeChoices.length === 0;
      if (upgradeModal.hidden !== hideUpgrades)
        upgradeModal.hidden = hideUpgrades;
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
      if (classModal.hidden !== !hasClassChoice)
        classModal.hidden = !hasClassChoice;
      const classChoiceKey = [
        ...snapshot.pendingClassChoices,
        ...snapshot.pendingClassSkillChoices,
      ].join("|");
      if (classChoices.dataset.choiceKey !== classChoiceKey) {
        classChoices.replaceChildren();
        if (snapshot.pendingClassChoices.length > 0) {
          text(classModalTitle, "Choose a class");
          text(
            classModalDescription,
            "Your class determines your auto-attack style. Choose once.",
          );
          for (const playerClass of snapshot.pendingClassChoices) {
            const definition = classDefinitionFor(playerClass);
            const button = document.createElement("button");
            button.dataset.testid = `class-${playerClass}`;
            button.textContent = `${definition.label}: ${definition.description}`;
            button.addEventListener("click", () =>
              intents.chooseClass(playerClass),
            );
            classChoices.append(button);
          }
        } else {
          text(classModalTitle, "Choose a class skill");
          text(
            classModalDescription,
            "Choose exactly one skill from your current class tier.",
          );
          for (const skillId of snapshot.pendingClassSkillChoices) {
            const definition = classSkillDefinitionFor(skillId);
            const button = document.createElement("button");
            button.dataset.testid = `class-skill-${skillId}`;
            button.textContent = `${definition.label}: ${definition.description}`;
            button.addEventListener("click", () =>
              intents.chooseClassSkill(skillId),
            );
            classChoices.append(button);
          }
        }
        classChoices.dataset.choiceKey = classChoiceKey;
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      setPlacementMode(null);
      buildingRows.dispose();
      effects.dispose();
      skillTree.dispose();
      saveButton.removeEventListener("click", intents.save);
      root.replaceChildren();
    },
  };
};
