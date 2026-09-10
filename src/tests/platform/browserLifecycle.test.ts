import { describe, expect, it } from "vitest";
import { createBrowserLifecycle } from "../../platform/lifecycle/browserLifecycle";

class FakeDocument {
  visibilityState: DocumentVisibilityState = "visible";
  listener: (() => void) | null = null;
  adds = 0; removes = 0;
  addEventListener(_type: "visibilitychange", listener: () => void): void { this.adds += 1; this.listener = listener; }
  removeEventListener(_type: "visibilitychange", listener: () => void): void { this.removes += 1; if (this.listener === listener) this.listener = null; }
  emit(state: DocumentVisibilityState): void { this.visibilityState = state; this.listener?.(); }
}

describe("browser lifecycle port", () => {
  it("signals inactive/active and removes its listener on disposal", () => {
    const document = new FakeDocument();
    const events: boolean[] = [];
    const lifecycle = createBrowserLifecycle(undefined, document);
    lifecycle.subscribe((active) => events.push(active));
    document.emit("hidden");
    document.emit("visible");
    lifecycle.dispose();
    lifecycle.dispose();
    expect(events).toEqual([true, false, true]);
    expect(document.adds).toBe(1);
    expect(document.removes).toBe(1);
  });
});
