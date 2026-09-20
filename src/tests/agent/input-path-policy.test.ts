import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
const policyPath = "../../../scripts/agent/input-path-policy.mjs";
const scannerPath = "../../../scripts/security/check.mjs";
const commonPath = "../../../scripts/agent/common.mjs";
const {
  OUTPUT_ONLY_ROOTS,
  assertInputReferences,
  isOutputOnlyPath,
  isSourceSnapshotExcludedPath,
  isDependencyOutputPath,
} = await import(policyPath);
const { runSecurityCheck } = await import(scannerPath);
const { collectInputFingerprint } = await import(commonPath);
const outputRoots: readonly string[] = OUTPUT_ONLY_ROOTS;
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);

const inheritedRepository = (alias: string) => {
  const cwd = mkdtempSync(join(tmpdir(), "wanderer-inherited-config-"));
  roots.push(cwd);
  execFileSync("git", ["init", "--quiet", "--initial-branch=fixture"], { cwd });
  mkdirSync(join(cwd, "configs/nested"), { recursive: true });
  mkdirSync(join(cwd, "src/app"), { recursive: true });
  writeFileSync(
    join(cwd, ".gitignore"),
    OUTPUT_ONLY_ROOTS.map((root: string) => root + "/").join("\n") + "\n",
  );
  writeFileSync(
    join(cwd, "tsconfig.json"),
    JSON.stringify({ extends: "./configs/nested/tsconfig.json" }),
  );
  writeFileSync(
    join(cwd, "configs/nested/tsconfig.json"),
    JSON.stringify({
      extends: "../base.json",
      compilerOptions: { baseUrl: "../../src" },
    }),
  );
  writeFileSync(
    join(cwd, "configs/base.json"),
    JSON.stringify({
      compilerOptions: { baseUrl: "../src", paths: { hidden: [alias] } },
    }),
  );
  writeFileSync(join(cwd, "src/main.ts"), 'import "hidden";\n');
  writeFileSync(join(cwd, "src/app/input.ts"), "export default 1;\n");
  execFileSync("git", ["add", "."], { cwd });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Input Policy Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ],
    { cwd },
  );
  return cwd;
};

describe("contained inherited compiler configuration at real consumers", () => {
  it.each(outputRoots)(
    "matches the real TypeScript alias resolution into %s and stops scanning",
    async (root: string) => {
      const cwd = inheritedRepository(`../${root}/input.ts`);
      mkdirSync(join(cwd, root), { recursive: true });
      const target = join(cwd, root, "input.ts");
      writeFileSync(target, "export default 2;\n");
      const parsedText = ts.readConfigFile(
        join(cwd, "tsconfig.json"),
        ts.sys.readFile,
      );
      expect(parsedText.error).toBeUndefined();
      const parsed = ts.parseJsonConfigFileContent(
        parsedText.config,
        ts.sys,
        cwd,
      );
      expect(parsed.errors).toEqual([]);
      expect(
        ts.resolveModuleName(
          "hidden",
          join(cwd, "src/main.ts"),
          parsed.options,
          ts.sys,
        ).resolvedModule?.resolvedFileName,
      ).toBe(target);
      let rejection: unknown;
      try {
        collectInputFingerprint({ cwd });
      } catch (error) {
        rejection = error;
      }
      expect(rejection).toMatchObject({ code: "OUTPUT_EXCLUSION_BYPASS" });
      let calls = 0;
      const forbidden = async () => {
        calls++;
        throw new Error("no scanner or tool may start");
      };
      await expect(
        runSecurityCheck({ cwd, execute: forbidden, useTool: forbidden }),
      ).rejects.toMatchObject({ code: "OUTPUT_EXCLUSION_BYPASS" });
      expect(calls).toBe(0);
    },
  );

  it("accepts an inherited source alias and fingerprints its configuration changes", () => {
    const cwd = inheritedRepository("app/input.ts");
    const before = collectInputFingerprint({ cwd });
    writeFileSync(
      join(cwd, "configs/base.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: "../src",
          paths: { hidden: ["./app/input.ts"] },
        },
      }),
    );
    expect(collectInputFingerprint({ cwd }).digest).not.toBe(before.digest);
  });

  it("rejects a non-relative dot-prefixed alias before scanner dispatch", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "wanderer-dot-alias-"));
    roots.push(cwd);
    execFileSync("git", ["init", "--quiet", "--initial-branch=fixture"], {
      cwd,
    });
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, ".gitignore"), "dist/\n");
    writeFileSync(
      join(cwd, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { ".hidden/*": ["di*"] },
        },
      }),
    );
    writeFileSync(join(cwd, "src/main.ts"), 'import ".hidden/st/input";\n');
    execFileSync("git", ["add", "."], { cwd });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Input Policy Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ],
      { cwd },
    );
    mkdirSync(join(cwd, "dist"), { recursive: true });
    const target = join(cwd, "dist/input.ts");
    writeFileSync(target, "export default 1;\n");
    const parsedText = ts.readConfigFile(
      join(cwd, "tsconfig.json"),
      ts.sys.readFile,
    );
    expect(parsedText.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(
      parsedText.config,
      ts.sys,
      cwd,
    );
    expect(parsed.errors).toEqual([]);
    expect(
      ts.resolveModuleName(
        ".hidden/st/input",
        join(cwd, "src/main.ts"),
        parsed.options,
        ts.sys,
      ).resolvedModule?.resolvedFileName,
    ).toBe(target);
    expect(ts.isExternalModuleNameRelative(".hidden/st/input")).toBe(false);
    expect(() => collectInputFingerprint({ cwd })).toThrow(
      /Excluded output|Output-only/,
    );
    let calls = 0;
    const forbidden = async () => {
      calls++;
      throw new Error("scanner must not execute");
    };
    await expect(
      runSecurityCheck({ cwd, execute: forbidden, useTool: forbidden }),
    ).rejects.toThrow(/Excluded output|Output-only/);
    expect(calls).toBe(0);
  });

  it("preserves relative modules and source aliases beside dot-prefixed aliases", () => {
    const cwd = mkdtempSync(join(tmpdir(), "wanderer-dot-alias-positive-"));
    roots.push(cwd);
    execFileSync("git", ["init", "--quiet", "--initial-branch=fixture"], {
      cwd,
    });
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(
      join(cwd, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            ".hidden/*": ["di*"],
            "@source/*": ["src/*"],
          },
        },
      }),
    );
    writeFileSync(
      join(cwd, "src/main.ts"),
      'import "./relative"; import "@source/input";\n',
    );
    writeFileSync(join(cwd, "src/relative.ts"), "export default 1;\n");
    writeFileSync(join(cwd, "src/input.ts"), "export default 2;\n");
    execFileSync("git", ["add", "."], { cwd });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Input Policy Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ],
      { cwd },
    );
    expect(ts.isExternalModuleNameRelative("./relative")).toBe(true);
    expect(collectInputFingerprint({ cwd }).digest).toMatch(/^sha256:/);
  });

  it.each(outputRoots)(
    "rejects wildcard alias substitution into %s before scanning",
    async (root: string) => {
      const cwd = mkdtempSync(join(tmpdir(), "wanderer-wildcard-alias-"));
      roots.push(cwd);
      execFileSync("git", ["init", "--quiet", "--initial-branch=fixture"], {
        cwd,
      });
      mkdirSync(join(cwd, "src"), { recursive: true });
      writeFileSync(join(cwd, ".gitignore"), root + "/\n");
      writeFileSync(
        join(cwd, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: { "hidden/*": ["*"] },
          },
        }),
      );
      mkdirSync(join(cwd, root), { recursive: true });
      const target = join(cwd, root, "input.ts");
      writeFileSync(target, "export default 2;\n");
      writeFileSync(
        join(cwd, "src/main.ts"),
        `import "hidden/${root}/input";\n`,
      );
      execFileSync("git", ["add", "."], { cwd });
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Input Policy Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit",
          "--quiet",
          "-m",
          "fixture",
        ],
        { cwd },
      );
      const parsedText = ts.readConfigFile(
        join(cwd, "tsconfig.json"),
        ts.sys.readFile,
      );
      expect(parsedText.error).toBeUndefined();
      const parsed = ts.parseJsonConfigFileContent(
        parsedText.config,
        ts.sys,
        cwd,
      );
      expect(parsed.errors).toEqual([]);
      expect(
        ts.resolveModuleName(
          `hidden/${root}/input`,
          join(cwd, "src/main.ts"),
          parsed.options,
          ts.sys,
        ).resolvedModule?.resolvedFileName,
      ).toBe(target);
      expect(() => collectInputFingerprint({ cwd })).toThrow(
        /Excluded output|Output-only/,
      );
      let calls = 0;
      const forbidden = async () => {
        calls++;
        throw new Error("scanner must not execute");
      };
      await expect(
        runSecurityCheck({ cwd, execute: forbidden, useTool: forbidden }),
      ).rejects.toThrow(/Excluded output|Output-only/);
      expect(calls).toBe(0);
    },
  );

  it.each([
    [
      "prefix completion",
      { importPath: "hidden/st/input", paths: { "hidden/*": ["di*"] } },
      "dist/input.ts",
    ],
    [
      "traversal capture",
      { importPath: "hidden/../dist/input", paths: { "hidden/*": ["src/*"] } },
      "dist/input.ts",
    ],
    [
      "dependency cache capture",
      {
        importPath: "pkg/.vite/input",
        paths: { "pkg/*": ["node_modules/*"] },
      },
      "node_modules/.vite/input.ts",
    ],
  ])(
    "rejects wildcard alias %s after actual substitution before scanning",
    async (_name, mapping, targetPath) => {
      const cwd = mkdtempSync(join(tmpdir(), "wanderer-wildcard-alias-"));
      roots.push(cwd);
      execFileSync("git", ["init", "--quiet", "--initial-branch=fixture"], {
        cwd,
      });
      mkdirSync(join(cwd, "src"), { recursive: true });
      writeFileSync(
        join(cwd, ".gitignore"),
        OUTPUT_ONLY_ROOTS.map((root: string) => root + "/").join("\n") + "\n",
      );
      writeFileSync(
        join(cwd, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: mapping.paths,
          },
        }),
      );
      writeFileSync(
        join(cwd, "src/main.ts"),
        `import ${JSON.stringify(mapping.importPath)};\n`,
      );
      execFileSync("git", ["add", "."], { cwd });
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Input Policy Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit",
          "--quiet",
          "-m",
          "fixture",
        ],
        { cwd },
      );
      mkdirSync(join(cwd, targetPath, ".."), { recursive: true });
      writeFileSync(join(cwd, targetPath), "export default 1;\n");
      const parsedText = ts.readConfigFile(
        join(cwd, "tsconfig.json"),
        ts.sys.readFile,
      );
      expect(parsedText.error).toBeUndefined();
      const parsed = ts.parseJsonConfigFileContent(
        parsedText.config,
        ts.sys,
        cwd,
      );
      expect(parsed.errors).toEqual([]);
      expect(
        ts.resolveModuleName(
          mapping.importPath,
          join(cwd, "src/main.ts"),
          parsed.options,
          ts.sys,
        ).resolvedModule?.resolvedFileName,
      ).toBe(join(cwd, targetPath));
      expect(() => collectInputFingerprint({ cwd })).toThrow(
        /Excluded output|Output-only/,
      );
      let calls = 0;
      const forbidden = async () => {
        calls++;
        throw new Error("scanner must not execute");
      };
      await expect(
        runSecurityCheck({ cwd, execute: forbidden, useTool: forbidden }),
      ).rejects.toThrow(/Excluded output|Output-only/);
      expect(calls).toBe(0);
    },
  );

  it.each([
    ["import type node", `type Hidden = import("hidden/st/input").Hidden;\n`],
    ["import equals", `import hidden = require("hidden/st/input"); hidden;\n`],
    ["dynamic import options", `await import("hidden/st/input", {});\n`],
  ])(
    "rejects wildcard alias substitution from %s before scanning",
    async (_name, sourceText) => {
      const cwd = mkdtempSync(join(tmpdir(), "wanderer-wildcard-syntax-"));
      roots.push(cwd);
      execFileSync("git", ["init", "--quiet", "--initial-branch=fixture"], {
        cwd,
      });
      mkdirSync(join(cwd, "src"), { recursive: true });
      mkdirSync(join(cwd, "dist"), { recursive: true });
      writeFileSync(join(cwd, ".gitignore"), "dist/\n");
      writeFileSync(
        join(cwd, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "hidden/*": ["di*"] } },
        }),
      );
      writeFileSync(join(cwd, "src/main.ts"), sourceText);
      execFileSync("git", ["add", "."], { cwd });
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Input Policy Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit",
          "--quiet",
          "-m",
          "fixture",
        ],
        { cwd },
      );
      const target = join(cwd, "dist/input.ts");
      writeFileSync(target, "export interface Hidden { value: string }\n");
      const parsedText = ts.readConfigFile(
        join(cwd, "tsconfig.json"),
        ts.sys.readFile,
      );
      expect(parsedText.error).toBeUndefined();
      const parsed = ts.parseJsonConfigFileContent(
        parsedText.config,
        ts.sys,
        cwd,
      );
      expect(parsed.errors).toEqual([]);
      expect(
        ts.resolveModuleName(
          "hidden/st/input",
          join(cwd, "src/main.ts"),
          parsed.options,
          ts.sys,
        ).resolvedModule?.resolvedFileName,
      ).toBe(target);
      expect(() => collectInputFingerprint({ cwd })).toThrow(
        /Excluded output|Output-only/,
      );
      let calls = 0;
      const forbidden = async () => {
        calls++;
        throw new Error("scanner must not execute");
      };
      await expect(
        runSecurityCheck({ cwd, execute: forbidden, useTool: forbidden }),
      ).rejects.toThrow(/Excluded output|Output-only/);
      expect(calls).toBe(0);
    },
  );

  it("does not use an inherited config reached through a tracked symlink", () => {
    const cwd = inheritedRepository("app/input.ts");
    symlinkSync("base.json", join(cwd, "configs/link.json"));
    execFileSync("git", ["add", "configs/link.json"], { cwd });
    writeFileSync(
      join(cwd, "configs/nested/tsconfig.json"),
      JSON.stringify({ extends: "../link.json" }),
    );
    expect(() => collectInputFingerprint({ cwd })).toThrow(
      /unsupported compiler configuration/,
    );
  });
});

describe("shared output-only input policy", () => {
  it.each(outputRoots)(
    "uses exactly the same source/scanner exclusion for %s",
    (root: string) => {
      expect(isOutputOnlyPath(root)).toBe(true);
      expect(isSourceSnapshotExcludedPath(root + "/generated.js")).toBe(true);
      expect(isOutputOnlyPath(root + "-source/generated.js")).toBe(false);
      expect(isSourceSnapshotExcludedPath("src/" + root + "/source.js")).toBe(
        false,
      );
    },
  );
  it("keeps dependency inputs inventoried separately from only their output cache", () => {
    expect(isSourceSnapshotExcludedPath("node_modules/package/index.js")).toBe(
      true,
    );
    expect(isOutputOnlyPath("node_modules/package/index.js")).toBe(false);
    expect(isDependencyOutputPath("package/index.js")).toBe(false);
    expect(isDependencyOutputPath(".vite/result.js")).toBe(true);
    expect(isDependencyOutputPath(".vite-source/input.js")).toBe(false);
  });
  for (const root of OUTPUT_ONLY_ROOTS) {
    it.each([
      ["import", `import "./${root}/input.mjs";`],
      ["reexport", `export * from "./${root}/input.mjs";`],
      ["require", `const input = require("./${root}/input.cjs");`],
      [
        "dynamic constant",
        `const root = "./${root}/"; const path = root + "input.mjs"; await import(path);`,
      ],
      ["resolve", `import.meta.resolve("./${root}/input.mjs");`],
      ["URL", `new URL("./${root}/input.wasm", import.meta.url);`],
    ])(`rejects ${root} via %s in any source helper`, (_name, content) => {
      expect(() => assertInputReferences("build-helper.mjs", content)).toThrow(
        /Excluded output/,
      );
    });
    it.each([
      ["extends", { extends: `./${root}/tsconfig.json` }],
      ["files", { files: [`./${root}/input.ts`] }],
      ["include", { include: [`./${root}/**/*.ts`] }],
      ["references", { references: [{ path: `./${root}` }] }],
      ["baseUrl", { compilerOptions: { baseUrl: `./${root}` } }],
      [
        "paths",
        { compilerOptions: { paths: { hidden: [`./${root}/input.ts`] } } },
      ],
      ["rootDirs", { compilerOptions: { rootDirs: ["./src", `./${root}`] } }],
      ["typeRoots", { compilerOptions: { typeRoots: [`./${root}`] } }],
    ])(`rejects ${root} compiler input %s`, (_name, value) => {
      expect(() =>
        assertInputReferences("tsconfig.json", JSON.stringify(value)),
      ).toThrow(/Excluded output/);
    });
    it.each([
      ["script", `<script type="module" src="./${root}/input.js"></script>`],
      [
        "inline module",
        `<script type="module">import "./${root}/input.js";</script>`,
      ],
      ["stylesheet", `<link rel="stylesheet" href="./${root}/input.css">`],
      ["srcset", `<img srcset="./${root}/input.png 1x">`],
      ["CSS import", `@import "./${root}/input.css";`],
      ["CSS URL", `body { background: url("./${root}/input.png"); }`],
    ])(`rejects ${root} HTML/CSS %s`, (name, text) => {
      expect(() =>
        assertInputReferences(
          name.startsWith("CSS") ? "main.css" : "index.html",
          text,
        ),
      ).toThrow(/Excluded output/);
    });
  }
  it.each([
    ["encoded", 'import "./%2evite/input.js";'],
    ["normalised", 'import "./safe/../.vite/input.js";'],
    ["query", 'import "./.vite/input.js?raw";'],
    ["base-token", 'import "%BASE_URL%.vite/input.js";'],
    ["unresolved dynamic host", "await import(process.env.INPUT);"],
    ["package script", '{"scripts":{"build":"node .vite/build.mjs"}}'],
    [
      "config alias",
      'export default { resolve: { alias: { hidden: "./.vite/input.js" } } };',
    ],
  ])("rejects %s input bypass", (name, text) => {
    expect(() =>
      assertInputReferences(
        name === "package script" ? "package.json" : "vite.config.ts",
        text,
      ),
    ).toThrow(/Excluded output/);
  });
  it.each([
    ["helper.mjs", 'const path = "./src/input.mjs"; await import(path);'],
    [
      "vite.config.ts",
      'export default { build: { outDir: "dist" }, cacheDir: "node_modules/.vite" };',
    ],
    [
      "tsconfig.json",
      '{"include":["src"],"exclude":["dist"],"compilerOptions":{"outDir":"dist"}}',
    ],
    ["index.html", '<script type="module" src="/src/main.ts"></script>'],
    ["index.html", '<link rel="icon" href="%BASE_URL%favicon.svg">'],
    ["style.css", 'body { background: url("./assets/input.png"); }'],
    [
      "src/tests/browser/sample.spec.ts",
      'await page.evaluate(async ({url}) => await import(url), {url: "/source.js"});',
    ],
  ])(
    "preserves reviewed source/output-only configuration in %s",
    (file, text) => {
      expect(() => assertInputReferences(file, text)).not.toThrow();
    },
  );

  it.each(outputRoots)(
    "rejects an alias from baseUrl=src into %s",
    (root: string) => {
      expect(() =>
        assertInputReferences(
          "tsconfig.json",
          JSON.stringify({
            compilerOptions: {
              baseUrl: "src",
              paths: { hidden: [`../${root}/input.ts`] },
            },
          }),
        ),
      ).toThrow(/Excluded output/);
    },
  );

  it.each(outputRoots)(
    "uses TypeScript inheritance and effective overridden baseUrl for %s",
    (root: string) => {
      const configs = {
        "configs/base.json": JSON.stringify({
          compilerOptions: {
            baseUrl: "src",
            paths: { hidden: [`../${root}/input.ts`] },
          },
        }),
      };
      expect(() =>
        assertInputReferences(
          "configs/nested/tsconfig.json",
          JSON.stringify({
            extends: "../base.json",
            compilerOptions: { baseUrl: "../../src" },
          }),
          {
            readConfig: (path: string) => configs[path as keyof typeof configs],
          },
        ),
      ).toThrow(/Excluded output/);
    },
  );

  it("permits a nested inherited alias that resolves inside source", () => {
    const configs = {
      "configs/base.json": JSON.stringify({
        compilerOptions: {
          baseUrl: "../src",
          paths: { "@app/*": ["app/*"] },
        },
      }),
    };
    expect(() =>
      assertInputReferences(
        "configs/nested/tsconfig.json",
        JSON.stringify({ extends: "../base.json" }),
        { readConfig: (path: string) => configs[path as keyof typeof configs] },
      ),
    ).not.toThrow();
  });

  it("rejects inheritance without a controlled reader", () => {
    expect(() =>
      assertInputReferences(
        "nested/tsconfig.json",
        JSON.stringify({ extends: "../base.json" }),
      ),
    ).toThrow(/unsupported compiler configuration/);
  });

  it("does not ask the configured reader for an external inherited config", () => {
    const reads: string[] = [];
    expect(() =>
      assertInputReferences(
        "nested/tsconfig.json",
        JSON.stringify({ extends: "../../outside.json" }),
        {
          readConfig: (path: string) => {
            reads.push(path);
            return undefined;
          },
        },
      ),
    ).toThrow(/unsupported compiler configuration/);
    expect(reads).toEqual([]);
  });
});

describe("scanner refuses excluded build-input references before scanner execution", () => {
  it.each(outputRoots)(
    "rejects a TypeScript alias into %s before fingerprint or scanner execution",
    async (root: string) => {
      const cwd = mkdtempSync(join(tmpdir(), "wanderer-alias-scan-"));
      roots.push(cwd);
      execFileSync("git", ["init", "--quiet", "--initial-branch=fixture"], {
        cwd,
      });
      mkdirSync(join(cwd, "src"), { recursive: true });
      writeFileSync(join(cwd, ".gitignore"), root + "/\n");
      writeFileSync(
        join(cwd, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            baseUrl: "src",
            paths: { hidden: [`../${root}/input.ts`] },
          },
        }),
      );
      writeFileSync(join(cwd, "src", "main.ts"), 'import "hidden";\n');
      execFileSync("git", ["add", "."], { cwd });
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Input Policy Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit",
          "--quiet",
          "-m",
          "fixture",
        ],
        { cwd },
      );
      mkdirSync(join(cwd, root), { recursive: true });
      writeFileSync(join(cwd, root, "input.ts"), "export default 1;\n");
      let calls = 0;
      const forbidden = async () => {
        calls++;
        throw new Error("scanner must not execute");
      };
      await expect(
        runSecurityCheck({ cwd, execute: forbidden, toolLoader: forbidden }),
      ).rejects.toThrow(/Excluded output|Output-only/);
      expect(calls).toBe(0);
    },
  );

  it.each(outputRoots)(
    "fails closed for indirect imports from %s",
    async (root: string) => {
      const cwd = mkdtempSync(join(tmpdir(), "wanderer-input-scan-"));
      roots.push(cwd);
      execFileSync("git", ["init", "--quiet", "--initial-branch=fixture"], {
        cwd,
      });
      writeFileSync(
        join(cwd, ".gitignore"),
        ".agent/\nnode_modules/\n" + root + "/\n",
      );
      writeFileSync(
        join(cwd, "vite.config.ts"),
        'import "./helper.mjs"; export default {};\n',
      );
      writeFileSync(join(cwd, "helper.mjs"), `import "./${root}/input.mjs";\n`);
      execFileSync("git", ["add", "."], { cwd });
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Input Policy Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit",
          "--quiet",
          "-m",
          "fixture",
        ],
        { cwd },
      );
      mkdirSync(join(cwd, root), { recursive: true });
      writeFileSync(join(cwd, root, "input.mjs"), "export default 1;\n");
      let calls = 0;
      const forbidden = async () => {
        calls++;
        throw new Error("scanner must not execute");
      };
      await expect(
        runSecurityCheck({ cwd, execute: forbidden, toolLoader: forbidden }),
      ).rejects.toThrow(/Excluded output|Output-only/);
      expect(calls).toBe(0);
    },
  );
});
