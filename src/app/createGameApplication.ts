import { GameSession } from "../domain/GameSession";
import type { BuildingKind, UpgradeId, Vector2 } from "../domain/types";
import { createKeyboardInput } from "../platform/input/keyboardInput";
import { createVirtualStickInput } from "../platform/input/virtualStickInput";
import { createBrowserLifecycle } from "../platform/lifecycle/browserLifecycle";
import { createThreeRenderer } from "../platform/render/threeRenderer";
import { createBrowserSaveStorage } from "../platform/storage/browserSaveStorage";
import { createGameUi } from "../ui/gameUi";

export interface GameApplication {
  dispose(): void;
}

/** The only composition root: it explicitly retains one GameSession and wires narrow adapters. */
export const createGameApplication = (root: HTMLElement): GameApplication => {
  const storage = createBrowserSaveStorage();
  const recovered = storage.load();
  const session = new GameSession({ saved: recovered.document ?? undefined });
  let platformMessage =
    recovered.warning ??
    (recovered.source === "primary"
      ? "Recovered last explicit campfire save."
      : "Fresh runtime: no committed save loaded.");
  let animationFrame = 0;
  let previousFrame = performance.now();

  const ui = createGameUi(root, {
    save(): void {
      const request = session.createValidCampfireSaveRequest(Date.now());
      if (request === null) {
        platformMessage =
          "Save was not committed: move to a valid campfire first.";
        return;
      }
      const result = storage.commit(request.document);
      if (result.ok) session.recordSaveCommitted(request.document);
      platformMessage = result.ok
        ? `${result.message} Save point: ${request.savePointLabel}.`
        : result.message;
    },
    reset(seed: string): void {
      session.resetWorld(seed);
      platformMessage =
        "New deterministic runtime started. Existing browser saves are untouched until a fresh load; this action did not save.";
    },
    place(kind: BuildingKind, position: Vector2): void {
      session.placeBuilding(kind, position);
    },
    relocate(id: string, position: Vector2): void {
      session.relocateBuilding(id, position);
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
  });
  const renderer = createThreeRenderer(ui.worldHost);
  const keyboard = createKeyboardInput((command) => session.move(command));
  const stick = createVirtualStickInput(ui.virtualStick, (command) =>
    session.move(command),
  );
  const lifecycle = createBrowserLifecycle((message) => {
    platformMessage = message;
  });

  const frame = (now: number): void => {
    session.tick((now - previousFrame) / 1_000);
    previousFrame = now;
    const snapshot = session.snapshot();
    renderer.render(snapshot);
    ui.render(snapshot);
    ui.showTransient(platformMessage);
    animationFrame = requestAnimationFrame(frame);
  };
  animationFrame = requestAnimationFrame(frame);

  return {
    dispose(): void {
      cancelAnimationFrame(animationFrame);
      lifecycle.dispose();
      stick.dispose();
      keyboard.dispose();
      renderer.dispose();
      ui.dispose();
    },
  };
};
