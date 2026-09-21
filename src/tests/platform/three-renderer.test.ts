import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { gameplayTuning, resourceDefinitions } from "../../data/definitions";
import type { GameRendererSnapshot } from "../../domain/notices";
import { buildingKinds, enemyKinds, resourceKinds } from "../../domain/types";
import type { AttackStyle } from "../../domain/types";
import { knightSlashAnimationFor } from "../../platform/render/combatAnimationHelpers";
import { RetainedProjection } from "../../platform/render/retainedProjectionHelpers";
import {
  createThreeRenderer,
  enemyPresentation,
} from "../../platform/render/threeRenderer";
import {
  meshFor,
  rendererDom,
  rendererSnapshot,
  visualVariantSnapshot,
} from "./renderer-test-helpers";

const gpu = vi.hoisted(() => ({
  setPixelRatio: vi.fn(),
  setClearColor: vi.fn(),
  setSize: vi.fn(),
  render: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: class {
    setPixelRatio = gpu.setPixelRatio;
    setClearColor = gpu.setClearColor;
    setSize = gpu.setSize;
    render = gpu.render;
    dispose = gpu.dispose;
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("retained Three CPU projection", () => {
  it("renders retained one-metre procedural wood and stone wall tiles without models", () => {
    const projection = new RetainedProjection();
    const snapshot = rendererSnapshot();
    projection.render({
      ...snapshot,
      visibleBuildings: [
        {
          id: "wall:wood",
          kind: "WoodWall",
          level: 1,
          position: { x: 2, y: -1 },
        },
        {
          id: "wall:stone",
          kind: "StoneWall",
          level: 1,
          position: { x: 3, y: -1 },
        },
      ],
    });
    const wood = meshFor(projection, "wall:wood");
    const stone = meshFor(projection, "wall:stone");
    for (const wall of [wood, stone]) {
      expect(wall.geometry).toBeInstanceOf(THREE.BoxGeometry);
      expect((wall.geometry as THREE.BoxGeometry).parameters).toMatchObject({
        width: 1,
        height: 1,
        depth: 1,
      });
      expect(wall.position.y).toBe(0.5);
    }
    expect((wood.material as THREE.MeshStandardMaterial).color.getHex()).toBe(
      0x8b5a2b,
    );
    expect((stone.material as THREE.MeshStandardMaterial).color.getHex()).toBe(
      0x78828a,
    );
    const before = projection.diagnostics();
    projection.render(
      structuredClone({
        ...snapshot,
        visibleBuildings: [
          {
            id: "wall:wood",
            kind: "WoodWall",
            level: 1,
            position: { x: 2, y: -1 },
          },
          {
            id: "wall:stone",
            kind: "StoneWall",
            level: 1,
            position: { x: 3, y: -1 },
          },
        ],
      }),
    );
    expect(projection.diagnostics()).toEqual(before);
    projection.dispose();
  });

  it("projects typed terrain with visual bases aligned to supplied footprints", () => {
    const projection = new RetainedProjection();
    const snapshot = rendererSnapshot();
    projection.render({
      ...snapshot,
      visibleChunks: [
        {
          ...snapshot.visibleChunks[0],
          obstacles: [
            {
              id: "tree",
              position: { x: 2, y: 3 },
              kind: "tree",
              radius: 0.4,
            },
            {
              id: "mountain",
              position: { x: 4, y: 5 },
              kind: "mountain",
              radius: 1.2,
            },
            {
              id: "river",
              position: { x: 6, y: 7 },
              kind: "water",
              waterKind: "river",
              radius: 0.8,
            },
            {
              id: "lake",
              position: { x: 8, y: 9 },
              kind: "water",
              waterKind: "lake",
              radius: 1.6,
            },
          ],
        },
      ],
    });
    const rootFor = (id: string) => projection.group.getObjectByName(id);
    const tree = rootFor("tree");
    const mountain = rootFor("mountain");
    const river = rootFor("river");
    const lake = rootFor("lake");
    expect(tree).toMatchObject({ position: { x: 2, z: -3 } });
    expect(tree?.children).toHaveLength(2);
    expect((tree?.children[0] as THREE.Mesh).geometry).toMatchObject({
      parameters: { radiusTop: 0.4 },
    });
    expect((mountain?.children[0] as THREE.Mesh).geometry).toMatchObject({
      parameters: { radius: 1.2, radialSegments: 6 },
    });
    for (const water of [river, lake]) {
      expect(water?.children).toHaveLength(2);
      expect((water?.children[0] as THREE.Mesh).rotation.x).toBe(-Math.PI / 2);
      expect(water?.children[1].position.y).toBeLessThan(
        water?.children[0].position.y ?? 0,
      );
      const bank = (water?.children[1] as THREE.Mesh)
        .geometry as THREE.RingGeometry;
      const surface = (water?.children[0] as THREE.Mesh)
        .geometry as THREE.CircleGeometry;
      expect(
        bank.parameters.outerRadius - surface.parameters.radius,
      ).toBeCloseTo(0.035);
    }
    expect(
      (
        (river?.children[0] as THREE.Mesh)
          .material as THREE.MeshStandardMaterial
      ).color.getHex(),
    ).not.toBe(
      (
        (lake?.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial
      ).color.getHex(),
    );
    projection.dispose();
  });

  it("retains and disposes grouped terrain meshes without leaking variants", () => {
    const projection = new RetainedProjection();
    const base = rendererSnapshot();
    const terrain: GameRendererSnapshot = {
      ...base,
      visibleChunks: [
        {
          ...base.visibleChunks[0],
          obstacles: [
            {
              id: "terrain-tree",
              kind: "tree",
              radius: 0.65,
              position: { x: 2, y: 3 },
            },
            {
              id: "terrain-water",
              kind: "water",
              waterKind: "river",
              radius: 1.1,
              position: { x: 6, y: 7 },
            },
            {
              id: "terrain-mountain",
              kind: "mountain",
              radius: 1.35,
              position: { x: 8, y: 9 },
            },
          ],
        },
      ],
    };
    projection.render(terrain);
    const first = projection.diagnostics();
    for (let frame = 0; frame < 20; frame += 1)
      projection.render(structuredClone(terrain));
    expect(projection.diagnostics()).toEqual(first);
    expect(first.meshesCreated - first.meshesRemoved).toBe(first.visibleMeshes);
    const roots = terrain.visibleChunks[0].obstacles.map(({ id }) =>
      projection.group.getObjectByName(id),
    );
    projection.render({ ...terrain, visibleChunks: [] });
    expect(projection.diagnostics().maps.obstacles).toBe(0);
    for (const root of roots) expect(root?.parent).toBeNull();
    projection.render(terrain);
    expect(projection.diagnostics().geometriesCreated).toBe(
      first.geometriesCreated,
    );
    expect(projection.diagnostics().materialsCreated).toBe(
      first.materialsCreated,
    );
    projection.dispose();
    const disposed = projection.diagnostics();
    expect(disposed.meshesRemoved).toBe(disposed.meshesCreated);
    expect(disposed.geometriesDisposed).toBe(disposed.geometriesCreated);
    expect(disposed.materialsDisposed).toBe(disposed.materialsCreated);
    expect(disposed.visibleMeshes).toBe(0);
    projection.dispose();
    expect(projection.diagnostics()).toEqual(disposed);
  });

  it("characterizes actual legacy marker heights and equivalent shapes/materials", () => {
    const snapshot = rendererSnapshot();
    const projection = new RetainedProjection();
    projection.render(snapshot);
    const player = meshFor(projection, "player");
    expect(player.position.y).toBe(0); // addMarker historically overwrote 0.525
    expect(
      (player.geometry as THREE.CylinderGeometry).parameters,
    ).toMatchObject({
      radiusTop: 0.45,
      height: 1.05,
      radialSegments: 10,
    });
    expect((player.material as THREE.MeshStandardMaterial).color.getHex()).toBe(
      0x58a6ff,
    );
    for (const chunk of snapshot.visibleChunks) {
      for (const marker of [...chunk.obstacles, ...chunk.campfires]) {
        const mesh = meshFor(projection, marker.id);
        expect(mesh.position.x === marker.position.x).toBe(true);
        expect(mesh.position.y).toBe(0);
        // Exact numeric equality: retained +0 and legacy -0 place Z identically.
        expect(mesh.position.z === -marker.position.y).toBe(true);
      }
    }
    for (const marker of [...snapshot.visibleBuildings, ...snapshot.enemies])
      expect(meshFor(projection, marker.id).position.y).toBe(0);
    expect(meshFor(projection, "projectile:1").position.toArray()).toEqual([
      2, 0.72, -1,
    ]);
    expect(meshFor(projection, "drop:1").position.toArray()).toEqual([
      3, 0.24, -4,
    ]);
    const obstacles = snapshot.visibleChunks.flatMap(
      (chunk) => chunk.obstacles,
    );
    expect(obstacles.length).toBeGreaterThan(1);
    expect(meshFor(projection, obstacles[0].id).geometry).toBe(
      meshFor(projection, obstacles[1].id).geometry,
    );
    expect(meshFor(projection, obstacles[0].id).material).toBe(
      meshFor(projection, obstacles[1].id).material,
    );
    projection.dispose();
  });

  it("keeps exact signed-zero equivalence and nonzero axes across retained movement", () => {
    const projection = new RetainedProjection();
    const snapshot = rendererSnapshot();
    for (const position of [
      { x: 0, y: 0 },
      { x: -0, y: -0 },
      { x: 7, y: -11 },
      { x: -13, y: 5 },
    ]) {
      projection.render({
        ...snapshot,
        player: { ...snapshot.player, position },
        visibleBuildings: [{ ...snapshot.visibleBuildings[0], position }],
      });
      for (const id of ["player", "building:fixture:1"]) {
        const mesh = meshFor(projection, id);
        expect(mesh.position.x === position.x).toBe(true);
        expect(mesh.position.y).toBe(0);
        expect(mesh.position.z === -position.y).toBe(true);
      }
    }
    projection.dispose();
  });

  it("renders and clears one retained visible destination marker", () => {
    const projection = new RetainedProjection();
    const snapshot = rendererSnapshot();
    projection.render({ ...snapshot, destination: { x: 4, y: -3 } });
    const marker = meshFor(projection, "destination-marker");
    expect((marker.geometry as THREE.RingGeometry).parameters).toMatchObject({
      innerRadius: 0.34,
      outerRadius: 0.52,
      thetaSegments: 40,
    });
    expect(marker.position.toArray()).toEqual([4, 0.03, 3]);
    expect(marker.rotation.x).toBe(-Math.PI / 2);
    expect(marker.material).toMatchObject({
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    projection.render({ ...snapshot, destination: null });
    expect(
      projection.group.getObjectByName("destination-marker"),
    ).toBeUndefined();
    projection.dispose();
  });

  it("creates no geometry/material/mesh for identical frames, including all released variants", () => {
    const projection = new RetainedProjection();
    const snapshot = visualVariantSnapshot();
    for (const playerHitRecovery of [
      { active: false, flashOn: false },
      { active: true, flashOn: true },
      { active: true, flashOn: false },
    ]) {
      const frame = { ...snapshot, playerHitRecovery };
      projection.render(frame);
      const before = projection.diagnostics();
      const children = [...projection.group.children];
      for (let index = 0; index < 100; index += 1)
        projection.render(structuredClone(frame));
      expect(projection.diagnostics()).toEqual(before);
      children.forEach((child, index) =>
        expect(projection.group.children[index]).toBe(child),
      );
    }
    projection.dispose();
  });

  it("updates positions/levels in place, releases only departed IDs and keeps maps visible-bounded", () => {
    const projection = new RetainedProjection();
    const snapshot = rendererSnapshot();
    projection.render(snapshot);
    const building = meshFor(projection, "building:fixture:1");
    const player = meshFor(projection, "player");
    const before = projection.diagnostics();
    const changed = {
      ...snapshot,
      player: { ...snapshot.player, hp: 50, position: { x: 16, y: -2 } },
      visibleBuildings: [
        {
          ...snapshot.visibleBuildings[0],
          level: 2 as const,
          position: { x: 2, y: 3 },
        },
      ],
      visibleChunks: snapshot.visibleChunks.slice(1),
      floorDrops: [{ ...snapshot.floorDrops[0], id: "drop:2" }],
      projectiles: [],
    };
    projection.render(changed);
    expect(meshFor(projection, "building:fixture:1")).toBe(building);
    expect(building.position.toArray()).toEqual([2, 0, -3]);
    expect(
      (building.geometry as THREE.CylinderGeometry).parameters.height,
    ).toBe(1);
    expect(meshFor(projection, "player")).toBe(player);
    expect(player.position.toArray()).toEqual([16, 0, 2]);
    expect(projection.group.getObjectByName("drop:1")).toBeUndefined();
    expect(projection.group.getObjectByName("projectile:1")).toBeUndefined();
    const after = projection.diagnostics();
    expect(after.meshesCreated - before.meshesCreated).toBe(1);
    expect(after.maps.obstacles).toBe(
      changed.visibleChunks.reduce(
        (sum, chunk) => sum + chunk.obstacles.length,
        0,
      ),
    );
    expect(after.maps.campfires).toBe(
      changed.visibleChunks.reduce(
        (sum, chunk) => sum + chunk.campfires.length,
        0,
      ),
    );
    expect(after.maps.drops).toBe(1);
    expect(after.maps.projectiles).toBe(0);
    projection.render({
      ...changed,
      visibleChunks: [],
      visibleBuildings: [],
      enemies: [],
      floorDrops: [],
    });
    expect(projection.diagnostics().visibleMeshes).toBe(1);
    projection.dispose();
  });

  it("preserves Healing Hut ring geometry/material, sharing, upgrades, relocation and removal", () => {
    const projection = new RetainedProjection();
    const snapshot = visualVariantSnapshot();
    projection.render(snapshot);
    for (const level of [1, 2, 3]) {
      const aura = meshFor(projection, `aura:hut:${level}`);
      const radius = gameplayTuning.healingHutRadiusByLevel[level - 1];
      expect((aura.geometry as THREE.RingGeometry).parameters).toMatchObject({
        innerRadius: Math.max(0, radius - 0.08),
        outerRadius: radius,
        thetaSegments: 48,
      });
      expect(aura.rotation.x).toBe(-Math.PI / 2);
      expect(aura.position.toArray()).toEqual([level * 2, 0.025, level * 3]);
      expect(aura.material).toBeInstanceOf(THREE.MeshBasicMaterial);
      const material = aura.material as THREE.MeshBasicMaterial;
      expect(material.color.getHex()).toBe(0x9c6ade);
      expect(material).toMatchObject({
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
    }
    const aura = meshFor(projection, "aura:hut:1");
    const twin = meshFor(projection, "aura:hut:twin");
    const originalGeometry = twin.geometry;
    expect(aura.geometry).toBe(twin.geometry);
    expect(aura.material).toBe(twin.material);
    expect(aura.material).not.toBe(meshFor(projection, "hut:1").material);
    const before = projection.diagnostics();
    projection.render({
      ...snapshot,
      visibleBuildings: snapshot.visibleBuildings.map((building) =>
        building.id === "hut:1"
          ? { ...building, level: 3, position: { x: -8, y: 6 } }
          : building,
      ),
    });
    expect(meshFor(projection, "aura:hut:1")).toBe(aura);
    expect(aura.position.toArray()).toEqual([-8, 0.025, -6]);
    expect(aura.geometry).toBe(meshFor(projection, "aura:hut:3").geometry);
    expect(twin.geometry).toBe(originalGeometry);
    expect(projection.diagnostics()).toEqual(before);
    projection.render({
      ...snapshot,
      visibleBuildings: [{ ...snapshot.visibleBuildings[1], kind: "Storage" }],
    });
    expect(projection.diagnostics().maps.auras).toBe(0);
    expect(aura.parent).toBeNull();
    expect(twin.parent).toBeNull();
    projection.render({ ...snapshot, visibleBuildings: [] });
    expect(projection.diagnostics().maps.buildings).toBe(0);
    projection.dispose();
  });

  it("preserves all projectile styles/default fallback and switches resources without affecting twins", () => {
    const projection = new RetainedProjection();
    const snapshot = visualVariantSnapshot();
    projection.render(snapshot);
    const expected = [
      ["basic", 0.17, 0xffe082, 0x8a5a00],
      ["slash", 0.25, 0xd8dde8, 0x6d7585],
      ["magic", 0.23, 0xb388ff, 0x5e35b1],
      ["arrow", 0.14, 0x8d6e63, 0x4e342e],
    ] as const;
    for (const [style, radius, color, emissive] of expected) {
      const mesh = meshFor(projection, `shot:${style}`);
      expect((mesh.geometry as THREE.SphereGeometry).parameters).toMatchObject({
        radius,
        widthSegments: 10,
        heightSegments: 10,
      });
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect(material.color.getHex()).toBe(color);
      expect(material.emissive.getHex()).toBe(emissive);
      expect(material.roughness).toBe(0.35);
      expect(material.emissiveIntensity).toBe(1);
      expect(mesh.position.x).toBe(2);
      expect(mesh.position.z).toBe(-1);
      if (style === "magic") expect(mesh.position.y).toBeGreaterThan(0.72);
      else expect(mesh.position.y).toBe(0.72);
      expect(mesh.geometry).toBe(meshFor(projection, `twin:${style}`).geometry);
      expect(mesh.material).toBe(meshFor(projection, `twin:${style}`).material);
    }
    const mesh = meshFor(projection, "shot:basic");
    const twin = meshFor(projection, "twin:basic");
    projection.render({
      ...snapshot,
      projectiles: snapshot.projectiles.map((shot) =>
        shot.id === "shot:basic" ? { ...shot, style: "magic" } : shot,
      ),
    });
    const before = projection.diagnostics();
    for (const style of [
      "slash",
      "magic",
      "arrow",
      "basic",
      "unknown",
    ] as const) {
      projection.render({
        ...snapshot,
        projectiles: snapshot.projectiles.map((shot) =>
          shot.id === "shot:basic"
            ? {
                ...shot,
                style: style as AttackStyle,
                origin: { x: -4, y: 6 },
                targetPosition: { x: 8, y: -2 },
                progress: 0.25,
              }
            : shot,
        ),
      });
      expect(meshFor(projection, "shot:basic")).toBe(mesh);
      expect(mesh.position.x).toBe(-1);
      expect(mesh.position.z).toBe(-4);
      if (style === "magic") expect(mesh.position.y).toBeGreaterThan(0.72);
      else expect(mesh.position.y).toBe(0.72);
      expect(mesh.material).toBe(
        meshFor(projection, `twin:${style === "unknown" ? "basic" : style}`)
          .material,
      );
      expect((twin.material as THREE.MeshStandardMaterial).color.getHex()).toBe(
        0xffe082,
      );
      expect(projection.diagnostics()).toEqual(before);
    }
    projection.dispose();
  });

  it("renders a Mage fireball trail and a bounded explosion at its impact target", () => {
    const projection = new RetainedProjection();
    const snapshot = rendererSnapshot();
    const fireball = {
      ...snapshot.projectiles[0],
      id: "fireball:1",
      origin: { x: -1, y: 2 },
      targetPosition: { x: 4, y: -3 },
      progress: 0.7,
      style: "magic" as const,
    };
    projection.render({
      ...snapshot,
      presentationElapsed: 1,
      projectiles: [fireball],
    });
    const trail = meshFor(projection, "fireball-trail:fireball:1");
    expect(trail.visible).toBe(true);
    expect(trail.scale.z).toBeGreaterThan(1);
    expect(projection.diagnostics().maps).toMatchObject({
      fireballTrails: 1,
      mageExplosions: 0,
    });

    projection.render({
      ...snapshot,
      presentationElapsed: 1.1,
      projectiles: [],
    });
    const root = projection.group.getObjectByName("mage-explosion:fireball:1");
    expect(root?.position.toArray()).toEqual([4, 0.14, 3]);
    expect(root?.children).toHaveLength(8);
    expect(projection.diagnostics().maps.mageExplosions).toBe(1);

    projection.render({
      ...snapshot,
      presentationElapsed: 1.25,
      projectiles: [],
    });
    const ring = projection.group.getObjectByName(
      "mage-explosion:fireball:1:ring",
    );
    expect(ring?.scale.x).toBeGreaterThan(1);

    projection.render({
      ...snapshot,
      presentationElapsed: 1.6,
      projectiles: [],
    });
    expect(
      projection.group.getObjectByName("mage-explosion:fireball:1"),
    ).toBeUndefined();
    expect(projection.diagnostics().maps.mageExplosions).toBe(0);
    projection.dispose();
  });

  it("retains Knight crescents with shape, orientation, height and material through motion and removal", () => {
    const projection = new RetainedProjection();
    const snapshot = visualVariantSnapshot();
    projection.render(snapshot);
    const twin = meshFor(projection, "crescent:twin");
    for (const attack of snapshot.crescentAttacks) {
      const mesh = meshFor(projection, attack.id);
      const halfArc = Math.acos(attack.arcCosine);
      const length = Math.hypot(attack.direction.x, attack.direction.y);
      const direction = {
        x: attack.direction.x / length,
        y: attack.direction.y / length,
      };
      const slash = knightSlashAnimationFor(attack.progress);
      expect((mesh.geometry as THREE.RingGeometry).parameters).toEqual({
        innerRadius: Math.max(0.45, attack.radius - 0.32),
        outerRadius: attack.radius,
        thetaSegments: 32,
        phiSegments: 1,
        thetaStart: -halfArc,
        thetaLength: halfArc * 2,
      });
      expect(mesh.position.x).toBeCloseTo(
        attack.origin.x + direction.x * attack.radius * slash.forward,
      );
      expect(mesh.position.y).toBeCloseTo(slash.height);
      expect(mesh.position.z).toBeCloseTo(
        -(attack.origin.y + direction.y * attack.radius * slash.forward),
      );
      expect(mesh.rotation.x).toBe(-Math.PI / 2);
      expect(mesh.rotation.z).toBeCloseTo(
        Math.atan2(direction.y, direction.x) + slash.turn,
      );
      expect(mesh.scale.x).toBeCloseTo(slash.scale);
      expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
      expect((mesh.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
        0xd8dde8,
      );
      expect(mesh.material).toMatchObject({
        transparent: true,
        opacity: 0.86,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      expect(mesh.material).toBe(twin.material);
    }
    const mesh = meshFor(projection, "crescent:2.4:0.5");
    const originalGeometry = mesh.geometry;
    const before = projection.diagnostics();
    for (const direction of [
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: -1, y: 0 },
      { x: -3, y: 4 },
    ]) {
      projection.render({
        ...snapshot,
        crescentAttacks: snapshot.crescentAttacks.map((attack) =>
          attack.id === mesh.name
            ? {
                ...attack,
                origin: { x: 7, y: -9 },
                direction,
                progress: 0.9,
                radius: 3,
                arcCosine: 0.25,
              }
            : attack,
        ),
      });
      expect(meshFor(projection, mesh.name)).toBe(mesh);
      const length = Math.hypot(direction.x, direction.y);
      const normalized = { x: direction.x / length, y: direction.y / length };
      const slash = knightSlashAnimationFor(0.9);
      expect(mesh.position.x).toBeCloseTo(7 + normalized.x * 3 * slash.forward);
      expect(mesh.position.y).toBeCloseTo(slash.height);
      expect(mesh.position.z).toBeCloseTo(
        -(-9 + normalized.y * 3 * slash.forward),
      );
      expect(mesh.rotation.z).toBeCloseTo(
        Math.atan2(normalized.y, normalized.x) + slash.turn,
      );
      expect(mesh.scale.x).toBeCloseTo(slash.scale);
      expect(mesh.geometry).toBe(
        meshFor(projection, "crescent:3:0.25").geometry,
      );
      expect(twin.geometry).toBe(originalGeometry);
      expect(twin.rotation.z).toBe(0);
      expect(projection.diagnostics()).toEqual(before);
    }
    projection.render({ ...snapshot, crescentAttacks: [] });
    expect(mesh.parent).toBeNull();
    expect(twin.parent).toBeNull();
    expect(projection.diagnostics().maps.crescents).toBe(0);
    expect(projection.diagnostics().meshesRemoved - before.meshesRemoved).toBe(
      snapshot.crescentAttacks.length,
    );
    projection.dispose();
  });

  it("resets player recovery materials and reuses warmed variants without color bleed", () => {
    const projection = new RetainedProjection();
    const snapshot = visualVariantSnapshot();
    projection.render(snapshot);
    const player = meshFor(projection, "player");
    const normal = player.material;
    const unrelated = projection.group.children
      .filter((object) => object !== player)
      .map((object) => {
        const mesh = object as THREE.Mesh;
        return {
          mesh,
          material: mesh.material,
          json: (mesh.material as THREE.Material).toJSON(),
        };
      });
    const states = [
      {
        active: true,
        flashOn: true,
        color: 0xfff3b0,
        emissive: 0xff7043,
        intensity: 1.1,
      },
      {
        active: true,
        flashOn: false,
        color: 0x58a6ff,
        emissive: 0x1b4f72,
        intensity: 0.2,
      },
      {
        active: false,
        flashOn: false,
        color: 0x58a6ff,
        emissive: 0,
        intensity: 1,
      },
      {
        active: false,
        flashOn: true,
        color: 0xfff3b0,
        emissive: 0,
        intensity: 1,
      },
    ];
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const before = projection.diagnostics();
      for (const state of states) {
        projection.render({ ...snapshot, playerHitRecovery: state });
        expect(meshFor(projection, "player")).toBe(player);
        const material = player.material as THREE.MeshStandardMaterial;
        expect(material.color.getHex()).toBe(state.color);
        expect(material.emissive.getHex()).toBe(state.emissive);
        expect(material.emissiveIntensity).toBe(state.intensity);
        expect(material.roughness).toBe(0.8);
        if (!state.active && !state.flashOn)
          expect(player.material).toBe(normal);
        for (const entry of unrelated) {
          expect(entry.mesh.material).toBe(entry.material);
          expect((entry.mesh.material as THREE.Material).toJSON()).toEqual(
            entry.json,
          );
        }
      }
      if (cycle > 0) expect(projection.diagnostics()).toEqual(before);
    }
    projection.dispose();
  });

  it("selects every building/enemy/drop variant in place without growing visible maps", () => {
    const projection = new RetainedProjection();
    const snapshot = rendererSnapshot();
    const colors = [
      0xff9f43, 0x8d6e63, 0x4caf50, 0x607d8b, 0x9c6ade, 0x8b5a2b, 0x78828a,
    ];
    const enemyColors = [0xc75c5c, 0x8e2424, 0x6a9f58, 0xfbc02d, 0xd84315];
    projection.render(snapshot);
    const buildingMesh = meshFor(projection, "building:fixture:1");
    const dropMesh = meshFor(projection, "drop:1");
    const enemy = { ...snapshot.enemies[0], id: "enemy:variant" };
    expect(snapshot.enemies.length).toBeGreaterThan(0);
    for (const [index, kind] of buildingKinds.entries()) {
      for (const level of [1, 2, 3] as const) {
        projection.render({
          ...snapshot,
          visibleBuildings: [{ ...snapshot.visibleBuildings[0], kind, level }],
        });
        expect(meshFor(projection, "building:fixture:1")).toBe(buildingMesh);
        if (kind === "WoodWall" || kind === "StoneWall")
          expect(
            (buildingMesh.geometry as THREE.BoxGeometry).parameters,
          ).toMatchObject({
            width: 1,
            height: 1,
            depth: 1,
          });
        else
          expect(
            (buildingMesh.geometry as THREE.CylinderGeometry).parameters,
          ).toMatchObject({
            radiusTop: 0.48 + level * 0.07,
            height: 0.7 + level * 0.15,
          });
        expect(
          (buildingMesh.material as THREE.MeshStandardMaterial).color.getHex(),
        ).toBe(colors[index]);
        expect(buildingMesh.position.y).toBe(
          kind === "WoodWall" || kind === "StoneWall" ? 0.5 : 0,
        );
      }
    }
    let enemyMesh: THREE.Mesh | undefined;
    for (const [index, kind] of enemyKinds.entries()) {
      projection.render({
        ...snapshot,
        enemies: [{ ...enemy, kind, hp: 1, position: { x: -5, y: 8 } }],
      });
      const mesh = meshFor(projection, enemy.id);
      if (enemyMesh !== undefined) expect(mesh).toBe(enemyMesh);
      enemyMesh = mesh;
      expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(
        enemyColors[index],
      );
      expect(
        (mesh.geometry as THREE.CylinderGeometry).parameters,
      ).toMatchObject({
        radiusTop: kind === "boss" ? 0.85 : kind === "elite" ? 0.6 : 0.43,
        height: kind === "boss" ? 1.45 : 0.85,
      });
      expect(mesh.position.toArray()).toEqual([-5, 0, -8]);
      expect(projection.diagnostics().maps.enemies).toBe(1);
    }
    for (const resource of resourceKinds) {
      projection.render({
        ...snapshot,
        floorDrops: [{ ...snapshot.floorDrops[0], resource }],
      });
      expect(meshFor(projection, "drop:1")).toBe(dropMesh);
      const material = dropMesh.material as THREE.MeshStandardMaterial;
      expect(material.color.getHex()).toBe(
        resourceDefinitions[resource].groundDropColor,
      );
      expect(material.emissive.getHex()).toBe(
        resourceDefinitions[resource].groundDropColor,
      );
      expect(material).toMatchObject({
        roughness: 0.35,
        emissiveIntensity: 0.22,
      });
      expect(
        (dropMesh.geometry as THREE.DodecahedronGeometry).parameters,
      ).toMatchObject({ radius: 0.22, detail: 0 });
    }
    projection.dispose();
  });

  it("bounds every map by visible IDs through repeated neighbourhood turnover", () => {
    const projection = new RetainedProjection();
    const snapshot = visualVariantSnapshot();
    projection.render(snapshot);
    const warm = projection.diagnostics();
    for (let step = 0; step < 40; step += 1) {
      const suffix = `:visit:${step}`;
      const frame: GameRendererSnapshot = {
        ...snapshot,
        visibleChunks: snapshot.visibleChunks.map((chunk) => ({
          ...chunk,
          obstacles: chunk.obstacles.map((marker) => ({
            ...marker,
            id: marker.id + suffix,
          })),
          campfires: chunk.campfires.map((marker) => ({
            ...marker,
            id: marker.id + suffix,
          })),
        })),
        visibleBuildings: snapshot.visibleBuildings.map((marker) => ({
          ...marker,
          id: marker.id + suffix,
        })),
        enemies: snapshot.enemies.map((marker) => ({
          ...marker,
          id: marker.id + suffix,
        })),
        projectiles: snapshot.projectiles.map((marker) => ({
          ...marker,
          id: marker.id + suffix,
        })),
        crescentAttacks: snapshot.crescentAttacks.map((attack) => ({
          ...attack,
          id: attack.id + suffix,
        })),
        floorDrops: snapshot.floorDrops.map((marker) => ({
          ...marker,
          id: marker.id + suffix,
        })),
      };
      const player = meshFor(projection, "player");
      const departed = projection.group.children.filter(
        (mesh) => mesh !== player,
      );
      projection.render(frame);
      const counts = projection.diagnostics();
      expect(counts.maps).toEqual(warm.maps);
      expect(counts.visibleMeshes).toBe(warm.visibleMeshes);
      expect(counts.geometriesCreated).toBe(warm.geometriesCreated);
      expect(counts.materialsCreated).toBe(warm.materialsCreated);
      expect(counts.meshesCreated - counts.meshesRemoved).toBe(
        counts.visibleMeshes,
      );
      expect(meshFor(projection, "player")).toBe(player);
      for (const mesh of departed) expect(mesh.parent).toBeNull();
      projection.render(structuredClone(frame));
      expect(projection.diagnostics()).toEqual(counts);
    }
    projection.dispose();
    expect(projection.diagnostics().meshesRemoved).toBe(
      projection.diagnostics().meshesCreated,
    );
  });

  it("disposes every shared and retired variant once, removes all meshes and isolates instances", () => {
    const first = new RetainedProjection(),
      second = new RetainedProjection();
    const base = visualVariantSnapshot();
    const snapshot: GameRendererSnapshot = {
      ...base,
      visibleBuildings: [
        ...base.visibleBuildings,
        ...buildingKinds.flatMap((kind) =>
          ([1, 2, 3] as const).map((level) => ({
            id: `building:${kind}:${level}`,
            kind,
            level,
            position: { x: level, y: -level },
          })),
        ),
      ],
      enemies: enemyKinds.map((kind) => ({
        ...base.enemies[0],
        id: `enemy:${kind}`,
        kind,
      })),
      floorDrops: resourceKinds.map((resource) => ({
        ...base.floorDrops[0],
        id: `drop:${resource}`,
        resource,
      })),
    };
    first.render(snapshot);
    second.render(snapshot);
    expect(meshFor(first, "player").geometry).not.toBe(
      meshFor(second, "player").geometry,
    );
    expect(meshFor(first, "aura:hut:1").material).not.toBe(
      meshFor(second, "aura:hut:1").material,
    );
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    for (const playerHitRecovery of [
      { active: false, flashOn: false },
      { active: true, flashOn: true },
      { active: true, flashOn: false },
      { active: false, flashOn: true },
    ]) {
      first.render({ ...snapshot, playerHitRecovery });
      first.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          materials.add(material);
      });
    }
    expect(geometries.size).toBe(first.diagnostics().geometriesCreated);
    expect(materials.size).toBe(first.diagnostics().materialsCreated);
    const disposals = [...geometries, ...materials].map((resource) =>
      vi.spyOn(resource, "dispose"),
    );
    first.render({
      ...snapshot,
      visibleChunks: [],
      visibleBuildings: [],
      projectiles: [],
      crescentAttacks: [],
      enemies: [],
      floorDrops: [],
    });
    for (const dispose of disposals) expect(dispose).not.toHaveBeenCalled();
    first.dispose();
    const counts = first.diagnostics();
    first.dispose();
    first.render(snapshot);
    expect(first.diagnostics()).toEqual(counts);
    expect(counts.geometriesDisposed).toBe(counts.geometriesCreated);
    expect(counts.materialsDisposed).toBe(counts.materialsCreated);
    expect(counts.meshesRemoved).toBe(counts.meshesCreated);
    expect(counts.visibleMeshes).toBe(0);
    expect(counts.maps).toEqual({
      obstacles: 0,
      campfires: 0,
      buildings: 0,
      auras: 0,
      enemies: 0,
      projectiles: 0,
      crescents: 0,
      fireballTrails: 0,
      mageExplosions: 0,
      drops: 0,
      relicDrops: 0,
    });
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
    const secondBefore = second.diagnostics();
    second.render(snapshot);
    expect(second.diagnostics()).toEqual(secondBefore);
    expect(second.diagnostics().visibleMeshes).toBeGreaterThan(1);
    second.dispose();
  });
});

describe("Three browser adapter ownership", () => {
  it("retains accessible enemy health bars from snapshots and prunes departed enemies", () => {
    const dom = rendererDom();
    const renderer = createThreeRenderer(dom.host);
    const snapshot = rendererSnapshot();
    const enemy = snapshot.enemies[0];
    if (enemy === undefined) throw new Error("Missing fixture enemy");

    renderer.render(snapshot);
    const bar = dom.enemyHealthBars.find(
      (candidate) => candidate.dataset.enemyId === enemy.id,
    );
    if (bar === undefined) throw new Error("Missing enemy health bar");
    const fill = bar.children[0];
    if (fill === undefined) throw new Error("Missing enemy health fill");
    expect(bar.dataset.testid).toBe("world-enemy-hp");
    expect(bar.attributes).toMatchObject({
      role: "meter",
      "aria-label": `${enemy.kind} health`,
      "aria-valuemin": "0",
      "aria-valuemax": String(enemy.maxHp),
      "aria-valuenow": String(enemy.hp),
      "aria-valuetext": `${Math.ceil(enemy.hp)} / ${Math.ceil(enemy.maxHp)} HP`,
    });
    expect(fill.attributes["aria-hidden"]).toBe("true");
    expect(fill.style.width).toBe("100%");
    const [, camera] = gpu.render.mock.calls.at(-1) as [
      THREE.Scene,
      THREE.PerspectiveCamera,
    ];
    const scale = enemy.isWaveBoss ? gameplayTuning.waveBossVisualScale : 1;
    const projected = new THREE.Vector3(
      enemy.position.x,
      enemyPresentation[enemy.kind].height * scale + 0.35,
      -enemy.position.y,
    ).project(camera);
    expect(bar.style.left).toBe(`${((projected.x + 1) / 2) * 100}%`);
    expect(bar.style.top).toBe(`${((1 - projected.y) / 2) * 100}%`);

    const barCount = dom.enemyHealthBars.length;
    renderer.render(structuredClone(snapshot));
    expect(dom.enemyHealthBars).toHaveLength(barCount);
    expect(
      dom.enemyHealthBars.find(
        (candidate) => candidate.dataset.enemyId === enemy.id,
      ),
    ).toBe(bar);

    renderer.render({
      ...snapshot,
      enemies: snapshot.enemies.map((current) =>
        current.id === enemy.id
          ? { ...current, hp: current.maxHp / 2 }
          : current,
      ),
    });
    expect(bar.attributes["aria-valuenow"]).toBe(String(enemy.maxHp / 2));
    expect(bar.attributes["aria-valuetext"]).toBe(
      `${Math.ceil(enemy.maxHp / 2)} / ${Math.ceil(enemy.maxHp)} HP`,
    );
    expect(fill.style.width).toBe("50%");

    renderer.render({
      ...snapshot,
      enemies: snapshot.enemies.map((current) =>
        current.id === enemy.id ? { ...current, defeated: true } : current,
      ),
    });
    expect(bar.remove).toHaveBeenCalledTimes(1);
    renderer.render({ ...snapshot, enemies: [] });
    renderer.dispose();
    expect(bar.remove).toHaveBeenCalledTimes(1);
    for (const other of dom.enemyHealthBars)
      if (other !== bar) expect(other.remove).toHaveBeenCalledTimes(1);
  });

  it("hides off-camera enemy labels instead of projecting them beyond the host", () => {
    const dom = rendererDom();
    const renderer = createThreeRenderer(dom.host);
    const snapshot = rendererSnapshot();
    const enemy = snapshot.enemies[0];
    if (enemy === undefined) throw new Error("Missing fixture enemy");

    renderer.render({
      ...snapshot,
      enemies: [{ ...enemy, position: { x: 1000, y: -1000 } }],
    });
    const bar = dom.enemyHealthBars.find(
      (candidate) => candidate.dataset.enemyId === enemy.id,
    );
    if (bar === undefined) throw new Error("Missing enemy health bar");
    expect((bar as unknown as HTMLElement).hidden).toBe(true);
    const fill = bar.children[0];
    if (fill === undefined) throw new Error("Missing enemy health fill");
    renderer.render({
      ...snapshot,
      enemies: [{ ...enemy, hp: enemy.maxHp / 2 }],
    });
    expect((bar as unknown as HTMLElement).hidden).toBe(false);
    expect(fill.style.width).toBe("50%");
    renderer.dispose();
  });

  it("updates health/camera/raycast and releases observer, label, canvas, floor and WebGL exactly once", () => {
    const dom = rendererDom();
    const renderer = createThreeRenderer(dom.host);
    const snapshot = rendererSnapshot();
    renderer.render(snapshot);
    expect(dom.label.textContent).toBe("100 / 100 HP");
    expect(dom.label.dataset.testid).toBe("world-player-hp");
    expect(dom.label.setAttribute).toHaveBeenCalledWith(
      "aria-label",
      "Player health",
    );
    renderer.render({
      ...snapshot,
      player: { position: { x: 3, y: 4 }, hp: 50.1, maxHp: 120 },
    });
    expect(dom.label.textContent).toBe("51 / 120 HP");
    expect(dom.canvas.dataset.floorDropCount).toBe("1");
    expect(dom.canvas.dataset.testid).toBe("world-canvas");
    const [scene, camera] = gpu.render.mock.calls.at(-1) as [
      THREE.Scene,
      THREE.PerspectiveCamera,
    ];
    expect(camera.position.toArray()).toEqual([14, 17, 10]);
    expect(camera.fov).toBe(58);
    const projected = new THREE.Vector3(3, 1.75, -4).project(camera);
    expect(dom.label.style.left).toBe(`${((projected.x + 1) / 2) * 100}%`);
    expect(dom.label.style.top).toBe(`${((1 - projected.y) / 2) * 100}%`);
    const position = renderer.worldPositionFromClientPoint(400, 300);
    expect(position?.x).toBeCloseTo(3);
    expect(position?.y).toBeCloseTo(4);
    dom.bounds.width = 0;
    expect(renderer.worldPositionFromClientPoint(400, 300)).toBeNull();
    dom.bounds.width = 800;
    dom.observer.resize();
    const resizeCalls = gpu.setSize.mock.calls.length;
    const floor = scene.children.find(
      (object) => object instanceof THREE.Mesh,
    ) as THREE.Mesh;
    expect(floor.position.toArray()).toEqual([3, 0, -4]);
    const disposeGeometry = vi.spyOn(floor.geometry, "dispose");
    const disposeMaterial = vi.spyOn(
      floor.material as THREE.Material,
      "dispose",
    );
    renderer.dispose();
    renderer.dispose();
    renderer.render(snapshot);
    dom.observer.resize();
    expect(gpu.setSize).toHaveBeenCalledTimes(resizeCalls);
    expect(gpu.render).toHaveBeenCalledTimes(2);
    for (const dispose of [
      dom.observer.disconnect,
      dom.canvas.remove,
      dom.label.remove,
      gpu.dispose,
      disposeGeometry,
      disposeMaterial,
    ])
      expect(dispose).toHaveBeenCalledTimes(1);
    expect(renderer.worldPositionFromClientPoint(400, 300)).toBeNull();
    expect(renderer.diagnostics().visibleMeshes).toBe(0);
    expect(scene.children).toHaveLength(0);
  });

  it("preserves and resets all current canvas diagnostics, with warm adapter allocations stable", () => {
    const dom = rendererDom();
    const renderer = createThreeRenderer(dom.host);
    const snapshot: GameRendererSnapshot = {
      ...visualVariantSnapshot(),
      playerHitRecovery: { active: true, flashOn: true },
    };
    let text = dom.label.textContent;
    const writeHealth = vi.fn((value: string) => {
      text = value;
    });
    Object.defineProperty(dom.label, "textContent", {
      get: () => text,
      set: writeHealth,
      configurable: true,
    });
    const writeStyle = vi.fn();
    dom.label.style = new Proxy(dom.label.style, {
      set(target, key, value) {
        writeStyle(key, value);
        return Reflect.set(target, key, value);
      },
    });
    const writeDataset = vi.fn();
    dom.canvas.dataset = new Proxy(dom.canvas.dataset, {
      set(target, key, value) {
        writeDataset(key, value);
        return Reflect.set(target, key, value);
      },
    });
    renderer.render(snapshot);
    expect(dom.canvas.dataset).toMatchObject({
      floorDropCount: "1",
      weaponRelicDropCount: "0",
      homingProjectileCount: "0",
      projectileCount: "8",
      crescentAttackCount: "5",
      playerHitRecovery: "active",
      playerHitFlash: "on",
      healingHutAuraCount: "4",
      healingHutAuraRadii: "3,4,5,3",
    });
    const before = renderer.diagnostics();
    const styleWrites = writeStyle.mock.calls.length;
    const datasetWrites = writeDataset.mock.calls.length;
    expect(writeHealth).toHaveBeenCalledTimes(1);
    for (let frame = 0; frame < 10; frame += 1)
      renderer.render(structuredClone(snapshot));
    expect(renderer.diagnostics()).toEqual(before);
    expect(writeHealth).toHaveBeenCalledTimes(1);
    expect(writeStyle).toHaveBeenCalledTimes(styleWrites);
    expect(writeDataset).toHaveBeenCalledTimes(datasetWrites);
    renderer.render({
      ...snapshot,
      playerHitRecovery: { active: true, flashOn: false },
      visibleBuildings: [{ ...snapshot.visibleBuildings[1], level: 3 }],
    });
    expect(dom.canvas.dataset).toMatchObject({
      playerHitRecovery: "active",
      playerHitFlash: "off",
      healingHutAuraCount: "1",
      healingHutAuraRadii: "5",
    });
    renderer.render({
      ...snapshot,
      playerHitRecovery: { active: false, flashOn: false },
      visibleBuildings: [],
      floorDrops: [],
      projectiles: [],
      crescentAttacks: [],
    });
    expect(dom.canvas.dataset).toMatchObject({
      floorDropCount: "0",
      weaponRelicDropCount: "0",
      homingProjectileCount: "0",
      projectileCount: "0",
      crescentAttackCount: "0",
      playerHitRecovery: "inactive",
      playerHitFlash: "off",
      healingHutAuraCount: "0",
      healingHutAuraRadii: "",
    });
    expect(renderer.diagnostics().maps.auras).toBe(0);
    expect(renderer.diagnostics().maps.projectiles).toBe(0);
    expect(renderer.diagnostics().maps.crescents).toBe(0);
    renderer.dispose();
  });
});
