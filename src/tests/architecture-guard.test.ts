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

const allowedFixture = runFixture("allowed");
const rejectedFixture = runFixture("rejected");

const expectAllowedFixture = (): void => {
  expect(allowedFixture.error).toBeUndefined();
  expect(allowedFixture.status).toBe(0);
  expect(allowedFixture.stdout).toContain("architecture guard: PASS");
  expect(allowedFixture.stdout).toContain("7 production TypeScript files");
};

const expectRejectedFixture = (): void => {
  expect(rejectedFixture.error).toBeUndefined();
  expect(rejectedFixture.status).toBe(1);
};

describe("TypeScript architecture guard self-tests", () => {
  it("allows immutable constants, frozen catalogues, immutable generator dispatch, and instance-owned disposable caches", () => {
    expectAllowedFixture();
  });

  it("allows narrow type-only imports through an input contract", () => {
    expectAllowedFixture();
  });

  it("rejects GameSession construction and value-import authority outside composition", () => {
    expectRejectedFixture();
    expect(rejectedFixture.stderr).toMatch(
      /src\/platform\/illegalGameSession\.ts:\d+:\d+ \[ARCH001\]/,
    );
    expect(rejectedFixture.stderr).toMatch(
      /src\/platform\/illegalGameSession\.ts:\d+:\d+ \[ARCH002\]/,
    );
  });

  it("rejects mutable top-level state, singleton authority, and mutable statics", () => {
    expectRejectedFixture();
    expect(rejectedFixture.stderr).toMatch(
      /src\/domain\/illegalState\.ts:\d+:\d+ \[ARCH006\] exported mutable literal TYPE_ONLY_IMMUTABLE must be frozen/,
    );
    expect(rejectedFixture.stderr).toMatch(
      /src\/domain\/illegalState\.ts:\d+:\d+ \[ARCH007\]/,
    );
    expect(rejectedFixture.stderr).toMatch(
      /src\/domain\/illegalState\.ts:\d+:\d+ \[ARCH008\]/,
    );
  });

  it("rejects pure-layer and concrete-adapter import leaks", () => {
    expectRejectedFixture();
    expect(rejectedFixture.stderr).toMatch(
      /src\/domain\/illegalImport\.ts:\d+:\d+ \[ARCH003\]/,
    );
    expect(rejectedFixture.stderr).toMatch(
      /src\/platform\/adapter\.ts:\d+:\d+ \[ARCH004\]/,
    );
  });

  it("rejects production import cycles", () => {
    expectRejectedFixture();
    expect(rejectedFixture.stderr).toMatch(
      /src\/domain\/cycle[AB]\.ts:\d+:\d+ \[ARCH009\]/,
    );
  });

  it("rejects automatic registration and service-locator authority", () => {
    expectRejectedFixture();
    expect(rejectedFixture.stderr).toMatch(
      /src\/app\/illegalPatterns\.ts:\d+:\d+ \[ARCH010\]/,
    );
    expect(rejectedFixture.stderr).toMatch(
      /src\/app\/illegalPatterns\.ts:\d+:\d+ \[ARCH011\]/,
    );
  });

  it("rejects browser, DOM, and storage APIs from pure domain code", () => {
    expectRejectedFixture();
    expect(rejectedFixture.stderr).toMatch(
      /src\/domain\/illegalBrowser\.ts:\d+:\d+ \[ARCH005\]/,
    );
    expect(rejectedFixture.stderr).toMatch(
      /src\/domain\/illegalBrowser\.ts:\d+:\d+ \[ARCH012\]/,
    );
    expect(rejectedFixture.stderr).toMatch(
      /src\/domain\/illegalBrowser\.ts:\d+:\d+ \[ARCH013\]/,
    );
  });
});
