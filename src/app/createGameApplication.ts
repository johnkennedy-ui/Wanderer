import { GameSession } from "../domain/GameSession";
import type {
  AllocatablePlayerStatKind,
  ClassSkillId,
  PlayerClass,
  UpgradeId,
} from "../domain/types";
import type { PlacementRequest } from "../domain/placement";
import { createBuildPlacementInput } from "../platform/input/buildPlacementInput";
import { createKeyboardInput } from "../platform/input/keyboardInput";
import { createTapToMoveInput } from "../platform/input/tapToMoveInput";
import { createBrowserLifecycle } from "../platform/lifecycle/browserLifecycle";
import { createBrowserFrameScheduler } from "../platform/lifecycle/browserFrameScheduler";
import { createThreeRenderer } from "../platform/render/threeRenderer";
import { createAsyncBrowserSaveStorage } from "../platform/storage/browserSaveStorage";
import { createGameUi } from "../ui/gameUi";
import {
  createApplicationBootstrap,
  createApplicationLifecycle,
  createCampfireSaveIntent,
} from "./applicationLifecycle";
import {
  advanceSimulationFrame,
  type SimulationSpeedMultiplier,
} from "./simulationSpeed";

export interface GameApplication {
  dispose(): void;
}

/** The only composition root: it explicitly retains one GameSession and wires narrow adapters. */
export const createGameApplication = async (
  root: HTMLElement,
): Promise<GameApplication> => {
  const storage = createAsyncBrowserSaveStorage();
  const bootstrap = await createApplicationBootstrap(
    storage,
    (saved) => new GameSession({ saved }),
  );
  const { session } = bootstrap;
  let platformMessage = bootstrap.platformMessage;
  let simulationSpeedMultiplier: SimulationSpeedMultiplier = 1;
  const scheduler = createBrowserFrameScheduler();
  let disposed = false;
  let resetPlacementInput = (): void => {};

  const saveIntent = createCampfireSaveIntent(
    session,
    storage,
    (message) => {
      platformMessage = message;
    },
    () => Date.now(),
  );

  const ui = createGameUi(root, {
    async save(): Promise<void> {
      await saveIntent.save();
    },
    reset(seed: string): void {
      session.resetWorld(seed);
      platformMessage =
        "New deterministic runtime started. Existing browser saves are untouched until a fresh load; this action did not save.";
    },
    previewPlacement(request: PlacementRequest) {
      return session.previewBuildingPlacement(request);
    },
    confirmPlacement(request: PlacementRequest) {
      return session.commitBuildingPlacement(request);
    },
    resetPlacementInput(): void {
      resetPlacementInput();
    },
    upgradeBuilding(id: string): void {
      session.upgradeBuilding(id);
    },
    demolish(id: string): void {
      session.demolishBuilding(id);
    },
    chooseUpgrade(id: UpgradeId): void {
      session.chooseUpgrade(id);
    },
    chooseClass(playerClass: PlayerClass): void {
      session.chooseClass(playerClass);
    },
    chooseClassSkill(skillId: ClassSkillId): void {
      session.chooseClassSkill(skillId);
    },
    allocateStat(kind: AllocatablePlayerStatKind): void {
      session.allocateStat(kind);
    },
    setSimulationSpeed(multiplier): void {
      simulationSpeedMultiplier = multiplier;
    },
  });
  const renderer = createThreeRenderer(ui.worldHost);
  const keyboard = createKeyboardInput((command) => session.move(command));
  const tapToMove = createTapToMoveInput(
    renderer.canvas,
    renderer.worldPositionFromClientPoint,
    (command) => session.setDestination(command),
    ui.isWorldPlacementEnabled,
  );
  const buildPlacement = createBuildPlacementInput(
    renderer.canvas,
    renderer.worldPositionFromClientPoint,
    ui.isWorldPlacementEnabled,
    ui.isWallPlacementEnabled,
    {
      tap: (position) => ui.applyWorldPlacement(position),
      previewWallDrag: (start, end) => ui.previewWorldPlacement(start, end),
      stageWallDrag: (start, end) => ui.applyWorldPlacement(start, end),
      clearWallDragPreview: () => ui.clearWorldPlacementDraft(),
    },
  );
  resetPlacementInput = buildPlacement.reset;
  const lifecycle = createBrowserLifecycle((message) => {
    platformMessage = message;
  });

  const applicationLifecycle = createApplicationLifecycle(
    lifecycle,
    scheduler,
    (deltaSeconds) => {
      advanceSimulationFrame(
        deltaSeconds,
        simulationSpeedMultiplier,
        (stepSeconds) => session.tick(stepSeconds),
      );
      const presentation = session.presentation();
      const placementValidationKey = ui.hasStagedPlacementPreview()
        ? JSON.stringify([
            presentation.renderer.presentationResetId,
            presentation.renderer.enemies
              .filter((enemy) => !enemy.defeated && enemy.hp > 0)
              .map((enemy) => [enemy.id, enemy.position.x, enemy.position.y]),
          ])
        : undefined;
      ui.render(presentation.ui, placementValidationKey);
      renderer.render(presentation.renderer, ui.placementPreview());
      ui.showTransient(platformMessage);
    },
  );

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      applicationLifecycle.dispose();
      buildPlacement.dispose();
      tapToMove.dispose();
      keyboard.dispose();
      renderer.dispose();
      ui.dispose();
    },
  };
};
