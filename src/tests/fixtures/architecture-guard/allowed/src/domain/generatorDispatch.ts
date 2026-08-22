type Generator = (seed: string) => string;

const generateV1: Generator = (seed) => `terrain:${seed}`;

export const generators = Object.freeze({
  "wanderer-web-v1": generateV1,
});
