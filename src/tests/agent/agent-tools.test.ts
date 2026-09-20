import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error Command modules intentionally remain repository-native Node ESM without TS declarations.
import * as checks from "../../../scripts/agent/checks.mjs";
// @ts-expect-error Command modules intentionally remain repository-native Node ESM without TS declarations.
import * as common from "../../../scripts/agent/common.mjs";
// @ts-expect-error Command modules intentionally remain repository-native Node ESM without TS declarations.
import { evaluateMissionStart } from "../../../scripts/agent/mission-start.mjs";
// @ts-expect-error Command modules intentionally remain repository-native Node ESM without TS declarations.
import { runCommand } from "../../../scripts/agent/run.mjs";
// @ts-expect-error Command modules intentionally remain repository-native Node ESM without TS declarations.
import { inspectDoctor } from "../../../scripts/agent/doctor.mjs";
// @ts-expect-error Command modules intentionally remain repository-native Node ESM without TS declarations.
import { validateRecordedRuns } from "../../../scripts/agent/finish.mjs";
// @ts-expect-error Command modules intentionally remain repository-native Node ESM without TS declarations.
import * as format from "../../../scripts/agent/format.mjs";

const { classifyChangedPath, selectFocusedChecks } = checks;
const { changedFilesSince, collectInputFingerprint } = common;
const { selectTrackedFormattingFiles, runFormat } = format;

const temporaryDirectories: string[] = [];

const temporaryMission = () => {
  const cwd = mkdtempSync(join(tmpdir(), "wanderer-agent-test-"));
  temporaryDirectories.push(cwd);
  writeFileSync(join(cwd, "tracked.txt"), "baseline\n");
  execFileSync("git", ["init", "--quiet"], { cwd });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Wanderer Agent Test",
      "-c",
      "user.email=wanderer-agent-test@example.invalid",
      "add",
      "tracked.txt",
    ],
    { cwd },
  );
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Wanderer Agent Test",
      "-c",
      "user.email=wanderer-agent-test@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "baseline",
    ],
    { cwd },
  );
  mkdirSync(join(cwd, ".agent"), { recursive: true });
  writeFileSync(
    join(cwd, ".agent", "mission.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      missionId: "agent-test",
      baselineCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd,
        encoding: "utf8",
      }).trim(),
      repository: common.repositoryIdentity(cwd),
      requestedObjective: "test agent runtime",
      runs: [],
      lastFailureSignature: null,
      repeatedFailureCount: 0,
      lastFailureCommand: null,
      policyVersion: "wanderer-agent-v2",
      compatibilityFixtureHashes: { saves: {}, world: {} },
    })}\n`,
  );
  return cwd;
};

const temporaryGitRepository = () => {
  const cwd = temporaryMission();
  mkdirSync(join(cwd, "scripts", "agent"), { recursive: true });
  writeFileSync(
    join(cwd, "scripts", "agent", "tracked-tool.mjs"),
    "export const tracked = true;\n",
  );
  execFileSync("git", ["init", "--quiet"], { cwd });
  execFileSync("git", ["add", "scripts/agent/tracked-tool.mjs"], { cwd });
  return cwd;
};

const temporaryCommittedSessionRepository = () => {
  const cwd = temporaryMission();
  mkdirSync(join(cwd, "src", "domain"), { recursive: true });
  writeFileSync(
    join(cwd, "src", "domain", "session-movement.ts"),
    "export const movement = 0;\n",
  );
  execFileSync("git", ["init", "--quiet"], { cwd });
  execFileSync("git", ["config", "core.excludesFile", "/dev/null"], {
    cwd,
  });
  execFileSync("git", ["add", "src/domain/session-movement.ts"], { cwd });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Wanderer Agent Test",
      "-c",
      "user.email=wanderer-agent-test@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "baseline",
    ],
    { cwd },
  );
  const baselineCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
  }).trim();

  return { cwd, baselineCommit };
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

const commandIds = (paths: string[]) =>
  selectFocusedChecks(paths).commands.map(
    (selected: { id: string }) => selected.id,
  );

describe("changed-file check selection", () => {
  it("keeps documentation-only changes out of browser and build checks", () => {
    const selection = selectFocusedChecks(["Documentation~/agent-workflow.md"]);

    expect(selection.mode).toBe("focused");
    expect(commandIds(["Documentation~/agent-workflow.md"])).toEqual([
      "git-diff-check",
      "format-changed",
    ]);
    expect(selection.commandTexts.join("\n")).not.toContain("test:browser");
    expect(selection.commandTexts.join("\n")).not.toContain("npm run build");
  });

  it("routes save changes to the save test suite", () => {
    expect(
      commandIds(["src/platform/storage/browserSaveStorage.ts"]),
    ).toContain("save-tests");
  });

  it("classifies session-prefixed split-suite helpers as session changes", () => {
    expect(
      classifyChangedPath("src/tests/domain/session-test-helpers.ts"),
    ).toBe("session");
  });

  it("routes split session suites to focused session tests", () => {
    const selection = selectFocusedChecks([
      "src/tests/domain/session-movement.test.ts",
    ]);

    expect(selection.mode).toBe("focused");
    expect(selection.classifications[0]).toMatchObject({
      path: "src/tests/domain/session-movement.test.ts",
      category: "session",
      impacts: ["session"],
      status: "modified",
    });
    expect(commandIds(["src/tests/domain/session-movement.test.ts"])).toContain(
      "session-tests",
    );
    expect(
      selection.commands.find(
        (selected: { id: string }) => selected.id === "session-tests",
      )?.command,
    ).toEqual(["npm", "run", "test", "--", "src/tests/domain/session-"]);
    expect(selection.commandTexts.join("\n")).not.toContain("npm run verify");
    expect(selection.commandTexts.join("\n")).not.toContain(
      "npm run test:browser",
    );
  });

  it("routes renderer changes to a built-output browser check", () => {
    const selection = selectFocusedChecks([
      "src/platform/rendering/threeRenderer.ts",
    ]);

    expect(commandIds(["src/platform/rendering/threeRenderer.ts"])).toContain(
      "browser",
    );
    expect(selection.commandTexts.join("\n")).toContain("npm run test:browser");
  });

  it("forces full mode for package and workflow changes", () => {
    expect(selectFocusedChecks(["package.json"]).mode).toBe("full");
    expect(selectFocusedChecks([".github/workflows/ci.yml"]).mode).toBe("full");
  });

  it("runs changed tests themselves and maps saveProjection to save plus session", () => {
    const changedTest = "src/tests/app/simulationSpeed.test.ts";
    const selection = selectFocusedChecks([
      changedTest,
      "src/domain/session/saveProjection.ts",
    ]);

    expect(selection.mode).toBe("focused");
    expect(
      selection.commands.find(
        (selected: { id: string }) => selected.id === "changed-tests",
      )?.command,
    ).toContain(changedTest);
    expect(selection.classifications[1].impacts).toEqual(
      expect.arrayContaining(["save", "session"]),
    );
    expect(
      commandIds([changedTest, "src/domain/session/saveProjection.ts"]),
    ).toContain("save-tests");
  });

  it("keeps renamed tests executable and escalates deleted tests to their owner suite", () => {
    const renamed = selectFocusedChecks([
      {
        status: "renamed",
        path: "src/tests/app/simulationSpeed.test.ts",
        previousPath: "src/tests/app/old-speed.test.ts",
      },
    ] as never);
    expect(
      renamed.commands.find(
        (entry: { id: string }) => entry.id === "changed-tests",
      )?.command,
    ).toContain("src/tests/app/simulationSpeed.test.ts");

    const deleted = selectFocusedChecks([
      { status: "deleted", path: "src/tests/domain/removed.test.ts" },
    ] as never);
    expect(deleted.mode).toBe("full");
  });

  it("excludes runtime paths from a tracked session selection", () => {
    const { cwd, baselineCommit } = temporaryCommittedSessionRepository();
    writeFileSync(
      join(cwd, "src", "domain", "session-movement.ts"),
      "export const movement = 1;\n",
    );
    const dependencyDirectory = mkdtempSync(
      join(tmpdir(), "wanderer-agent-dependency-"),
    );
    temporaryDirectories.push(dependencyDirectory);
    symlinkSync(dependencyDirectory, join(cwd, "node_modules"), "dir");

    const untrackedPaths = execFileSync(
      "git",
      ["ls-files", "--others", "--exclude-standard", "-z"],
      { cwd, encoding: "utf8" },
    )
      .split("\0")
      .filter(Boolean);
    expect(untrackedPaths).toEqual(
      expect.arrayContaining([".agent/mission.json", "node_modules"]),
    );

    const changedFiles = changedFilesSince(cwd, baselineCommit);
    const selection = selectFocusedChecks(changedFiles, { baselineCommit });

    expect(changedFiles).toEqual(["src/domain/session-movement.ts"]);
    expect(selection.mode).toBe("focused");
    expect(commandIds(changedFiles)).toContain("session-tests");
    expect(selection.commandTexts.join("\n")).not.toContain("npm run verify");
    expect(selection.commandTexts.join("\n")).not.toContain(
      "npm run test:browser",
    );
  });

  it("retains ordinary untracked source paths in changed-file selection", () => {
    const { cwd, baselineCommit } = temporaryCommittedSessionRepository();
    writeFileSync(
      join(cwd, "src", "domain", "untracked-source.ts"),
      "export const untracked = true;\n",
    );

    const changedFiles = changedFilesSince(cwd, baselineCommit);

    expect(changedFiles).toContain("src/domain/untracked-source.ts");
    expect(selectFocusedChecks(changedFiles).mode).toBe("full");
  });

  it("selects tracked and new repository-contained source while preserving approved specifications", () => {
    const cwd = temporaryGitRepository();
    writeFileSync(
      join(cwd, "scripts", "agent", "new-tool.mjs"),
      "export const tool = true;\n",
    );
    writeFileSync(join(cwd, "FRANK_USER_SPEC.md"), "preserve me\n");

    expect(
      selectTrackedFormattingFiles(cwd, [
        "scripts/agent/tracked-tool.mjs",
        "scripts/agent/new-tool.mjs",
        "FRANK_USER_SPEC.md",
      ]),
    ).toEqual(["scripts/agent/new-tool.mjs", "scripts/agent/tracked-tool.mjs"]);
    expect(() =>
      selectTrackedFormattingFiles(cwd, [
        "scripts/agent/../../../../outside.mjs",
      ]),
    ).toThrow("Output paths must stay inside the repository.");
  });
});

describe("formatter content proof", () => {
  it("rejects an exit-zero writer that leaves new source unformatted", async () => {
    const cwd = temporaryGitRepository();
    const file = "scripts/agent/new-tool.mjs";
    writeFileSync(join(cwd, file), "export const value={a:1}\n");
    mkdirSync(join(cwd, "node_modules/prettier/bin"), { recursive: true });
    writeFileSync(join(cwd, "node_modules/prettier/bin/prettier.cjs"), "");
    await expect(
      runFormat({
        cwd,
        action: "--write",
        files: [file],
        execute: () => ({ status: 0 }),
      }),
    ).rejects.toThrow("did not produce formatted bytes");
  });
  it("preserves generated lockfiles, excluded specifications and source symlink boundaries", () => {
    const cwd = temporaryGitRepository();
    writeFileSync(join(cwd, "package-lock.json"), '{"generated":true}\n');
    symlinkSync("tracked-tool.mjs", join(cwd, "scripts/agent/linked.mjs"));
    expect(selectTrackedFormattingFiles(cwd, ["package-lock.json"])).toEqual(
      [],
    );
    expect(() =>
      selectTrackedFormattingFiles(cwd, ["scripts/agent/linked.mjs"]),
    ).toThrow("Symlink");
  });
});

describe("agent command execution safeguards", () => {
  it("reports timeout as a failure", async () => {
    const cwd = temporaryMission();

    const result = await runCommand({
      cwd,
      command: [process.execPath, "-e", "setTimeout(() => {}, 500)"],
      timeoutMs: 25,
    });

    expect(result.status).toBe("timed-out");
    expect(result.timedOut).toBe(true);
    expect(
      JSON.parse(readFileSync(join(cwd, ".agent", "mission.json"), "utf8"))
        .repeatedFailureCount,
    ).toBe(1);
  });

  it("invalidates a zero-exit command when a tracked input changes during execution", async () => {
    const cwd = temporaryMission();
    const result = await runCommand({
      cwd,
      command: [
        process.execPath,
        "-e",
        "require('fs').writeFileSync('tracked.txt', 'changed during run\\n')",
      ],
      timeoutMs: 1_000,
    });

    expect(result.status).toBe("invalidated");
    expect(result.inputBefore.digest).not.toBe(result.inputAfter.digest);
  });

  it("refuses a third materially identical failure without a diagnosis", async () => {
    const cwd = temporaryMission();
    const command = [
      process.execPath,
      "-e",
      "console.error('same failure'); process.exit(2)",
    ];

    expect((await runCommand({ cwd, command, timeoutMs: 1_000 })).status).toBe(
      "failed",
    );
    expect((await runCommand({ cwd, command, timeoutMs: 1_000 })).status).toBe(
      "failed",
    );
    const refused = await runCommand({ cwd, command, timeoutMs: 1_000 });

    expect(refused.refused).toBe(true);
    expect(refused.failureKind).toBe("repeat-refused");
  });
});

describe("input fingerprint and completion safeguards", () => {
  it("detects working, staged, mode, symlink, and untracked input changes", () => {
    const cwd = temporaryMission();
    const baseline = collectInputFingerprint({ cwd });
    writeFileSync(join(cwd, "tracked.txt"), "working change\n");
    const working = collectInputFingerprint({ cwd });
    expect(working.digest).not.toBe(baseline.digest);
    execFileSync("git", ["add", "tracked.txt"], { cwd });
    const staged = collectInputFingerprint({ cwd });
    expect(staged.digest).not.toBe(working.digest);
    chmodSync(join(cwd, "tracked.txt"), 0o755);
    expect(collectInputFingerprint({ cwd }).digest).not.toBe(staged.digest);
    writeFileSync(join(cwd, "untracked.txt"), "input\n");
    expect(
      collectInputFingerprint({ cwd }).untracked.map(
        (entry: { path: string }) => entry.path,
      ),
    ).toContain("untracked.txt");
    rmSync(join(cwd, "tracked.txt"));
    symlinkSync("untracked.txt", join(cwd, "tracked.txt"));
    expect(collectInputFingerprint({ cwd }).digest).not.toBe(staged.digest);
  });

  it("rejects ignored build inputs and output-only executable bypasses", () => {
    const cwd = temporaryMission();
    writeFileSync(join(cwd, ".gitignore"), ".env*\nignored-assets/\n");
    execFileSync("git", ["add", ".gitignore"], { cwd });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Wanderer Agent Test",
        "-c",
        "user.email=wanderer-agent-test@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "ignore inputs",
      ],
      { cwd },
    );
    writeFileSync(join(cwd, ".env.local"), "not printed\n");
    expect(() => collectInputFingerprint({ cwd })).toThrow(
      "Ignored input .env.local",
    );
    rmSync(join(cwd, ".env.local"));
    mkdirSync(join(cwd, ".agent"), { recursive: true });
    writeFileSync(join(cwd, ".agent", "evil.mjs"), "export default 1;\n");
    expect(() => collectInputFingerprint({ cwd })).toThrow("Output-only path");
  });

  it.each([
    ".agent",
    ".vite",
    "dist",
    "test-results",
    "playwright-report",
    "node_modules/.vite",
  ])("rejects a configuration import from excluded output %s", (root) => {
    const cwd = temporaryMission();
    mkdirSync(join(cwd, root), { recursive: true });
    writeFileSync(join(cwd, root, "build-input.mjs"), "export default 1;\n");
    writeFileSync(join(cwd, ".gitignore"), `${root}/\n`);
    writeFileSync(
      join(cwd, "vite.config.ts"),
      `import ${JSON.stringify(`./${root}/build-input.mjs`)};\nexport default {};\n`,
    );
    execFileSync("git", ["add", ".gitignore", "vite.config.ts"], { cwd });
    expect(() => collectInputFingerprint({ cwd })).toThrow(
      /Output-only|Excluded output/,
    );
  });

  it.each([
    ".vite",
    "dist",
    "test-results",
    "playwright-report",
    "node_modules/.vite",
  ])("rejects an indirect build import from excluded output %s", (root) => {
    const cwd = temporaryMission();
    mkdirSync(join(cwd, root), { recursive: true });
    writeFileSync(join(cwd, root, "build-input.mjs"), "export default 1;\n");
    writeFileSync(join(cwd, ".gitignore"), `${root}/\n`);
    writeFileSync(
      join(cwd, "vite.config.ts"),
      'import "./build-helper.mjs";\nexport default {};\n',
    );
    writeFileSync(
      join(cwd, "build-helper.mjs"),
      `import ${JSON.stringify(`./${root}/build-input.mjs`)};\n`,
    );
    execFileSync(
      "git",
      ["add", ".gitignore", "vite.config.ts", "build-helper.mjs"],
      { cwd },
    );
    expect(() => collectInputFingerprint({ cwd })).toThrow(
      /Output-only|Excluded output/,
    );
  });

  it.each([
    ".vite",
    "dist",
    "test-results",
    "playwright-report",
    "node_modules/.vite",
  ])("rejects HTML and CSS references into excluded output %s", (root) => {
    const cwd = temporaryMission();
    writeFileSync(
      join(cwd, "index.html"),
      `<script type="module" src="./${root}/build-input.mjs"></script>`,
    );
    expect(() => collectInputFingerprint({ cwd })).toThrow(
      /Output-only|Excluded output/,
    );
    writeFileSync(join(cwd, "index.html"), "<main>local source</main>");
    writeFileSync(
      join(cwd, "style.css"),
      `@import url("./${root}/build-input.css");`,
    );
    expect(() => collectInputFingerprint({ cwd })).toThrow(
      /Output-only|Excluded output/,
    );
  });

  it("keeps unreferenced generated output evidence fingerprint-stable", () => {
    const cwd = temporaryMission();
    const before = collectInputFingerprint({ cwd });
    mkdirSync(join(cwd, "dist"), { recursive: true });
    writeFileSync(
      join(cwd, "dist", "index.js"),
      "export const generated = 1;\n",
    );
    writeFileSync(
      join(cwd, ".agent", "result.json"),
      '{"status":"diagnostic"}\n',
    );
    expect(collectInputFingerprint({ cwd }).digest).toBe(before.digest);
  });

  it("reports blocked doctor prerequisites without treating them as code failures", async () => {
    const cwd = temporaryMission();
    const result = await inspectDoctor({
      cwd,
      probeBrowser: async () => ({
        available: false,
        detail: "browser absent",
      }),
    });
    expect(result.status).toBe("blocked");
    expect(
      result.checks.find((entry: { id: string }) => entry.id === "browser")
        ?.status,
    ).toBe("blocked");
  });

  it("refuses arbitrary or historical completion records", () => {
    const cwd = temporaryMission();
    const fingerprint = collectInputFingerprint({ cwd });
    expect(() =>
      validateRecordedRuns({
        cwd,
        fingerprint,
        commands: ["npm run verify"],
      }),
    ).toThrow("Missing required final command");
  });
});

describe("mission initialization", () => {
  it("permits an approved untracked FRANK specification while preserving tracked cleanliness", () => {
    const state = evaluateMissionStart({
      missionId: "m1",
      requestedObjective: "exercise mission state",
      branch: "feature/m1",
      baselineCommit: "337994caccb3ff322cde883671846b40d5f91737",
      currentCommit: "337994caccb3ff322cde883671846b40d5f91737",
      baselineIsDescendant: true,
      nodeVersion: "v22.23.2",
      npmVersion: "10.9.2",
      worktree: {
        state: "dirty",
        trackedState: "clean",
        entries: [
          {
            status: "??",
            path: "FRANK_WANDERER_REMAINING_HARDENING_AND_EFFICIENCY.md",
          },
        ],
        trackedChanges: [],
        untrackedFiles: [
          "FRANK_WANDERER_REMAINING_HARDENING_AND_EFFICIENCY.md",
        ],
        approvedUntrackedSpecifications: [
          "FRANK_WANDERER_REMAINING_HARDENING_AND_EFFICIENCY.md",
        ],
      },
      fixtureHashes: { saves: {}, world: {} },
      startedAt: "2026-08-22T17:00:00.000Z",
    });

    expect(state.worktree.approvedUntrackedSpecifications).toEqual([
      "FRANK_WANDERER_REMAINING_HARDENING_AND_EFFICIENCY.md",
    ]);
    expect(state.worktree.trackedState).toBe("clean");
  });
});
