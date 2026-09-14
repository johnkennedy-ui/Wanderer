import * as THREE from "three";
import { gameplayTuning } from "../../data/definitions";
import type { EnemyState } from "../../domain/types";
import { enemyPresentation } from "./projectionResourceHelpers";

interface EnemyHealthBar {
  readonly element: HTMLDivElement;
  readonly fill: HTMLSpanElement;
}

const setAttribute = (
  element: HTMLElement,
  name: string,
  value: string,
): void => {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
};

const healthBarHeightFor = (enemy: EnemyState): number => {
  const scale = enemy.isWaveBoss ? gameplayTuning.waveBossVisualScale : 1;
  return enemyPresentation[enemy.kind].height * scale + 0.35;
};

/**
 * Renderer-owned DOM projection for living enemy health. It retains no gameplay
 * state: every frame derives position and values only from the supplied snapshot.
 */
export class EnemyHealthOverlay {
  private readonly bars = new Map<string, EnemyHealthBar>();
  private readonly projectedPosition = new THREE.Vector3();
  private disposed = false;

  constructor(private readonly host: HTMLElement) {}

  render(enemies: readonly EnemyState[], camera: THREE.Camera): void {
    if (this.disposed) return;
    const visibleIds = new Set<string>();
    for (const enemy of enemies) {
      if (enemy.defeated || enemy.hp <= 0 || enemy.maxHp <= 0) continue;
      visibleIds.add(enemy.id);
      const bar = this.bars.get(enemy.id) ?? this.create(enemy.id);
      this.update(bar, enemy, camera);
    }
    for (const [id, bar] of this.bars) {
      if (visibleIds.has(id)) continue;
      bar.element.remove();
      this.bars.delete(id);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const bar of this.bars.values()) bar.element.remove();
    this.bars.clear();
  }

  private create(id: string): EnemyHealthBar {
    const element = document.createElement("div");
    element.dataset.testid = "world-enemy-hp";
    element.dataset.enemyId = id;
    element.className = "world-enemy-hp";
    element.setAttribute("role", "meter");
    const fill = document.createElement("span");
    fill.className = "world-enemy-hp-fill";
    fill.setAttribute("aria-hidden", "true");
    element.append(fill);
    this.host.append(element);
    const bar = { element, fill };
    this.bars.set(id, bar);
    return bar;
  }

  private update(
    bar: EnemyHealthBar,
    enemy: EnemyState,
    camera: THREE.Camera,
  ): void {
    const hp = Math.min(enemy.maxHp, Math.max(0, enemy.hp));
    const healthRatio = hp / enemy.maxHp;
    const displayHealth = `${Math.ceil(hp)} / ${Math.ceil(enemy.maxHp)} HP`;
    this.projectedPosition
      .set(enemy.position.x, healthBarHeightFor(enemy), -enemy.position.y)
      .project(camera);
    const left = `${((this.projectedPosition.x + 1) / 2) * 100}%`;
    const top = `${((1 - this.projectedPosition.y) / 2) * 100}%`;
    const width = `${healthRatio * 100}%`;
    if (bar.element.style.left !== left) bar.element.style.left = left;
    if (bar.element.style.top !== top) bar.element.style.top = top;
    if (bar.fill.style.width !== width) bar.fill.style.width = width;
    setAttribute(bar.element, "aria-label", `${enemy.kind} health`);
    setAttribute(bar.element, "aria-valuemin", "0");
    setAttribute(bar.element, "aria-valuemax", String(enemy.maxHp));
    setAttribute(bar.element, "aria-valuenow", String(hp));
    setAttribute(bar.element, "aria-valuetext", displayHealth);
  }
}
