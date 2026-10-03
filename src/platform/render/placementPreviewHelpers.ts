import * as THREE from "three";
import type { PlacementPreview } from "../../domain/placement";
import type { BuildingKind } from "../../domain/types";

const tileSize = 1;
const validColor = 0x35e7ee;
const invalidColor = 0xff364b;

interface BuildingShape {
  readonly geometry: THREE.BufferGeometry;
  readonly height: number;
}

interface GhostCell {
  readonly fill: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  readonly outline: THREE.LineSegments<
    THREE.EdgesGeometry,
    THREE.LineBasicMaterial
  >;
  readonly building: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

const createBuildingShape = (kind: BuildingKind): BuildingShape => {
  switch (kind) {
    case "Campfire":
      return {
        geometry: new THREE.CylinderGeometry(0.3, 0.46, 0.56, 8),
        height: 0.56,
      };
    case "Workshop":
      return {
        geometry: new THREE.BoxGeometry(0.76, 0.78, 0.72),
        height: 0.78,
      };
    case "Farm":
      return {
        geometry: new THREE.BoxGeometry(0.84, 0.28, 0.84),
        height: 0.28,
      };
    case "Storage":
      return {
        geometry: new THREE.BoxGeometry(0.72, 0.58, 0.72),
        height: 0.58,
      };
    case "Healer":
      return {
        geometry: new THREE.CylinderGeometry(0.38, 0.48, 0.88, 8),
        height: 0.88,
      };
    case "WoodWall":
    case "StoneWall":
      return {
        geometry: new THREE.BoxGeometry(0.94, 0.88, 0.94),
        height: 0.88,
      };
    case "ArcherTower":
      return {
        geometry: new THREE.CylinderGeometry(0.28, 0.43, 1.35, 8),
        height: 1.35,
      };
    case "SwordTower":
      return {
        geometry: new THREE.BoxGeometry(0.48, 1.18, 0.48),
        height: 1.18,
      };
    case "MageTower":
      return { geometry: new THREE.ConeGeometry(0.48, 1.28, 6), height: 1.28 };
  }
};

/** A disposable, retained ghost layer. It never enters the world/session model. */
export class PlacementPreviewProjection {
  readonly group = new THREE.Group();

  private readonly cellGeometry = new THREE.BoxGeometry(
    tileSize * 0.96,
    0.045,
    tileSize * 0.96,
  );
  private readonly edgeGeometry = new THREE.EdgesGeometry(this.cellGeometry);
  private readonly fillMaterials = new Map<boolean, THREE.MeshBasicMaterial>();
  private readonly outlineMaterials = new Map<
    boolean,
    THREE.LineBasicMaterial
  >();
  private readonly buildingMaterials = new Map<
    boolean,
    THREE.MeshBasicMaterial
  >();
  private readonly shapes = new Map<BuildingKind, BuildingShape>();
  private readonly cells: GhostCell[] = [];
  private renderedTileCount = 0;
  private renderedInvalidTileCount = 0;
  private renderedValid = false;
  private previousPreview: PlacementPreview | null = null;
  private renderedKind: BuildingKind | null = null;
  private renderedLevel: 1 | 2 | 3 | null = null;
  private disposed = false;

  constructor() {
    this.fillMaterials.set(
      true,
      new THREE.MeshBasicMaterial({
        color: validColor,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.fillMaterials.set(
      false,
      new THREE.MeshBasicMaterial({
        color: invalidColor,
        transparent: true,
        opacity: 0.3,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.outlineMaterials.set(
      true,
      new THREE.LineBasicMaterial({ color: validColor }),
    );
    this.outlineMaterials.set(
      false,
      new THREE.LineBasicMaterial({
        color: invalidColor,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.buildingMaterials.set(
      true,
      new THREE.MeshBasicMaterial({
        color: validColor,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.buildingMaterials.set(
      false,
      new THREE.MeshBasicMaterial({
        color: invalidColor,
        transparent: true,
        opacity: 0.64,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.group.name = "placement-preview-ghosts";
    this.group.visible = false;
  }

  private shape(kind: BuildingKind): BuildingShape {
    let shape = this.shapes.get(kind);
    if (shape === undefined) {
      shape = createBuildingShape(kind);
      this.shapes.set(kind, shape);
    }
    return shape;
  }

  private ensureCell(index: number): GhostCell {
    let cell = this.cells[index];
    if (cell !== undefined) return cell;
    const fill = new THREE.Mesh(
      this.cellGeometry,
      this.fillMaterials.get(true)!,
    );
    fill.name = "placement-preview-cell-" + index;
    const outline = new THREE.LineSegments(
      this.edgeGeometry,
      this.outlineMaterials.get(true)!,
    );
    outline.name = "placement-preview-cell-outline-" + index;
    const building = new THREE.Mesh(
      this.shape("Campfire").geometry,
      this.buildingMaterials.get(true)!,
    );
    building.name = "placement-preview-building-" + index;
    cell = { fill, outline, building };
    this.cells[index] = cell;
    this.group.add(fill, outline, building);
    return cell;
  }

  render(preview: PlacementPreview | null): void {
    if (this.disposed || preview === this.previousPreview) return;
    this.previousPreview = preview;
    if (preview === null || preview.tiles.length === 0) {
      this.group.visible = false;
      this.renderedTileCount = 0;
      this.renderedInvalidTileCount = 0;
      this.renderedValid = false;
      this.renderedKind = null;
      this.renderedLevel = null;
      for (const cell of this.cells) {
        cell.fill.visible = false;
        cell.outline.visible = false;
        cell.building.visible = false;
      }
      return;
    }

    this.group.visible = true;
    this.renderedTileCount = preview.tiles.length;
    this.renderedInvalidTileCount = preview.tiles.filter(
      (tile) => !tile.valid,
    ).length;
    this.renderedValid = preview.valid;
    this.renderedKind = preview.buildingKind;
    this.renderedLevel = preview.level;
    const shape = this.shape(preview.buildingKind);
    const levelScale = 1 + (preview.level - 1) * 0.06;

    preview.tiles.forEach((tile, index) => {
      const cell = this.ensureCell(index);
      const valid = tile.valid;
      const x = tile.position.x;
      const z = -tile.position.y;
      cell.fill.visible = true;
      cell.outline.visible = true;
      cell.building.visible = true;
      cell.fill.position.set(x, 0.045, z);
      cell.outline.position.set(x, 0.045, z);
      cell.building.position.set(x, 0.075 + (shape.height * levelScale) / 2, z);
      cell.building.scale.set(1, levelScale, 1);
      cell.fill.material = this.fillMaterials.get(valid)!;
      cell.outline.material = this.outlineMaterials.get(valid)!;
      cell.building.material = this.buildingMaterials.get(valid)!;
      // A rejected tile must stay visible over the object causing rejection.
      // Valid ghosts stay depth-tested; rejected feedback never writes depth.
      cell.fill.renderOrder = valid ? 0 : 1;
      cell.building.renderOrder = valid ? 0 : 2;
      cell.outline.renderOrder = valid ? 0 : 3;
      cell.building.geometry = shape.geometry;
      cell.fill.userData.placementValid = valid;
      cell.outline.userData.placementValid = valid;
      cell.building.userData.placementValid = valid;
      cell.building.userData.buildingKind = preview.buildingKind;
      cell.building.userData.level = preview.level;
    });
    for (
      let index = preview.tiles.length;
      index < this.cells.length;
      index += 1
    ) {
      const cell = this.cells[index];
      if (cell === undefined) continue;
      cell.fill.visible = false;
      cell.outline.visible = false;
      cell.building.visible = false;
    }
  }

  diagnostics(): {
    readonly renderedTileCount: number;
    readonly renderedInvalidTileCount: number;
    readonly valid: boolean;
    readonly buildingKind: BuildingKind | null;
    readonly level: 1 | 2 | 3 | null;
    readonly visible: boolean;
  } {
    return {
      renderedTileCount: this.renderedTileCount,
      renderedInvalidTileCount: this.renderedInvalidTileCount,
      valid: this.renderedValid,
      buildingKind: this.renderedKind,
      level: this.renderedLevel,
      visible: this.group.visible,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.visible = false;
    this.renderedTileCount = 0;
    this.renderedInvalidTileCount = 0;
    this.renderedValid = false;
    this.renderedKind = null;
    this.renderedLevel = null;
    this.group.clear();
    this.cellGeometry.dispose();
    this.edgeGeometry.dispose();
    for (const material of this.fillMaterials.values()) material.dispose();
    for (const material of this.outlineMaterials.values()) material.dispose();
    for (const material of this.buildingMaterials.values()) material.dispose();
    for (const shape of this.shapes.values()) shape.geometry.dispose();
    this.cells.length = 0;
    this.previousPreview = null;
    this.shapes.clear();
    this.fillMaterials.clear();
    this.outlineMaterials.clear();
    this.buildingMaterials.clear();
  }
}
