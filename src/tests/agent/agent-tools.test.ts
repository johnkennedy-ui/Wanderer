import {
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
import { changedFilesSince } from "../../../scripts/agent/common.mjs";
// @ts-expect-error Command modules intentionally remain repository-native Node ESM without TS declarations.
import { evaluateMissionStart } from "../../../scripts/agent/mission-start.mjs";
// @ts-expect-error Command modules intentionally remain repository-native Node ESM without TS declarations.
import { runCommand } from "../../../scripts/agent/run.mjs";
// @ts-expect-error Command modules intentionally remain repository-native Node ESM without TS declarations.
import { selectTrackedFormattingFiles } from "../../../scripts/agent/format.mjs";

const { classifyChangedPath, selectFocusedChecks } = checks;

const temporaryDirectories: string[] = [];

const temporaryMission = () => {
  const cwd = mkdtempSync(join(tmpdir(), "wanderer-agent-test-"));
  temporaryDirectories.push(cwd);
  mkdirSync(join(cwd, ".agent"), { recursive: true });
  writeFileSync(
    join(cwd, ".agent", "mission.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      missionId: "agent-test",
      requestedObjective: "test agent runtime",
      runs: [],
      lastFailureSignature: null,
      repeatedFailureCount: 0,
      lastFailureCommand: null,
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
    expect(selection.classifications).toEqual([
      {
        path: "src/tests/domain/session-movement.test.ts",
        category: "session",
      },
    ]);
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

  it("selects only repository-contained tracked files and excludes approved specifications", () => {
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
    ).toEqual(["scripts/agent/tracked-tool.mjs"]);
    expect(() =>
      selectTrackedFormattingFiles(cwd, [
        "scripts/agent/../../../../outside.mjs",
      ]),
    ).toThrow("Output paths must stay inside the repository.");
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
