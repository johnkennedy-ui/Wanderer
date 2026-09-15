import { describe, expect, it } from "vitest";
import { advanceSimulationFrame } from "../../app/simulationSpeed";
import { GameSession } from "../../domain/GameSession";
import {
  WANDERER_WEB_V1,
  WANDERER_WEB_V2,
  WANDERER_WEB_V3,
} from "../../domain/world";

describe("terrain movement regressions", () => {
  it.each([WANDERER_WEB_V1, WANDERER_WEB_V2, WANDERER_WEB_V3])(
    "keeps an unobstructed tap destination through zero and rounded tiny remainders (%s)",
    (generatorVersion) => {
      const session = new GameSession({
        world: { seed: "wanderer-known-seed", generatorVersion },
      });
      session.setDestination({
        destination: { x: 5, y: 0 },
        source: "tap-to-move",
        at: 1,
      });
      session.tick(0);
      expect(session.presentation().ui.player.position).toEqual({
        x: 0,
        y: 0,
      });
      expect(session.presentation().renderer.destination).toEqual({
        x: 5,
        y: 0,
      });
      const steps: number[] = [];

      advanceSimulationFrame(0.0201, 5, (delta) => {
        steps.push(delta);
        session.tick(delta);
      });

      expect(steps).toHaveLength(2);
      expect(steps[0]).toBeCloseTo(0.1);
      expect(steps[1]).toBeCloseTo(0.0005);
      expect(session.presentation().ui.player.position).toEqual({
        x: 0.3,
        y: 0,
      });
      expect(session.presentation().renderer.destination).toEqual({
        x: 5,
        y: 0,
      });

      session.tick(0.1);
      expect(session.presentation().ui.player.position).toEqual({
        x: 0.6,
        y: 0,
      });
      expect(session.presentation().renderer.destination).toEqual({
        x: 5,
        y: 0,
      });
    },
  );
});
