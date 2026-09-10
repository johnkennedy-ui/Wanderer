import { GameSession } from "../domain/GameSession";
import type {
  BuildingKind,
  ClassSkillId,
  PlayerClass,
  UpgradeId,
  Vector2,
} from "../domain/types";
import { createBuildPlacementInput } from "../platform/input/buildPlacementInput";
import { createKeyboardInput } from "../platform/input/keyboardInput";
import { createTapToMoveInput } from "../platform/input/tapToMoveInput";
import { createVirtualStickInput } from "../platform/input/virtualStickInput";
import { createBrowserLifecycle } from "../platform/lifecycle/browserLifecycle";
import { createBrowserFrameScheduler } from "../platform/lifecycle/browserFrameScheduler";
import { createThreeRenderer } from "../platform/render/threeRenderer";
import { createAsyncBrowserSaveStorage } from "../platform/storage/browserSaveStorage";
import { createGameUi } from "../ui/gameUi";
import { createApplicationLifecycle } from "./applicationLifecycle";

export interface GameApplication {
  dispose(): void;
}

/** The only composition root: it explicitly retains one GameSession and wires narrow adapters. */
export const createGameApplication = async (root: HTMLElement): Promise<GameApplication> => {
  const storage = createAsyncBrowserSaveStorage();
  const recovered = await storage.load();
  const session = new GameSession({
    saved: recovered.ok ? recovered.document : undefined,
  });
  let platformMessage: string;
  if (recovered.ok) {
    platformMessage =
      recovered.warning ?? "Recovered last explicit campfire save.";
  } else if (recovered.failure === "absent") {
    platformMessage = "Fresh runtime: no committed save loaded.";
  } else {
    platformMessage = `Save was not loaded: ${recovered.message} Existing browser save data was left untouched.`;
  }
  const scheduler = createBrowserFrameScheduler();
  let animationFrame: number | null = null;
  let previousFrame = scheduler.now();
  let active = true;
  let savePending = false;
  let disposed = false;

  const ui = createGameUi(root, {
    async save(): Promise<void> {
      if (savePending) return;
      const request = session.createValidCampfireSaveRequest(Date.now());
      if (request === null) {
        platformMessage =
          "Save was not committed: move to a valid campfire first.";
        return;
      }
      savePending = true;
      const result = await storage.commit(request.document);
      savePending = false;
      if (result.ok) session.recordSaveCommitted(request.document);
      platformMessage = result.ok
        ? `${result.message}${result.cleanupWarning === null ? "" : ` ${result.cleanupWarning}`} Save point: ${request.savePointLabel}.`
        : result.message;
    },
    reset(seed: string): void {
      session.resetWorld(seed);
      platformMessage =
        "New deterministic runtime started. Existing browser saves are untouched until a fresh load; this action did not save.";
    },
    place(kind: BuildingKind, position: Vector2) {
      return session.placeBuilding(kind, position);
    },
    relocate(id: string, position: Vector2) {
      return session.relocateBuilding(id, position);
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
  });
  const renderer = createThreeRenderer(ui.worldHost);
  const keyboard = createKeyboardInput((command) => session.move(command));
  const stick = createVirtualStickInput(ui.virtualStick, (command) =>
    session.move(command),
  );
  const tapToMove = createTapToMoveInput(
    renderer.canvas,
    renderer.worldPositionFromClientPoint,
    ui.isTapToMoveEnabled,
    (command) => session.setDestination(command),
    ui.isWorldPlacementEnabled,
  );
  const buildPlacement = createBuildPlacementInput(
    renderer.canvas,
    renderer.worldPositionFromClientPoint,
    ui.isWorldPlacementEnabled,
    (position) => ui.applyWorldPlacement(position),
  );
  const lifecycle = createBrowserLifecycle((message) => {
    platformMessage = message;
  });

  const applicationLifecycle = createApplicationLifecycle(
    lifecycle,
    scheduler,
    (deltaSeconds) => {
    session.tick(deltaSeconds);
    const presentation = session.presentation();
    renderer.render(presentation.renderer);
    ui.render(presentation.ui);
    ui.showTransient(platformMessage);
    },
  );

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      active = false;
      applicationLifecycle.dispose();
      buildPlacement.dispose();
      tapToMove.dispose();
      stick.dispose();
      keyboard.dispose();
      renderer.dispose();
      ui.dispose();
    },
  };
};
