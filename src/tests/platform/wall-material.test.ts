import { describe, expect, it } from "vitest";
import { DataTexture } from "three";
import { gameplayTuning } from "../../data/definitions";
import { ProjectionResources } from "../../platform/render/projectionResourceHelpers";

describe("retained procedural wall materials", () => {
  it("matches the tile footprint and keeps wood planks distinct from stone masonry", () => {
    const resources = new ProjectionResources();
    const geometry = resources.wall();
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.x - geometry.boundingBox!.min.x).toBe(
      gameplayTuning.buildingTileSize,
    );
    expect(geometry.boundingBox!.max.z - geometry.boundingBox!.min.z).toBe(
      gameplayTuning.buildingTileSize,
    );
    const wood = resources.wallMaterial("WoodWall");
    const stone = resources.wallMaterial("StoneWall");
    expect(wood.color.getHex()).not.toBe(stone.color.getHex());
    expect(wood.map).toBeInstanceOf(DataTexture);
    expect(stone.map).toBeInstanceOf(DataTexture);
    expect((wood.map as DataTexture).image.data).not.toEqual(
      (stone.map as DataTexture).image.data,
    );
    for (let index = 0; index < 20; index += 1) {
      expect(resources.wall()).toBe(geometry);
      expect(resources.wallMaterial("WoodWall")).toBe(wood);
      expect(resources.wallMaterial("StoneWall")).toBe(stone);
    }
    expect(resources.diagnostics().materialsCreated).toBe(2);
    expect(resources.diagnostics().geometriesCreated).toBe(1);
    let textureDisposals = 0;
    wood.map!.addEventListener("dispose", () => {
      textureDisposals += 1;
    });
    stone.map!.addEventListener("dispose", () => {
      textureDisposals += 1;
    });
    resources.dispose();
    resources.dispose();
    expect(textureDisposals).toBe(2);
    expect(resources.diagnostics().materialsDisposed).toBe(2);
    expect(() => resources.wallMaterial("WoodWall")).toThrow("disposed");
  });
});
