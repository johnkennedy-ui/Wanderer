import "./platform/render/enemyHealthOverlay.css";
import "./ui/style.css";
import { createGameApplication } from "./app/createGameApplication";

const simulationSpeed =
  document.querySelector<HTMLMetaElement>(
    'meta[name="playwright-simulation-speed"]',
  )?.content === "5"
    ? 5
    : 1;
void createGameApplication(
  document.getElementById("app") as HTMLElement,
  simulationSpeed,
);
