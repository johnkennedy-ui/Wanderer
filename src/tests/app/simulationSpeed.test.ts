import { describe, expect, it } from "vitest";
import { advanceSimulationFrame } from "../../app/simulationSpeed";

describe("runtime simulation speed", () => {
  it("scales an ordinary browser frame by each supported rate", () => {
    const atOne: number[] = [];
    const atTwo: number[] = [];
    const atFive: number[] = [];

    advanceSimulationFrame(0.016, 1, (step) => atOne.push(step));
    advanceSimulationFrame(0.016, 2, (step) => atTwo.push(step));
    advanceSimulationFrame(0.016, 5, (step) => atFive.push(step));

    expect(atOne).toEqual([0.016]);
    expect(atTwo).toEqual([0.032]);
    expect(atFive).toEqual([0.08]);
  });

  it("bounds wall-time gaps before scaling and subdivides accelerated time", () => {
    const steps: number[] = [];

    advanceSimulationFrame(1, 5, (step) => steps.push(step));

    expect(steps).toHaveLength(5);
    for (const step of steps) expect(step).toBeCloseTo(0.1);
    expect(steps.reduce((total, step) => total + step, 0)).toBeCloseTo(0.5);
  });

  it("does not turn invalid or negative browser timing into simulation time", () => {
    const steps: number[] = [];

    advanceSimulationFrame(-1, 5, (step) => steps.push(step));
    advanceSimulationFrame(Number.NaN, 5, (step) => steps.push(step));
    advanceSimulationFrame(Number.POSITIVE_INFINITY, 5, (step) =>
      steps.push(step),
    );

    expect(steps).toEqual([]);
  });
});
