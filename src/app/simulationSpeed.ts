export type SimulationSpeedMultiplier = 1 | 2 | 5;

const maximumWallFrameSeconds = 0.1;
const maximumSimulationStepSeconds = 0.1;

/**
 * Advances one browser frame at the selected runtime rate without replaying a
 * throttled/background wall-time gap. GameSession receives only bounded steps.
 */
export const advanceSimulationFrame = (
  wallDeltaSeconds: number,
  multiplier: SimulationSpeedMultiplier,
  tick: (deltaSeconds: number) => void,
): void => {
  if (!Number.isFinite(wallDeltaSeconds)) return;
  const simulatedSeconds =
    Math.max(0, Math.min(wallDeltaSeconds, maximumWallFrameSeconds)) *
    multiplier;
  const wholeSteps = Math.floor(
    simulatedSeconds / maximumSimulationStepSeconds,
  );
  for (let index = 0; index < wholeSteps; index += 1)
    tick(maximumSimulationStepSeconds);
  const remainder =
    simulatedSeconds - wholeSteps * maximumSimulationStepSeconds;
  if (remainder > Number.EPSILON) tick(remainder);
};
