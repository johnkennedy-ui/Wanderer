import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
const artifactModulePath = "../../../scripts/security/artifact.mjs";
const browserModulePath = "../../../scripts/agent/browser-test.mjs";
const {
  collectArtifact,
  createArtifact,
  verifyArtifact,
  markBrowserVerified,
  parseArguments,
} = await import(artifactModulePath);
const { runBrowserMatrix } = await import(browserModulePath);
const directories: string[] = [];
const html = (base: string) =>
  `<!doctype html><html><head><link rel="icon" href="${base}favicon.svg"><script type="module" src="${base}assets/index-abc123.js"></script><link rel="stylesheet" href="${base}assets/index-abc123.css"></head><body></body></html>`;
const fixture = (base = "/Wanderer/") => {
  const cwd = mkdtempSync(join(tmpdir(), "wanderer-artifact-"));
  directories.push(cwd);
  for (const path of ["dist/assets", "public", "scripts/security"])
    mkdirSync(join(cwd, path), { recursive: true });
  writeFileSync(join(cwd, "dist/index.html"), html(base));
  for (const path of ["public/favicon.svg", "dist/favicon.svg"])
    writeFileSync(join(cwd, path), "<svg />");
  writeFileSync(join(cwd, "dist/assets/index-abc123.js"), "export {};");
  writeFileSync(join(cwd, "dist/assets/index-abc123.css"), "body{}");
  writeFileSync(
    join(cwd, "scripts/security/public-assets.json"),
    JSON.stringify({ schemaVersion: 1, paths: ["favicon.svg"] }),
  );
  writeFileSync(join(cwd, "package-lock.json"), "{}");
  writeFileSync(join(cwd, "package.json"), "{}");
  return cwd;
};
const identity = {
  sourceSha: "a".repeat(40),
  sourceTree: "b".repeat(40),
  sourceInputDigest: "c".repeat(64),
  lockfileSha256: "d".repeat(64),
  tools: { node: "v22.23.2", npm: "10.9.8" },
  workflowRunId: "1",
  workflowRunAttempt: "1",
};
const options = (cwd: string) => ({ cwd, identity, basePath: "/Wanderer/" });
afterEach(() =>
  directories
    .splice(0)
    .forEach((directory) =>
      rmSync(directory, { recursive: true, force: true }),
    ),
);

describe("artifact identity and reviewed membership", () => {
  it("sorts and hashes only the actual published layout", () => {
    const value = collectArtifact(options(fixture()));
    expect(value.files.map((f: any) => f.path)).toEqual([
      "assets/index-abc123.css",
      "assets/index-abc123.js",
      "favicon.svg",
      "index.html",
    ]);
  });
  it.each([
    ".env.production",
    ".git/config",
    "assets/secret.key",
    "assets/debug.js",
    "assets/report.json",
    "assets/dev.py",
    "assets/index-abc123.js.map",
    "assets/test-results/report.html",
    ".agent/report.json",
  ])("rejects unexpected payload %s", (path) => {
    const cwd = fixture();
    const absolute = join(cwd, "dist", path);
    mkdirSync(resolve(absolute, ".."), { recursive: true });
    writeFileSync(absolute, "inert");
    expect(() => collectArtifact(options(cwd))).toThrow();
  });
  it.each([".git", "assets/.agent", "playwright-report", "assets/unknown"])(
    "rejects even empty forbidden directory %s",
    (path) => {
      const cwd = fixture();
      mkdirSync(join(cwd, "dist", path), { recursive: true });
      expect(() => collectArtifact(options(cwd))).toThrow(
        "unexpected directory",
      );
    },
  );
  it("rejects a newly added public payload instead of automatically authorizing it", () => {
    const cwd = fixture();
    for (const root of ["public", "dist"])
      writeFileSync(join(cwd, root, "key.json"), "inert");
    expect(() => collectArtifact(options(cwd))).toThrow("payload");
  });
  it("binds public output bytes to source bytes", () => {
    const cwd = fixture();
    writeFileSync(join(cwd, "dist/favicon.svg"), "changed");
    expect(() => collectArtifact(options(cwd))).toThrow(
      "differs from its source",
    );
  });
  it.each(["content", "mode", "delete"])(
    "rejects %s drift after creation",
    (kind) => {
      const cwd = fixture();
      createArtifact(options(cwd));
      expect(() => verifyArtifact(options(cwd))).not.toThrow();
      const path = join(cwd, "dist/assets/index-abc123.js");
      if (kind === "content") writeFileSync(path, "changed");
      else if (kind === "mode") chmodSync(path, 0o600);
      else rmSync(path);
      expect(() => verifyArtifact(options(cwd))).toThrow();
    },
  );
  it.each([
    "sourceSha",
    "sourceTree",
    "sourceInputDigest",
    "lockfileSha256",
    "workflowRunId",
    "workflowRunAttempt",
  ])("rejects changed %s identity", (field) => {
    const cwd = fixture();
    createArtifact(options(cwd));
    expect(() =>
      verifyArtifact({
        ...options(cwd),
        identity: { ...identity, [field]: "changed" },
      }),
    ).toThrow("changed after");
  });
  it("rejects tool and manifest schema drift", () => {
    const cwd = fixture();
    const made = createArtifact(options(cwd));
    expect(() =>
      verifyArtifact({
        ...options(cwd),
        identity: { ...identity, tools: { node: "v24", npm: "10" } },
      }),
    ).toThrow();
    const value = JSON.parse(readFileSync(made.path, "utf8"));
    value.schemaVersion = 1;
    writeFileSync(made.path, JSON.stringify(value));
    expect(() => verifyArtifact(options(cwd))).toThrow();
  });
  it("rejects root bytes incorrectly labelled as Pages and vice versa", () => {
    expect(() => collectArtifact({ ...options(fixture("/")) })).toThrow("base");
    expect(() =>
      collectArtifact({ ...options(fixture()), basePath: "/" }),
    ).toThrow();
  });
  it.each(["/unexpected/", "Wanderer", "/Wanderer", "//", ""])(
    "rejects unsupported base %s",
    (value) => {
      expect(() => parseArguments(["create", "--base", value])).toThrow(
        "exactly",
      );
    },
  );
  it("uses root by default and the actual Vite base for creation", () => {
    expect(parseArguments(["create"], {})).toEqual({
      action: "create",
      basePath: "/",
    });
    expect(
      parseArguments(["create"], { VITE_BASE_PATH: "/Wanderer/" }).basePath,
    ).toBe("/Wanderer/");
    expect(() =>
      parseArguments(["verify", "--base", "/", "--base", "/Wanderer/"]),
    ).toThrow();
  });
  it.each(["output", "dist", "manifest", "ancestor", "dangling"])(
    "rejects %s symlinks",
    (kind) => {
      const cwd = fixture();
      const outside = fixture();
      if (kind === "output")
        symlinkSync(
          join(outside, "dist/index.html"),
          join(cwd, "dist/assets/linked"),
        );
      if (kind === "dist") {
        rmSync(join(cwd, "dist"), { recursive: true });
        symlinkSync(join(outside, "dist"), join(cwd, "dist"));
      }
      if (kind === "ancestor") symlinkSync(outside, join(cwd, ".agent"));
      if (kind === "manifest" || kind === "dangling") {
        mkdirSync(join(cwd, ".agent/artifacts"), { recursive: true });
        symlinkSync(
          join(outside, kind === "manifest" ? "package.json" : "missing"),
          join(cwd, ".agent/artifacts/pages.json"),
        );
      }
      expect(() => createArtifact(options(cwd))).toThrow("Symlink");
    },
  );
  it("does not mistake a content manifest for a successful browser run", () => {
    const cwd = fixture();
    createArtifact(options(cwd));
    expect(() =>
      verifyArtifact({ ...options(cwd), requireBrowser: true }),
    ).toThrow("browser");
    markBrowserVerified(options(cwd));
    expect(() =>
      verifyArtifact({ ...options(cwd), requireBrowser: true }),
    ).not.toThrow();
    createArtifact(options(cwd));
    expect(() =>
      verifyArtifact({ ...options(cwd), requireBrowser: true }),
    ).toThrow("browser");
  });
  it.each(["/", "/Wanderer/"])(
    "executes the real creation CLI at %s and refuses an untested publication",
    (basePath) => {
      const cwd = fixture(basePath);
      writeFileSync(join(cwd, ".gitignore"), ".agent/\ndist/\n");
      execFileSync("git", ["init", "--quiet"], { cwd });
      execFileSync("git", ["add", "."], { cwd });
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Artifact Test",
          "-c",
          "user.email=test@example.invalid",
          "commit",
          "--quiet",
          "-m",
          "fixture",
        ],
        { cwd },
      );
      const command = resolve(process.cwd(), "scripts/security/artifact.mjs");
      execFileSync(process.execPath, [command, "create"], {
        cwd,
        env: { ...process.env, VITE_BASE_PATH: basePath },
        stdio: "pipe",
      });
      const made = JSON.parse(
        readFileSync(
          join(
            cwd,
            ".agent/artifacts",
            basePath === "/" ? "root.json" : "pages.json",
          ),
          "utf8",
        ),
      );
      expect(made.basePath).toBe(basePath);
      expect(made.identity.sourceSha).toMatch(/^[a-f0-9]{40}$/);
      expect(() =>
        execFileSync(
          process.execPath,
          [command, "verify", "--base", basePath],
          { cwd, stdio: "pipe" },
        ),
      ).toThrow();
    },
  );
});

describe("build-once/browser-existing orchestration", () => {
  const setup = () => {
    const cwd = fixture();
    mkdirSync(join(cwd, "node_modules/playwright"), { recursive: true });
    writeFileSync(join(cwd, "node_modules/playwright/cli.js"), "");
    return cwd;
  };
  it.each([false, true])(
    "preserves both bases with reuse=%s and verifies before/after each test",
    (reuse) => {
      const cwd = setup();
      const events: string[] = [];
      const commands: any[] = [];
      runBrowserMatrix({
        cwd,
        argv: reuse ? ["--reuse-root-build"] : [],
        environment: {},
        run: (command: string, args: string[], opts: any) => {
          commands.push({ command, args, env: opts.env });
          const kind =
            command === process.execPath
              ? args[0].endsWith("node_modules/vite/bin/vite.js")
                ? "build"
                : args[0].endsWith("scripts/security/artifact.mjs")
                  ? "artifact"
                  : "test"
              : "test";
          events.push(`${kind}:${opts.env.PLAYWRIGHT_BASE_PATH}`);
          return { status: 0 };
        },
        verify: (opts: any) => {
          events.push(`verify:${opts.basePath}`);
          return { manifest: { contentSha256: "stable" } };
        },
        mark: (opts: any) => events.push(`mark:${opts.basePath}`),
      });
      expect(
        commands.filter(
          (c) =>
            c.command === process.execPath &&
            c.args[0].endsWith("node_modules/vite/bin/vite.js"),
        ),
      ).toHaveLength(reuse ? 1 : 2);
      expect(
        commands.filter(
          (c) =>
            c.command === process.execPath &&
            c.args[0].endsWith("scripts/security/artifact.mjs"),
        ),
      ).toHaveLength(reuse ? 1 : 2);
      expect(
        commands.filter(
          (c) =>
            c.command === process.execPath &&
            c.args[0].endsWith("node_modules/playwright/cli.js"),
        ),
      ).toHaveLength(2);
      for (const c of commands)
        expect(c.env.VITE_BASE_PATH).toBe(c.env.PLAYWRIGHT_BASE_PATH);
      expect(events.filter((e) => e.startsWith("test:"))).toEqual([
        "test:/",
        "test:/Wanderer/",
      ]);
      expect(events.at(-1)).toBe("verify:/Wanderer/");
      for (const path of ["/", "/Wanderer/"]) {
        const index = events.indexOf(`test:${path}`);
        expect(events[index - 1]).toBe(`verify:${path}`);
        expect(events[index + 1]).toBe(`verify:${path}`);
      }
    },
  );
  it("stops on command failure and never marks an unverified artifact", () => {
    const cwd = setup();
    let marks = 0;
    expect(() =>
      runBrowserMatrix({
        cwd,
        run: () => ({ status: 1 }),
        verify: () => ({ manifest: { contentSha256: "same" } }),
        mark: () => {
          marks++;
        },
      }),
    ).toThrow("failed");
    expect(marks).toBe(0);
  });
  it("stops when bytes change during the browser run", () => {
    const cwd = setup();
    let count = 0;
    let marks = 0;
    expect(() =>
      runBrowserMatrix({
        cwd,
        run: () => ({ status: 0 }),
        verify: () => ({ manifest: { contentSha256: String(count++) } }),
        mark: () => {
          marks++;
        },
      }),
    ).toThrow("changed");
    expect(marks).toBe(0);
  });
  it("rejects missing dependencies, unknown and repeated flags", () => {
    expect(() => runBrowserMatrix({ cwd: fixture() })).toThrow("missing");
    for (const argv of [
      ["--skip"],
      ["--reuse-root-build", "--reuse-root-build"],
    ])
      expect(() => runBrowserMatrix({ cwd: setup(), argv })).toThrow("Usage");
  });
});
