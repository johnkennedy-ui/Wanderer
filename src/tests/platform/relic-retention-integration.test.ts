import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { RetainedProjection } from "../../platform/render/retainedProjectionHelpers";
import { createThreeRenderer } from "../../platform/render/threeRenderer";
import {
  meshFor,
  rendererDom,
  rendererSnapshot,
} from "./renderer-test-helpers";

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: class {
    setPixelRatio() {}
    setClearColor() {}
    setSize() {}
    render() {}
    dispose() {}
  },
}));
afterEach(() => vi.unstubAllGlobals());

const relicFrame = () => {
  const snapshot = rendererSnapshot();
  return {
    ...snapshot,
    weaponRelicDrops: [
      {
        id: "relic:one",
        position: { x: 3, y: 4 },
        waveIndex: 1,
        bossName: "Fixture boss",
      },
      {
        id: "relic:two",
        position: { x: -2, y: 5 },
        waveIndex: 2,
        bossName: "Fixture boss",
      },
    ],
    projectiles: [
      {
        ...snapshot.projectiles[0],
        id: "homing",
        style: "magic" as const,
        homing: true,
      },
      {
        ...snapshot.projectiles[0],
        id: "ordinary",
        style: "magic" as const,
        homing: false,
      },
    ],
  };
};

describe("released relic visuals in the retained projection", () => {
  it("keeps relic and homing canvas diagnostics current", () => {
    const dom = rendererDom();
    const renderer = createThreeRenderer(dom.host);
    const frame = relicFrame();
    renderer.render(frame);
    expect(dom.canvas.dataset.weaponRelicDropCount).toBe("2");
    expect(dom.canvas.dataset.homingProjectileCount).toBe("1");
    expect(dom.canvas.dataset.projectileCount).toBe("2");
    renderer.render({
      ...frame,
      weaponRelicDrops: [],
      projectiles: frame.projectiles.map((projectile) => ({
        ...projectile,
        homing: false,
      })),
    });
    expect(dom.canvas.dataset.weaponRelicDropCount).toBe("0");
    expect(dom.canvas.dataset.homingProjectileCount).toBe("0");
    expect(dom.canvas.dataset.projectileCount).toBe("2");
    renderer.dispose();
  });
  it("preserves exact released relic/homing shape and material with shared resources", () => {
    const projection = new RetainedProjection();
    projection.render(relicFrame());
    const relic = meshFor(projection, "relic:one");
    const twin = meshFor(projection, "relic:two");
    expect(relic.position.toArray()).toEqual([3, 0.38, -4]);
    expect(
      (relic.geometry as THREE.OctahedronGeometry).parameters,
    ).toMatchObject({ radius: 0.34, detail: 0 });
    expect(twin.geometry).toBe(relic.geometry);
    expect(twin.material).toBe(relic.material);
    const material = relic.material as THREE.MeshStandardMaterial;
    expect(material.color.getHex()).toBe(0xffe082);
    expect(material.emissive.getHex()).toBe(0xff8f00);
    expect(material).toMatchObject({
      emissiveIntensity: 1.1,
      roughness: 0.2,
      metalness: 0.55,
    });
    const homing = meshFor(projection, "homing");
    expect((homing.geometry as THREE.SphereGeometry).parameters.radius).toBe(
      0.28,
    );
    expect((homing.material as THREE.MeshStandardMaterial).color.getHex()).toBe(
      0xe6d6ff,
    );
    expect(
      (homing.material as THREE.MeshStandardMaterial).emissive.getHex(),
    ).toBe(0xab78ff);
    expect(
      (meshFor(projection, "ordinary").geometry as THREE.SphereGeometry)
        .parameters.radius,
    ).toBe(0.23);
    projection.dispose();
  });

  it("retains identical frames, updates homing in place, removes relics and disposes once", () => {
    const projection = new RetainedProjection();
    const frame = relicFrame();
    projection.render(frame);
    const before = projection.diagnostics();
    const homing = meshFor(projection, "homing");
    const ordinary = meshFor(projection, "ordinary");
    for (let index = 0; index < 50; index += 1)
      projection.render(structuredClone(frame));
    expect(projection.diagnostics()).toEqual(before);
    projection.render({
      ...frame,
      projectiles: frame.projectiles.map((projectile) => ({
        ...projectile,
        homing: false,
      })),
    });
    expect(meshFor(projection, "homing")).toBe(homing);
    expect(homing.geometry).toBe(ordinary.geometry);
    expect(homing.material).toBe(ordinary.material);
    expect(projection.diagnostics()).toEqual(before);
    projection.render({ ...frame, weaponRelicDrops: [] });
    expect(projection.diagnostics().maps.relicDrops).toBe(0);
    expect(projection.diagnostics().meshesRemoved).toBe(
      before.meshesRemoved + 2,
    );
    expect(projection.group.getObjectByName("relic:one")).toBeUndefined();
    projection.dispose();
    const disposed = projection.diagnostics();
    expect(disposed.geometriesDisposed).toBe(disposed.geometriesCreated);
    expect(disposed.materialsDisposed).toBe(disposed.materialsCreated);
    projection.dispose();
    expect(projection.diagnostics()).toEqual(disposed);
  });
});
