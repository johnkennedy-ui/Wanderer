import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGameApplication } from "../../app/createGameApplication";
import type {
  FrameSchedulerPort,
  LifecyclePort,
} from "../../app/ports/lifecycle";
import type { LoadedSave, SaveStoragePort } from "../../app/ports/saveStorage";
import { GameSession } from "../../domain/GameSession";
import { createBuildPlacementInput } from "../../platform/input/buildPlacementInput";
import { createKeyboardInput } from "../../platform/input/keyboardInput";
import { createTapToMoveInput } from "../../platform/input/tapToMoveInput";
import { createBrowserLifecycle } from "../../platform/lifecycle/browserLifecycle";
import { createBrowserFrameScheduler } from "../../platform/lifecycle/browserFrameScheduler";
import {
  createThreeRenderer,
  type ThreeRenderer,
} from "../../platform/render/threeRenderer";
import { createAsyncBrowserSaveStorage } from "../../platform/storage/browserSaveStorage";
import { createGameUi, type GameUi } from "../../ui/gameUi";

// Replace browser adapters only: the composition root, lifecycle, speed helper,
// and deterministic GameSession all execute their real implementation.
vi.mock("../../platform/input/buildPlacementInput");
vi.mock("../../platform/input/keyboardInput");
vi.mock("../../platform/input/tapToMoveInput");
vi.mock("../../platform/lifecycle/browserLifecycle");
vi.mock("../../platform/lifecycle/browserFrameScheduler");
vi.mock("../../platform/render/threeRenderer");
vi.mock("../../platform/storage/browserSaveStorage");
vi.mock("../../ui/gameUi");

class Scheduler implements FrameSchedulerPort {
  nowValue = 0;
  next = 1;
  readonly frames = new Map<number, (now: number) => void>();
  now(): number {
    return this.nowValue;
  }
  request(frame: (now: number) => void): number {
    const id = this.next++;
    this.frames.set(id, frame);
    return id;
  }
  cancel(handle: number): void {
    this.frames.delete(handle);
  }
  fire(now: number): void {
    this.nowValue = now;
    const entry = this.frames.entries().next().value;
    if (entry === undefined) return;
    this.frames.delete(entry[0]);
    entry[1](now);
  }
}

class Lifecycle implements LifecyclePort {
  listener: ((active: boolean) => void) | null = null;
  dispose = vi.fn();
  subscribe(listener: (active: boolean) => void): () => void {
    this.listener = listener;
    listener(true);
    return () => {
      this.listener = null;
    };
  }
  emit(active: boolean): void {
    this.listener?.(active);
  }
}

const setup = async () => {
  const scheduler = new Scheduler();
  const lifecycle = new Lifecycle();
  const absent: LoadedSave = {
    ok: false,
    document: null,
    source: null,
    warning: null,
    failure: "absent",
    message: "No save exists.",
  };
  const storage = {
    load: vi.fn<SaveStoragePort["load"]>().mockResolvedValue(absent),
    commit: vi.fn<SaveStoragePort["commit"]>().mockResolvedValue({
      ok: true,
      message: "Saved explicitly.",
      cleanupWarning: null,
    }),
  };
  const ui = {
    worldHost: {} as HTMLElement,
    isWorldPlacementEnabled: vi.fn(() => false),
    applyWorldPlacement: vi.fn(),
    render: vi.fn<GameUi["render"]>(),
    showTransient: vi.fn(),
    dispose: vi.fn(),
  } satisfies GameUi;
  const renderer = {
    canvas: {} as HTMLCanvasElement,
    render: vi.fn<ThreeRenderer["render"]>(),
    worldPositionFromClientPoint: vi.fn(() => null),
    diagnostics: vi.fn<ThreeRenderer["diagnostics"]>(),
    dispose: vi.fn(),
  } satisfies ThreeRenderer;
  const keyboard = { dispose: vi.fn() };
  const tap = { dispose: vi.fn() };
  const placement = { dispose: vi.fn() };
  vi.mocked(createAsyncBrowserSaveStorage).mockReturnValue(storage);
  vi.mocked(createBrowserFrameScheduler).mockReturnValue(scheduler);
  vi.mocked(createBrowserLifecycle).mockReturnValue(lifecycle);
  vi.mocked(createGameUi).mockReturnValue(ui);
  vi.mocked(createThreeRenderer).mockReturnValue(renderer);
  vi.mocked(createKeyboardInput).mockReturnValue(keyboard);
  vi.mocked(createTapToMoveInput).mockReturnValue(tap);
  vi.mocked(createBuildPlacementInput).mockReturnValue(placement);
  const tick = vi.spyOn(GameSession.prototype, "tick");
  const presentation = vi.spyOn(GameSession.prototype, "presentation");
  const application = await createGameApplication({} as HTMLElement);
  const intents = vi.mocked(createGameUi).mock.calls.at(-1)?.[1];
  if (intents === undefined)
    throw new Error("Composition root did not wire UI intents");
  const session = (): GameSession => {
    const value = presentation.mock.contexts.at(-1);
    if (!(value instanceof GameSession))
      throw new Error("No real session frame observed");
    return value;
  };
  return {
    application,
    intents,
    scheduler,
    lifecycle,
    storage,
    ui,
    renderer,
    keyboard,
    tap,
    placement,
    tick,
    presentation,
    session,
  };
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("composition-root runtime speed integration", () => {
  it("wires 1×, 2×, 5× and back to 1× into real simulation with one presentation per frame", async () => {
    const app = await setup();
    try {
      expect(app.scheduler.frames.size).toBe(1);
      app.scheduler.fire(20);
      expect(app.tick.mock.calls).toEqual([[0.02]]);
      expect(app.session().diagnostics().elapsed).toBeCloseTo(0.02);
      app.intents.setSimulationSpeed(2);
      app.scheduler.fire(40);
      expect(app.tick.mock.calls.at(-1)).toEqual([0.04]);
      expect(app.session().diagnostics().elapsed).toBeCloseTo(0.06);
      app.intents.setSimulationSpeed(5);
      app.scheduler.fire(90);
      const accelerated = app.tick.mock.calls.slice(2).map(([delta]) => delta);
      expect(accelerated).toHaveLength(3);
      expect(accelerated[0]).toBe(0.1);
      expect(accelerated[1]).toBe(0.1);
      expect(accelerated[2]).toBeCloseTo(0.05);
      expect(app.session().diagnostics().elapsed).toBeCloseTo(0.31);
      app.intents.setSimulationSpeed(1);
      app.scheduler.fire(110);
      expect(app.tick.mock.calls.at(-1)).toEqual([0.02]);
      expect(app.session().diagnostics().elapsed).toBeCloseTo(0.33);
      expect(app.presentation).toHaveBeenCalledTimes(4);
      expect(app.renderer.render).toHaveBeenCalledTimes(4);
      expect(app.ui.render).toHaveBeenCalledTimes(4);
      expect(app.tick.mock.invocationCallOrder.at(-1)).toBeLessThan(
        app.presentation.mock.invocationCallOrder.at(-1)!,
      );
      expect(app.presentation.mock.invocationCallOrder.at(-1)).toBeLessThan(
        app.renderer.render.mock.invocationCallOrder.at(-1)!,
      );
      expect(app.storage.commit).not.toHaveBeenCalled();
    } finally {
      app.application.dispose();
    }
  });

  it("bounds accelerated gaps, pauses without catch-up, and disposes every adapter once without saving", async () => {
    const app = await setup();
    try {
      app.intents.setSimulationSpeed(5);
      app.scheduler.fire(1_000);
      expect(app.tick.mock.calls).toEqual(
        Array.from({ length: 5 }, () => [0.1]),
      );
      expect(app.session().diagnostics().elapsed).toBeCloseTo(0.5);
      expect(app.renderer.render).toHaveBeenCalledTimes(1);
      app.lifecycle.emit(false);
      expect(app.scheduler.frames.size).toBe(0);
      app.scheduler.fire(60_000);
      expect(app.tick).toHaveBeenCalledTimes(5);
      app.lifecycle.emit(true);
      app.scheduler.fire(60_020);
      expect(app.tick).toHaveBeenCalledTimes(6);
      expect(app.session().diagnostics().elapsed).toBeCloseTo(0.6);
      expect(app.renderer.render).toHaveBeenCalledTimes(2);
    } finally {
      app.application.dispose();
    }
    app.application.dispose();
    expect(app.scheduler.frames.size).toBe(0);
    expect(app.lifecycle.listener).toBeNull();
    for (const adapter of [
      app.lifecycle,
      app.keyboard,
      app.tap,
      app.placement,
      app.renderer,
      app.ui,
    ])
      expect(adapter.dispose).toHaveBeenCalledTimes(1);
    app.scheduler.fire(61_000);
    expect(app.tick).toHaveBeenCalledTimes(6);
    expect(app.storage.commit).not.toHaveBeenCalled();
  });

  it("keeps speed runtime-only across world reset and starts each new application at 1×", async () => {
    const app = await setup();
    try {
      app.intents.setSimulationSpeed(5);
      app.scheduler.fire(20);
      app.intents.reset("settings-speed-reset");
      // The released reset deliberately preserves elapsed session time.
      expect(app.session().diagnostics().elapsed).toBeCloseTo(0.1);
      app.scheduler.fire(40);
      expect(app.session().diagnostics().world.seed).toBe(
        "settings-speed-reset",
      );
      expect(app.session().diagnostics().elapsed).toBeCloseTo(0.2);
      expect(app.storage.commit).not.toHaveBeenCalled();
    } finally {
      app.application.dispose();
    }
    const fresh = await setup();
    try {
      fresh.scheduler.fire(20);
      expect(fresh.session().diagnostics().elapsed).toBeCloseTo(0.02);
      expect(fresh.storage.commit).not.toHaveBeenCalled();
    } finally {
      fresh.application.dispose();
    }
  });
});
