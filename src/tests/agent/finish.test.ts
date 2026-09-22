import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const commonPath = "../../../scripts/agent/common.mjs";
const finishPath = "../../../scripts/agent/finish.mjs";
const runPath = "../../../scripts/agent/run.mjs";
const missionPath = "../../../scripts/agent/mission-start.mjs";
const common = await import(commonPath);
const { finishMission, validateRecordedRuns } = await import(finishPath);
const { runCommand } = await import(runPath);
const { upgradeMissionRecord } = await import(missionPath);
const directories: string[] = [];
const command = [process.execPath, "--version"];
const commandText = common.commandText(command);
const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const commit = (cwd: string) => {
  git(cwd, ["add", "."]);
  git(cwd, [
    "-c",
    "user.name=Finish Test",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
};
const fixture = () => {
  const cwd = mkdtempSync(join(tmpdir(), "wanderer-finish-test-"));
  directories.push(cwd);
  git(cwd, ["init", "--quiet", "--initial-branch=fixture"]);
  writeFileSync(join(cwd, ".gitignore"), ".agent/\nnode_modules/\n.env*\n");
  writeFileSync(join(cwd, "source.txt"), "unchanged\n");
  const saves = join(cwd, "src/tests/fixtures/saves/v2");
  mkdirSync(saves, { recursive: true });
  writeFileSync(join(saves, "sample.json"), "{}\n");
  commit(cwd);
  common.ensureAgentDirectory(cwd);
  common.writeMissionState(cwd, {
    schemaVersion: 2,
    missionId: "finish-fixture",
    branch: "fixture",
    baselineCommit: git(cwd, ["rev-parse", "HEAD"]),
    policyVersion: common.AGENT_POLICY_VERSION,
    repository: common.repositoryIdentity(cwd),
    startedAt: new Date().toISOString(),
    requestedObjective: "Isolated finish contract test",
    compatibilityFixtureHashes: common.collectFixtureHashes(cwd),
    runs: [],
  });
  return cwd;
};
const finish = (cwd: string, extra = {}) =>
  finishMission({
    cwd,
    commands: [commandText],
    doctor: async () => ({ status: "ready" }),
    externalValidation: async () => {},
    ...extra,
  });
afterEach(() =>
  directories
    .splice(0)
    .forEach((cwd) => rmSync(cwd, { recursive: true, force: true })),
);

describe("authoritative source-bound completion", () => {
  it("records one source-stable completion with explicit unverified remote scopes", async () => {
    const cwd = fixture();
    const before = common.collectInputFingerprint({ cwd }).digest;
    const result = await finish(cwd);
    expect(result.status).toBe("LOCAL_PASS_REMOTE_NOT_VERIFIED");
    expect(result.scopes).toEqual({
      local: "passed",
      remoteCi: "not-verified",
      settings: "not-verified",
      deployment: "not-performed",
    });
    expect(result.fingerprint).toBe(before);
    expect(common.collectInputFingerprint({ cwd }).digest).toBe(before);
    expect(readdirSync(join(cwd, ".agent/completions"))).toHaveLength(2);
  });
  describe("check-only completion reuse", () => {
    let cwd: string;
    let evidencePaths: string[];
    // Real setup and the repeated completion each retain a 5s bound. Combining
    // setup, validation and two finishes ran 80 subprocesses in one test budget.
    // Keep fresh fingerprints and real records; do not cache or mock them.
    beforeEach(async () => {
      cwd = fixture();
      await runCommand({ cwd, command });
      const result = await finish(cwd, { checkOnly: true });
      expect(result.status).toBe("LOCAL_PASS_REMOTE_NOT_VERIFIED");
      evidencePaths = result.evidencePaths;
      expect(readdirSync(join(cwd, ".agent/completions"))).toHaveLength(2);
    }, 5_000);
    it("reuses completion evidence in check-only mode", async () => {
      const again = await finish(cwd, { checkOnly: true });
      expect(again.evidencePaths).toEqual(evidencePaths);
      expect(readdirSync(join(cwd, ".agent/completions"))).toHaveLength(2);
    });
  });
  it("does not accept missing validation or arbitrary successful commands", async () => {
    const cwd = fixture();
    await runCommand({ cwd, command: [process.execPath, "-p", "1"] });
    await expect(finish(cwd, { checkOnly: true })).rejects.toThrow(
      "Missing required",
    );
  });
  it.each([
    "source-after-pass",
    "staged",
    "untracked",
    "ignored",
    "fixture",
    "head",
    "foreign-mission",
    "foreign-repository",
  ])("rejects %s changes", async (change) => {
    const cwd = fixture();
    await runCommand({ cwd, command });
    if (["source-after-pass", "staged", "head"].includes(change)) {
      writeFileSync(join(cwd, "source.txt"), "changed\n");
      if (change === "staged") git(cwd, ["add", "source.txt"]);
      if (change === "head") commit(cwd);
    }
    if (change === "untracked")
      writeFileSync(join(cwd, "untracked.ts"), "export {};\n");
    if (change === "ignored")
      writeFileSync(join(cwd, ".env.local"), "SYNTHETIC=not-a-secret\n");
    if (change === "fixture") {
      writeFileSync(
        join(cwd, "src/tests/fixtures/saves/v2/sample.json"),
        '{"changed":true}\n',
      );
      commit(cwd);
    }
    if (change === "foreign-mission" || change === "foreign-repository") {
      const state = common.readMissionState(cwd);
      if (change === "foreign-mission") state.missionId = "other";
      else state.repository.root = "/different/repository";
      common.writeMissionState(cwd, state);
    }
    await expect(finish(cwd, { checkOnly: true })).rejects.toThrow();
  });
  it.each([
    "schema",
    "running",
    "cancelled",
    "exit",
    "timeout",
    "signal",
    "log-missing",
    "log-changed",
    "record-missing",
    "record-malformed",
  ])("rejects %s validation evidence", async (mutation) => {
    const cwd = fixture();
    const run = await runCommand({ cwd, command });
    const state = common.readMissionState(cwd);
    const record = state.runs[0];
    if (mutation === "schema") record.schemaVersion = 1;
    if (["running", "cancelled"].includes(mutation)) record.status = mutation;
    if (mutation === "exit") record.exitCode = 1;
    if (mutation === "timeout") record.timedOut = true;
    if (mutation === "signal") record.signal = "SIGTERM";
    if (mutation === "log-missing") rmSync(join(cwd, run.logPath));
    if (mutation === "log-changed")
      writeFileSync(join(cwd, run.logPath), "forged\n");
    if (mutation === "record-missing")
      rmSync(join(cwd, ".agent/runs", run.id + ".json"));
    if (mutation === "record-malformed")
      writeFileSync(join(cwd, ".agent/runs", run.id + ".json"), "not json");
    common.writeMissionState(cwd, state);
    expect(() =>
      validateRecordedRuns({ cwd, commands: [commandText] }),
    ).toThrow();
  });
  it("records an invalidated run even when new ignored inputs prevent the closing fingerprint", async () => {
    const cwd = fixture();
    const result = await runCommand({
      cwd,
      command: [
        process.execPath,
        "-e",
        "require('fs').writeFileSync('.env.local','inert')",
      ],
    });
    expect(result.status).toBe("invalidated");
    expect(result.exitCode).toBe(0);
    expect(result.inputAfterError).toBe("IGNORED_INPUT_REJECTED");
    expect(
      JSON.parse(
        readFileSync(join(cwd, ".agent/runs", result.id + ".json"), "utf8"),
      ).status,
    ).toBe("invalidated");
  });
  describe("completion validation integrity", () => {
    let cwd: string;
    // Keep the real validation setup under its own unchanged 5s bound. The
    // completion assertions then retain their separate default 5s deadline.
    beforeEach(async () => {
      cwd = fixture();
      await runCommand({ cwd, command });
    }, 5_000);
    it("cannot bless source mutation or validator failure during completion", async () => {
      await expect(
        finish(cwd, {
          checkOnly: true,
          externalValidation: async () => {
            throw new Error("scanner failed");
          },
        }),
      ).rejects.toThrow("scanner failed");
      await expect(
        finish(cwd, {
          checkOnly: true,
          externalValidation: async () => {
            writeFileSync(join(cwd, "source.txt"), "changed");
          },
        }),
      ).rejects.toThrow("changed");
    });
  });
  it("upgrades historical metadata without restarting its mission or discarding evidence", () => {
    const cwd = fixture();
    const previous = common.readMissionState(cwd);
    previous.schemaVersion = 1;
    delete previous.policyVersion;
    delete previous.repository;
    previous.runs = [
      {
        status: "passed",
        schemaVersion: 1,
        commandText: "historical evidence only",
      },
    ];
    common.writeMissionState(cwd, previous);
    const upgraded = upgradeMissionRecord({ cwd });
    for (const field of [
      "missionId",
      "baselineCommit",
      "startedAt",
      "requestedObjective",
      "compatibilityFixtureHashes",
      "runs",
    ])
      expect(upgraded[field]).toEqual(previous[field]);
    expect(upgraded.schemaVersion).toBe(2);
    expect(upgraded.schemaUpgrade.historicalRunsRetained).toBe(true);
    expect(() =>
      validateRecordedRuns({ cwd, commands: ["historical evidence only"] }),
    ).toThrow();
  });
});
