import { describe, expect, it } from "vitest";
import { createApplicationLifecycle } from "../../app/applicationLifecycle";
import type {
  FrameSchedulerPort,
  LifecyclePort,
} from "../../app/ports/lifecycle";

class FakeScheduler implements FrameSchedulerPort {
  nowValue = 0;
  next = 1;
  readonly frames = new Map<number, (now: number) => void>();
  cancelled: number[] = [];
  now(): number {
    return this.nowValue;
  }
  request(frame: (now: number) => void): number {
    const id = this.next++;
    this.frames.set(id, frame);
    return id;
  }
  cancel(handle: number): void {
    this.cancelled.push(handle);
    this.frames.delete(handle);
  }
  fire(now: number): void {
    const item = this.frames.entries().next().value as
      [number, (at: number) => void] | undefined;
    if (!item) return;
    this.frames.delete(item[0]);
    item[1](now);
  }
}
class FakeLifecycle implements LifecyclePort {
  listener: ((active: boolean) => void) | null = null;
  disposals = 0;
  constructor(private readonly initialActive = true) {}
  subscribe(listener: (active: boolean) => void): () => void {
    this.listener = listener;
    listener(this.initialActive);
    return () => {
      this.listener = null;
    };
  }
  dispose(): void {
    this.disposals += 1;
  }
  emit(active: boolean): void {
    this.listener?.(active);
  }
}
describe("application lifecycle", () => {
  it("cancels hidden work, resets resume timing, and cleans up idempotently", () => {
    const scheduler = new FakeScheduler();
    const lifecycle = new FakeLifecycle();
    const deltas: number[] = [];
    const app = createApplicationLifecycle(lifecycle, scheduler, (delta) =>
      deltas.push(delta),
    );
    scheduler.fire(100);
    lifecycle.emit(false);
    scheduler.nowValue = 100000;
    lifecycle.emit(true);
    scheduler.fire(100016);
    app.dispose();
    app.dispose();
    expect(deltas).toEqual([0.1, 0.016]);
    expect(scheduler.cancelled.length).toBeGreaterThan(0);
    expect(lifecycle.disposals).toBe(1);
  });

  it("starts inactive without scheduling or ticking until resumed", () => {
    const scheduler = new FakeScheduler();
    const lifecycle = new FakeLifecycle(false);
    const deltas: number[] = [];
    const app = createApplicationLifecycle(lifecycle, scheduler, (delta) =>
      deltas.push(delta),
    );
    scheduler.fire(100);
    expect(deltas).toEqual([]);
    lifecycle.emit(true);
    scheduler.fire(16);
    expect(deltas).toEqual([0.016]);
    app.dispose();
  });
});
