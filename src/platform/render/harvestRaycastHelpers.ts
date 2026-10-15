import type * as THREE from "three";

/**
 * Resolves nearest visible ray hits. A nearer terrain obstacle blocks selection
 * behind it; unrelated actors and transparent/decorative hits remain pass-through.
 */
export const buildingIdFromIntersections = (
  intersections: readonly THREE.Intersection[],
): string | null => {
  for (const hit of intersections) {
    let visible = true;
    for (
      let current: THREE.Object3D | null = hit.object;
      current !== null;
      current = current.parent
    )
      if (!current.visible) {
        visible = false;
        break;
      }
    if (!visible) continue;

    for (
      let current: THREE.Object3D | null = hit.object;
      current !== null;
      current = current.parent
    ) {
      const buildingId = current.userData.buildingId;
      if (typeof buildingId === "string") return buildingId;
      if (current.userData.harvestRayBlocker === true) return null;
    }
  }
  return null;
};

export const harvestableNodeIdFromIntersections = (
  intersections: readonly THREE.Intersection[],
): string | null => {
  for (const hit of intersections) {
    let visible = true;
    for (
      let current: THREE.Object3D | null = hit.object;
      current !== null;
      current = current.parent
    )
      if (!current.visible) {
        visible = false;
        break;
      }
    if (!visible) continue;

    for (
      let current: THREE.Object3D | null = hit.object;
      current !== null;
      current = current.parent
    ) {
      const nodeId = current.userData.harvestNodeId;
      if (typeof nodeId === "string") return nodeId;
      if (current.userData.harvestRayBlocker === true) return null;
    }
  }
  return null;
};
