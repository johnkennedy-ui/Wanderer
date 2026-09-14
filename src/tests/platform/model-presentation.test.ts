import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  ModelProjection,
  ModelTemplateCache,
  type ModelAssetKey,
  type ModelLoader,
  modelAssetUrlFor,
  modelFilenameFor,
  projectileModelFor,
} from "../../platform/render/modelPresentationHelpers";
import { rendererSnapshot } from "./renderer-test-helpers";

interface LoadCall {
  readonly url: string;
  readonly onLoad: (loaded: { readonly scene: THREE.Group }) => void;
  readonly onError: ((error: unknown) => void) | undefined;
}

const loaderDouble = (): {
  readonly loader: ModelLoader;
  readonly calls: LoadCall[];
} => {
  const calls: LoadCall[] = [];
  return {
    loader: {
      load: (url, onLoad, _onProgress, onError) =>
        calls.push({ url, onLoad, onError }),
    },
    calls,
  };
};

const modelScene = (): THREE.Group => {
  const scene = new THREE.Group();
  scene.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xff00ff }),
    ),
  );
  return scene;
};

describe("model presentation assets", () => {
  it("maps every supplied GLB and respects the Vite base path", () => {
    const expected: readonly [ModelAssetKey, string][] = [
      ["player-knight", "player_knight.glb"],
      ["player-wizard", "player_wizard.glb"],
      ["player-archer", "player_archer.glb"],
      ["enemy-scout", "enemy_scout.glb"],
      ["enemy-brute", "enemy_brute.glb"],
      ["enemy-spitter", "enemy_spitter.glb"],
      ["enemy-elite", "enemy_elite.glb"],
      ["enemy-boss", "enemy_ember_wyrm.glb"],
      ["projectile-knight", "projectile_knight_blade_arc.glb"],
      ["projectile-wizard", "projectile_wizard_flame_orb.glb"],
      ["projectile-archer", "projectile_archer_arrow.glb"],
      ["building-Campfire", "building_campfire.glb"],
      ["building-Workshop", "building_workshop.glb"],
      ["building-Farm", "building_farm.glb"],
      ["building-Storage", "building_storage.glb"],
      ["building-Healer", "building_healing_hut.glb"],
    ];
    expect(expected.map(([key]) => modelFilenameFor(key))).toEqual(
      expected.map(([, filename]) => filename),
    );
    expect(modelAssetUrlFor("enemy-boss", "/Wanderer/")).toBe(
      "/Wanderer/assets/models/enemy_ember_wyrm.glb",
    );
    expect(projectileModelFor("slash")).toBe("projectile-knight");
    expect(projectileModelFor("magic")).toBe("projectile-wizard");
    expect(projectileModelFor("arrow")).toBe("projectile-archer");
    expect(projectileModelFor("basic")).toBe("projectile-knight");
  });

  it("deduplicates an in-flight template and gives every presentation its own resources", async () => {
    const { loader, calls } = loaderDouble();
    const cache = new ModelTemplateCache(loader, "/Wanderer/");
    const first = cache.acquire("enemy-scout");
    const second = cache.acquire("enemy-scout");
    expect(calls).toHaveLength(1);
    calls[0].onLoad({ scene: modelScene() });
    const [one, two] = await Promise.all([first, second]);
    expect(one).toBeInstanceOf(THREE.Group);
    expect(two).toBeInstanceOf(THREE.Group);
    const oneMesh = one?.children[0] as THREE.Mesh;
    const twoMesh = two?.children[0] as THREE.Mesh;
    expect(oneMesh.geometry).not.toBe(twoMesh.geometry);
    expect(oneMesh.material).not.toBe(twoMesh.material);
    expect(cache.diagnostics()).toMatchObject({
      templates: 1,
      pending: 0,
      failures: 0,
    });
    cache.dispose();
  });

  it("retains geometric fallback on failure and resolves pending loads during disposal", async () => {
    const { loader, calls } = loaderDouble();
    const cache = new ModelTemplateCache(loader, "/");
    const failed = cache.acquire("building-Farm");
    calls[0].onError?.(new Error("missing"));
    await expect(failed).resolves.toBeUndefined();
    await expect(cache.acquire("building-Farm")).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    const pending = cache.acquire("enemy-elite");
    const lateScene = modelScene();
    const lateMesh = lateScene.children[0] as THREE.Mesh;
    const dispose = vi.spyOn(lateMesh.geometry, "dispose");
    cache.dispose();
    await expect(pending).resolves.toBeUndefined();
    calls[1].onLoad({ scene: lateScene });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("removes stale async instances instead of attaching them after renderer disposal", async () => {
    const { loader, calls } = loaderDouble();
    const projection = new ModelProjection(new ModelTemplateCache(loader, "/"));
    const fallback = vi.fn();
    projection.render(rendererSnapshot(), fallback);
    expect(calls.length).toBeGreaterThan(0);
    projection.dispose();
    calls.forEach((call) => call.onLoad({ scene: modelScene() }));
    await Promise.resolve();
    expect(projection.group.children).toHaveLength(0);
    expect(fallback).not.toHaveBeenCalledWith("player", true);
  });
});
