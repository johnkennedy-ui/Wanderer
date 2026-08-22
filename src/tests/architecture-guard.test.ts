import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const fixtureRoot = fileURLToPath(
  new URL("./fixtures/architecture-guard/", import.meta.url),
);
const guardPath = fileURLToPath(
  new URL("./architecture-guard.mjs", import.meta.url),
);
const fixtureTsconfig = join(fixtureRoot, "tsconfig.json");

const runFixture = (fixture: "allowed" | "rejected") =>
  spawnSync(
    process.execPath,
    [
      guardPath,
      "--project-root",
      join(fixtureRoot, fixture),
      "--tsconfig",
      fixtureTsconfig,
    ],
    { encoding: "utf8" },
  );

describe("TypeScript architecture guard", () => {
  it("accepts immutable constants and deeply frozen catalogues", () => {
    const result = runFixture("allowed");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("architecture guard: PASS");
  });

  it("reports deliberate boundary violations with stable IDs and locations", () => {
    const result = runFixture("rejected");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    for (const ruleId of [
      "ARCH001",
      "ARCH002",
      "ARCH003",
      "ARCH004",
      "ARCH005",
      "ARCH006",
      "ARCH007",
      "ARCH008",
      "ARCH009",
      "ARCH010",
      "ARCH011",
      "ARCH012",
      "ARCH013",
    ])
      expect(result.stderr).toContain(`[${ruleId}]`);
    expect(result.stderr).toMatch(
      /src\/platform\/illegalGameSession\.ts:\d+:\d+ \[ARCH001\]/,
    );
    expect(result.stderr).toMatch(
      /src\/domain\/cycle[AB]\.ts:\d+:\d+ \[ARCH009\]/,
    );
  });
});
