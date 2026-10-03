import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { PlacementPreview } from "../../domain/placement";
import { PlacementPreviewProjection } from "../../platform/render/placementPreviewHelpers";

const mixedWallPreview: PlacementPreview = {
  buildingKind: "ArcherTower",
  level: 2,
  tiles: [
    { position: { x: 2, y: 3 }, valid: true, rejection: null },
    {
      position: { x: 3, y: 3 },
      valid: false,
      rejection: { kind: "occupied-by-actor" },
    },
  ],
  valid: false,
  rejection: { kind: "occupied-by-actor" },
  cost: { wood: 8, stone: 4, scrap: 0, essence: 0, bossCore: 0 },
};

describe("retained placement ghost projection", () => {
  it("renders a translucent building silhouette and distinct cyan/red grid cells", () => {
    const projection = new PlacementPreviewProjection();
    expect(projection.group.visible).toBe(false);
    projection.render(mixedWallPreview);

    expect(projection.diagnostics()).toEqual({
      renderedTileCount: 2,
      renderedInvalidTileCount: 1,
      valid: false,
      buildingKind: "ArcherTower",
      level: 2,
      visible: true,
    });
    const tower = projection.group.getObjectByName(
      "placement-preview-building-0",
    ) as THREE.Mesh;
    const firstCell = projection.group.getObjectByName(
      "placement-preview-cell-0",
    ) as THREE.Mesh;
    const valid = projection.group.getObjectByName(
      "placement-preview-building-0",
    ) as THREE.Mesh;
    const invalid = projection.group.getObjectByName(
      "placement-preview-building-1",
    ) as THREE.Mesh;
    const outline = projection.group.getObjectByName(
      "placement-preview-cell-outline-1",
    ) as THREE.LineSegments;

    expect(tower.geometry).toBeInstanceOf(THREE.CylinderGeometry);
    expect(tower.position).toMatchObject({ x: 2, z: -3 });
    expect((tower.material as THREE.MeshBasicMaterial).transparent).toBe(true);
    expect((tower.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(
      0.4,
    );
    expect(firstCell.geometry).toBeInstanceOf(THREE.BoxGeometry);
    expect(firstCell.userData.placementValid).toBe(true);
    expect((valid.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      0x35e7ee,
    );
    expect(invalid.userData.placementValid).toBe(false);
    expect((invalid.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      0xff364b,
    );
    expect((outline.material as THREE.LineBasicMaterial).color.getHex()).toBe(
      0xff364b,
    );
    expect(tower.userData).toMatchObject({
      buildingKind: "ArcherTower",
      level: 2,
    });

    const sameObject = tower;
    projection.render(mixedWallPreview);
    expect(
      projection.group.getObjectByName("placement-preview-building-0"),
    ).toBe(sameObject);
    projection.dispose();
    projection.dispose();
    expect(projection.group.children).toHaveLength(0);
    projection.render(mixedWallPreview);
    expect(projection.diagnostics().visible).toBe(false);
  });

  it("draws rejected cells over the obstruction without writing scene depth", () => {
    const projection = new PlacementPreviewProjection();
    projection.render(mixedWallPreview);
    for (const name of [
      "placement-preview-cell-1",
      "placement-preview-building-1",
      "placement-preview-cell-outline-1",
    ]) {
      const rejected = projection.group.getObjectByName(name) as THREE.Mesh;
      const material = rejected.material as THREE.Material;
      expect(material.depthTest).toBe(false);
      expect(material.depthWrite).toBe(false);
      expect(material.transparent).toBe(true);
      expect(rejected.renderOrder).toBeGreaterThan(0);
    }
    const valid = projection.group.getObjectByName(
      "placement-preview-building-0",
    ) as THREE.Mesh;
    expect((valid.material as THREE.Material).depthTest).toBe(true);
    expect(valid.renderOrder).toBe(0);
    projection.render({
      ...mixedWallPreview,
      valid: true,
      rejection: null,
      tiles: mixedWallPreview.tiles.map((tile) => ({
        ...tile,
        valid: true,
        rejection: null,
      })),
    });
    for (const child of projection.group.children) {
      expect(child.renderOrder).toBe(0);
      expect(((child as THREE.Mesh).material as THREE.Material).depthTest).toBe(
        true,
      );
    }
    projection.dispose();
  });

  it("hides and releases visible preview cells when staging is cancelled", () => {
    const projection = new PlacementPreviewProjection();
    projection.render(mixedWallPreview);
    projection.render(null);
    expect(projection.group.visible).toBe(false);
    expect(projection.diagnostics()).toMatchObject({
      renderedTileCount: 0,
      renderedInvalidTileCount: 0,
      valid: false,
      buildingKind: null,
      visible: false,
    });
    expect(projection.group.children.every((child) => !child.visible)).toBe(
      true,
    );
    projection.dispose();
  });
});
