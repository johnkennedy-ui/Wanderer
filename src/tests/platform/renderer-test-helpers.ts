import { vi } from "vitest";
import * as THREE from "three";
import type { GameRendererSnapshot } from "../../domain/notices";
import { GameSession } from "../../domain/GameSession";
import type { RetainedProjection } from "../../platform/render/retainedProjectionHelpers";

export const rendererSnapshot = (): GameRendererSnapshot => ({
  ...new GameSession().presentation().renderer,
  playerHitRecovery: { active: false, flashOn: false },
  visibleBuildings: [
    {
      id: "building:fixture:1",
      kind: "Storage",
      level: 1,
      position: { x: 1, y: 1 },
    },
  ],
  projectiles: [
    {
      id: "projectile:1",
      origin: { x: 0, y: 0 },
      targetPosition: { x: 4, y: 2 },
      targetId: "target",
      progress: 0.5,
      style: "basic",
    },
  ],
  floorDrops: [
    { id: "drop:1", resource: "wood", amount: 5, position: { x: 3, y: 4 } },
  ],
});

export const visualVariantSnapshot = (): GameRendererSnapshot => {
  const snapshot = rendererSnapshot();
  return {
    ...snapshot,
    visibleBuildings: [
      ...snapshot.visibleBuildings,
      ...([1, 2, 3] as const).map((level) => ({
        id: `hut:${level}`,
        kind: "Healer" as const,
        level,
        position: { x: level * 2, y: -level * 3 },
      })),
      { id: "hut:twin", kind: "Healer", level: 1, position: { x: -7, y: 9 } },
    ],
    crescentAttacks: [
      ...[2.4, 3].flatMap((radius) =>
        [0.5, 0.25].map((arcCosine) => ({
          id: `crescent:${radius}:${arcCosine}`,
          origin: { x: -2, y: 3 },
          direction: { x: 0, y: 1 },
          radius,
          arcCosine,
          progress: 0.5,
        })),
      ),
      {
        id: "crescent:twin",
        origin: { x: 4, y: -5 },
        direction: { x: 1, y: 0 },
        radius: 2.4,
        arcCosine: 0.5,
        progress: 0,
      },
    ],
    projectiles: (["basic", "slash", "magic", "arrow"] as const).flatMap(
      (style) => [
        { ...snapshot.projectiles[0], id: `shot:${style}`, style },
        { ...snapshot.projectiles[0], id: `twin:${style}`, style },
      ],
    ),
  };
};

export const meshFor = (
  projection: RetainedProjection,
  id: string,
): THREE.Mesh => {
  const mesh = projection.group.getObjectByName(id);
  if (!(mesh instanceof THREE.Mesh)) throw new Error(`missing mesh ${id}`);
  return mesh;
};

/** Only adapter-owned DOM operations; actual DOM behavior is covered in Playwright. */
export const rendererDom = () => {
  const bounds = { left: 0, top: 0, width: 800, height: 600 };
  const canvas = {
    dataset: {} as Record<string, string>,
    className: "",
    remove: vi.fn(),
    getBoundingClientRect: () => bounds,
  };
  const label = {
    dataset: {} as Record<string, string>,
    className: "",
    remove: vi.fn(),
    setAttribute: vi.fn(),
    style: { left: "", top: "" },
    textContent: "",
  };
  const host = { append: vi.fn(), clientWidth: 800, clientHeight: 600 };
  let resize = (): void => {};
  const observer = {
    observe: vi.fn(),
    disconnect: vi.fn(),
    resize: () => resize(),
  };
  vi.stubGlobal("document", {
    createElement: (tag: string) => (tag === "canvas" ? canvas : label),
  });
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = observer.observe;
      disconnect = observer.disconnect;
    },
  );
  return {
    canvas,
    label,
    host: host as unknown as HTMLElement,
    observer,
    bounds,
  };
};
