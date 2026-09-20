import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const actionlintModulePath = "../../../scripts/ci/actionlint.mjs";
const { bootstrapActionlint } = await import(actionlintModulePath);

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

// Exercise the real bootstrap in a child, replacing only its subprocess
// boundary before import. No executable temporary files, network, pinned vendor
// payload or scanner installation is required; unexpected subprocesses fail.
const bootstrap = (
  mode:
    | "download-error"
    | "wrong-download"
    | "wrong-cache"
    | "spawn-error"
    | "signal",
) => {
  const cwd = mkdtempSync(join(tmpdir(), "wanderer-actionlint-negative-"));
  roots.push(cwd);
  const calls = join(cwd, "calls.jsonl");
  const toolDirectory = join(cwd, ".agent/tools/actionlint-1.7.12");
  if (mode === "wrong-cache") {
    mkdirSync(toolDirectory, { recursive: true });
    writeFileSync(join(toolDirectory, "actionlint.tar.gz"), "corrupt cache");
  }
  const moduleUrl = new URL(
    "../../../scripts/ci/actionlint.mjs",
    import.meta.url,
  );
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { appendFileSync, writeFileSync } from "node:fs";
const mode = ${JSON.stringify(mode)};
childProcess.spawnSync = (name, args, options) => {
  appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ name, args, options }) + "\\n");
  if (name !== "curl") throw new Error("Unexpected subprocess: " + name);
  if (mode === "spawn-error")
    return { error: new Error("spawnSync curl EACCES"), status: null, signal: null };
  writeFileSync(args[args.indexOf("--output") + 1], "inert unverified archive");
  return { status: mode === "download-error" ? 22 : mode === "signal" ? null : 0,
    signal: mode === "signal" ? "SIGTERM" : null };
};
syncBuiltinESMExports();
const { runActionlint } = await import(${JSON.stringify(moduleUrl.href)});
await runActionlint(process.cwd());`,
    ],
    {
      cwd,
      // Snapshot validation is a Python archive operation; the patched Node
      // subprocess boundary still rejects curl/tar/executable invocation.
      env: { ...process.env },
      encoding: "utf8",
      timeout: 5_000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(1);
  expect(existsSync(join(toolDirectory, "actionlint"))).toBe(false);
  expect(
    readdirSync(toolDirectory).some((name) => name.endsWith(".part")),
  ).toBe(false);
  const observed: {
    name: string;
    args: string[];
    options: { encoding: string; timeout: number };
  }[] = existsSync(calls)
    ? readFileSync(calls, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
  expect(observed.some((call) => call.name === "tar")).toBe(false);
  return { result, observed, toolDirectory };
};

describe("actionlint download rejects unverified bytes before execution", () => {
  it.each([
    ["download-error", "actionlint download failed (22)"],
    ["wrong-download", "actionlint download checksum mismatch"],
    ["spawn-error", "actionlint download failed (spawnSync curl EACCES)"],
    ["signal", "actionlint download failed (SIGTERM)"],
  ] as const)("rejects %s without extraction", (mode, message) => {
    const { result, observed, toolDirectory } = bootstrap(mode);
    expect(result.stderr).toContain(message);
    expect(observed).toHaveLength(1);
    expect(observed[0].name).toBe("curl");
    expect(observed[0].options).toEqual({
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(observed[0].args.slice(0, 4)).toEqual([
      "--fail",
      "--location",
      "--silent",
      "--show-error",
    ]);
    expect(observed[0].args.at(-1)).toBe(
      "https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz",
    );
    expect(existsSync(join(toolDirectory, "actionlint.tar.gz"))).toBe(false);
  });

  it("rejects a corrupt cache without downloading or extracting", () => {
    const { result, observed, toolDirectory } = bootstrap("wrong-cache");
    expect(result.stderr).toContain(
      "cached actionlint archive checksum mismatch",
    );
    expect(observed).toEqual([]);
    expect(readFileSync(join(toolDirectory, "actionlint.tar.gz"), "utf8")).toBe(
      "corrupt cache",
    );
  });
});

describe("actionlint private archive execution", () => {
  it("extracts and executes inert bytes only below a private run directory", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "wanderer-actionlint-private-"));
    roots.push(cwd);
    const spec = {
      version: "fixture",
      url: "https://invalid.example/fixture",
      sha256: createHash("sha256").update("inert archive").digest("hex"),
    };
    const cache = join(
      cwd,
      ".agent/tools/actionlint-fixture/actionlint.tar.gz",
    );
    mkdirSync(join(cwd, ".agent/tools/actionlint-fixture"), {
      recursive: true,
    });
    writeFileSync(cache, "inert archive");
    const calls: string[] = [];
    const spawn = (name: string, args: string[]) => {
      calls.push(name);
      if (name === "tar") {
        expect(args[1]).not.toBe(cache);
        writeFileSync(cache, "changed cache bytes");
        return {
          status: 0,
          signal: null,
          stdout: Buffer.from("inert actionlint"),
          stderr: null,
        };
      }
      expect(name.includes(".agent/tools")).toBe(false);
      expect(name).toContain("wanderer-sec01-actionlint-");
      return { status: 0, signal: null, stdout: "", stderr: "" };
    };
    await expect(
      bootstrapActionlint(cwd, { spec, spawn: spawn as any }),
    ).resolves.toMatchObject({ exitCode: 0 });
    expect(calls).toEqual([
      "tar",
      expect.stringContaining("wanderer-sec01-actionlint-"),
    ]);
    expect(readdirSync(join(cwd, ".agent/tools"))).not.toContain(
      "private-runs",
    );
  });

  it("removes the private actionlint path after execution failure", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "wanderer-actionlint-private-"));
    roots.push(cwd);
    const spec = {
      version: "fixture",
      url: "https://invalid.example/fixture",
      sha256: createHash("sha256").update("inert archive").digest("hex"),
    };
    const cache = join(
      cwd,
      ".agent/tools/actionlint-fixture/actionlint.tar.gz",
    );
    mkdirSync(join(cwd, ".agent/tools/actionlint-fixture"), {
      recursive: true,
    });
    writeFileSync(cache, "inert archive");
    let binary = "";
    const spawn = (name: string) => {
      if (name === "tar")
        return {
          status: 0,
          signal: null,
          stdout: Buffer.from("inert actionlint"),
          stderr: null,
        };
      binary = name;
      return { status: 1, signal: null, stdout: "", stderr: "failure" };
    };
    await expect(
      bootstrapActionlint(cwd, { spec, spawn: spawn as any }),
    ).rejects.toThrow("actionlint failed");
    expect(binary.includes(".agent/tools")).toBe(false);
    expect(existsSync(binary)).toBe(false);
  });
});
