import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
const checkModulePath = "../../../scripts/security/check.mjs";
const toolingModulePath = "../../../scripts/security/tooling.mjs";
const {
  SecurityCheckError,
  parseAudit,
  sanitizePaths,
  validateExceptions,
  validateSarif,
  parseSignatures,
  validateSbom,
  validateSecuritySummary,
  REQUIRED_SECURITY_STEPS,
  MAX_AGE_MS,
  SECURITY_EVIDENCE_SCHEMA_VERSION,
  executeScanner,
  runSecurityCheck,
} = await import(checkModulePath);
const { verifyToolArchive, TOOL_SPECS } = await import(toolingModulePath);
const temporaryDirectories: string[] = [];
type OwnedGroupIdentity = {
  pid: number;
  ppid: number;
  pgrp: number;
  startTime: string;
};
const processIdentity = (pid: number): OwnedGroupIdentity | null => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat
      .slice(stat.lastIndexOf(")") + 1)
      .trim()
      .split(" ");
    return {
      pid,
      ppid: Number(fields[1]),
      pgrp: Number(fields[2]),
      startTime: fields[19],
    };
  } catch {
    return null;
  }
};
const signalOwnedGroup = (
  original: OwnedGroupIdentity | null,
  signalName: string,
) => {
  if (original === null) return false;
  const result = spawnSync(
    "python3",
    [
      "-B",
      "-c",
      "import ctypes,os,signal,sys,time\n" +
        "pid=int(sys.argv[1]);parent=int(sys.argv[2]);pgrp=int(sys.argv[3]);expected=sys.argv[4];name=sys.argv[5]\n" +
        "def identity(value):\n" +
        " try:\n" +
        "  tail=open(f'/proc/{value}/stat',encoding='utf8').read().rsplit(')',1)[1].split()\n" +
        "  return int(tail[1]),int(tail[2]),tail[19]\n" +
        " except (OSError,IndexError,ValueError): return None\n" +
        "before=identity(pid)\n" +
        "if before is None or before != (parent,pgrp,expected): print('skipped');sys.exit(0)\n" +
        "libc=ctypes.CDLL(None,use_errno=True);send=libc.pidfd_send_signal\n" +
        "send.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_void_p,ctypes.c_uint];send.restype=ctypes.c_int\n" +
        "sent=0\n" +
        "for _ in range(3):\n" +
        " members=[]\n" +
        " for entry in os.listdir('/proc'):\n" +
        "  if entry.isdigit():\n" +
        "   value=int(entry);current=identity(value)\n" +
        "   if current is not None and current[1] == pgrp: members.append((value,current))\n" +
        " for value,member in members:\n" +
        "  try: fd=os.pidfd_open(value,0)\n" +
        "  except OSError: continue\n" +
        "  try:\n" +
        "   if identity(value) != member or member[1] != pgrp: continue\n" +
        "   if send(fd,getattr(signal,name),None,0) == 0: sent += 1\n" +
        "  finally: os.close(fd)\n" +
        " if not members: break\n" +
        " time.sleep(0.005)\n" +
        "print('sent' if sent else 'skipped')\n",
      String(original.pid),
      String(original.ppid),
      String(original.pgrp),
      original.startTime,
      signalName,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    },
  );
  if (result.error || result.status !== 0)
    throw (
      result.error ?? new Error(result.stderr || "owned group rescue failed")
    );
  return result.stdout.trim() === "sent";
};
afterEach(() =>
  temporaryDirectories
    .splice(0)
    .forEach((directory) =>
      rmSync(directory, { force: true, recursive: true }),
    ),
);
const audit = (severity?: string) =>
  JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: severity
      ? {
          sample: {
            severity,
            via: [],
            nodes: ["node_modules/sample"],
            range: "1.0.0",
            fixAvailable: false,
          },
        }
      : {},
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0,
        ...(severity ? { [severity]: 1 } : {}),
        total: severity ? 1 : 0,
      },
    },
  });
const sarif = (level: string | null = null): any => ({
  version: "2.1.0",
  runs: [
    {
      tool: {
        driver: {
          name: "CodeQL",
          rules: [
            { id: "js/test", defaultConfiguration: { level: "warning" } },
          ],
        },
      },
      invocations: [{ executionSuccessful: true }],
      results:
        level === null
          ? []
          : [
              {
                ruleId: "js/test",
                level,
                message: { text: "inert fixture finding" },
              },
            ],
    },
  ],
});
const exception = {
  id: "one",
  advisory: "GHSA-example",
  package: "sample",
  version: "1.0.0",
  path: "node_modules/sample",
  applicability: "fixture",
  ownerApproval: "unverified text",
  mitigation: "fixture",
  expiresAt: "2030-01-01T00:00:00.000Z",
  retestCondition: "upgrade",
};
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  components: [{ name: "sample", version: "1.0.0" }],
};

describe("security parsers and execution fail closed", () => {
  it("does not signal absent or unowned process groups during rescue", () => {
    expect(signalOwnedGroup(null, "SIGKILL")).toBe(false);
    const current = processIdentity(process.pid);
    expect(current).not.toBeNull();
    expect(
      signalOwnedGroup(
        {
          ...current!,
          startTime: "replacement-process",
        },
        "SIGKILL",
      ),
    ).toBe(false);
    expect(
      signalOwnedGroup({ ...current!, pgrp: current!.pgrp + 1 }, "SIGKILL"),
    ).toBe(false);
    expect(() => process.kill(process.pid, 0)).not.toThrow();
  });

  it.each(["info", "low", "moderate", "high", "critical"])(
    "preserves %s audit findings and affected installed paths",
    (severity) => {
      expect(parseAudit(audit(severity), "full").findings).toEqual([
        {
          name: "sample",
          severity,
          via: [],
          nodes: ["node_modules/sample"],
          range: "1.0.0",
          fixAvailable: false,
        },
      ]);
    },
  );
  it.each([
    "not-json",
    "{}",
    '{"auditReportVersion":1}',
    JSON.stringify({ ...JSON.parse(audit()), error: { code: "NETWORK" } }),
    audit().replace('"total":0', '"total":1'),
    audit("high").replace('"high":1', '"high":0'),
  ])(
    "rejects malformed, network-error and contradictory audit output",
    (text) =>
      expect(() => parseAudit(text, "full")).toThrow(SecurityCheckError),
  );
  it("rejects incomplete, expired, duplicated and self-approved exceptions", () => {
    expect(() =>
      validateExceptions({ schemaVersion: 1, exceptions: [{}] }),
    ).toThrow("incomplete");
    expect(() =>
      validateExceptions({
        schemaVersion: 1,
        exceptions: [{ ...exception, expiresAt: "2020-01-01" }],
      }),
    ).toThrow("expired");
    expect(() =>
      validateExceptions({
        schemaVersion: 1,
        exceptions: [exception, exception],
      }),
    ).toThrow("duplicated");
    expect(() =>
      validateExceptions({ schemaVersion: 1, exceptions: [exception] }),
    ).toThrow("owner-approved");
    expect(validateExceptions({ schemaVersion: 1, exceptions: [] })).toEqual(
      [],
    );
  });
  it.each(["warning", "error"])("rejects %s static findings", (level) =>
    expect(() => validateSarif(sarif(level))).toThrow("unapproved"),
  );
  it("rejects missing or foreign SARIF and uses the rule's default level", () => {
    expect(() => validateSarif({ ...sarif(), runs: [] })).toThrow(
      "exactly one",
    );
    const foreign = sarif();
    foreign.runs[0].tool.driver.name = "Other";
    expect(() => validateSarif(foreign)).toThrow("tool");
    const incomplete = sarif();
    incomplete.runs[0].invocations = [];
    expect(() => validateSarif(incomplete)).toThrow("incomplete");
    const defaultLevel = sarif("warning");
    delete defaultLevel.runs[0].results[0].level;
    expect(() => validateSarif(defaultLevel)).toThrow("unapproved");
    expect(validateSarif(sarif())).toEqual({
      tool: "CodeQL",
      results: 0,
      rules: 1,
    });
  });
  it("rejects security findings even when a report claims note level", () => {
    const report = sarif("note");
    report.runs[0].tool.driver.rules[0].properties = {
      "security-severity": "8.1",
    };
    expect(() => validateSarif(report)).toThrow("unapproved");
  });
  it("requires actual registry-signature coverage and distinguishes provenance counts", () => {
    expect(
      parseSignatures(
        "audited 20 packages in 2s\n20 packages have verified registry signatures\n5 packages have verified attestations\n",
      ),
    ).toMatchObject({ audited: 20, signatures: 20, attestations: 5 });
    expect(
      parseSignatures(
        "audited 1 package in 1s\n1 package has a verified registry signature\n",
      ),
    ).toMatchObject({ signatures: 1, attestations: 0 });
    for (const text of [
      "",
      "unsupported registry",
      "audited 2 packages in 1s\n1 package has a verified registry signature",
      "audited 0 packages in 1s\n0 packages have verified registry signatures",
    ])
      expect(() => parseSignatures(text)).toThrow();
  });
  it("rejects empty, malformed or unsupported SBOMs", () => {
    expect(validateSbom(sbom).components).toBe(1);
    for (const value of [
      {},
      { ...sbom, components: [] },
      { ...sbom, specVersion: "unknown" },
    ])
      expect(() => validateSbom(value)).toThrow();
  });
  it("removes private absolute paths from reports", () =>
    expect(
      sanitizePaths(
        { uri: "/workspace/wanderer/src/main.ts" },
        "/workspace/wanderer",
      ),
    ).toEqual({ uri: "./src/main.ts" }));
  it("rejects missing and checksum-mismatched scanner archives", () => {
    const cwd = mkdtempSync(join(tmpdir(), "wanderer-security-tool-"));
    temporaryDirectories.push(cwd);
    expect(() => verifyToolArchive(cwd, "gitleaks")).toThrow("missing");
    const downloads = join(cwd, ".agent/tools/downloads");
    mkdirSync(downloads, { recursive: true });
    writeFileSync(join(downloads, "gitleaks_8.30.1_linux_x64.tar.gz"), "wrong");
    expect(() => verifyToolArchive(cwd, "gitleaks")).toThrow("checksum");
  });
  it("records missing commands and timeouts as unsuccessful execution", async () => {
    const missing = await executeScanner(
      "/nonexistent/wanderer-scanner",
      [],
      process.cwd(),
      100,
    );
    expect(missing.error).toBeTruthy();
    expect(missing.exitCode).not.toBe(0);
    const timeout = await executeScanner(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      process.cwd(),
      50,
    );
    expect(timeout.timedOut).toBe(true);
    expect(timeout.exitCode).not.toBe(0);
  });
});

const evidenceFixture = () => {
  const now = new Date("2026-09-18T10:00:00.000Z");
  const identity = {
    head: "source",
    tree: "tree",
    sourceInputDigest: "fresh",
    historyRefs: ["refs/heads/main source"],
    shallow: "false",
  };
  const runId = "11111111-1111-1111-1111-111111111111";
  const files = new Map<string, string>();
  const output = (name: string, suffix: string, text: string) => {
    const path = `.agent/security/runs/${runId}/${name}-${suffix}`;
    files.set(path, text);
    return {
      path,
      sha256: createHash("sha256").update(text).digest("hex"),
      bytes: Buffer.byteLength(text),
    };
  };
  const root = `./.agent/security/runs/${runId}`;
  const db = `./.agent/security/codeql-db/${runId}`;
  const leaks = [
    "--config",
    "./scripts/security/gitleaks.toml",
    "--redact=100",
    "--report-format=json",
    "--exit-code=1",
    "--no-banner",
    "--no-color",
    "--ignore-gitleaks-allow",
    "--timeout=180",
  ];
  const plans: Record<
    string,
    { command: string; args: string[]; timeoutMs: number }[]
  > = {
    "audit-full": [
      { command: "npm", args: ["audit", "--json"], timeoutMs: 240_000 },
    ],
    "audit-runtime": [
      {
        command: "npm",
        args: ["audit", "--json", "--omit=dev"],
        timeoutMs: 240_000,
      },
    ],
    "npm-signatures": [
      {
        command: "npm",
        args: ["audit", "signatures", "--color=false"],
        timeoutMs: 240_000,
      },
    ],
    "sbom-full": [
      {
        command: "npm",
        args: ["sbom", "--sbom-format", "cyclonedx", "--package-lock-only"],
        timeoutMs: 240_000,
      },
    ],
    "sbom-runtime": [
      {
        command: "npm",
        args: [
          "sbom",
          "--sbom-format",
          "cyclonedx",
          "--package-lock-only",
          "--omit=dev",
        ],
        timeoutMs: 240_000,
      },
    ],
    "gitleaks-tree": [
      {
        command: "@verified/gitleaks/" + TOOL_SPECS.gitleaks.binary,
        args: [
          "dir",
          ".",
          ...leaks,
          "--report-path",
          root + "/gitleaks-tree-raw.json",
        ],
        timeoutMs: 240_000,
      },
    ],
    "gitleaks-history": [
      {
        command: "@verified/gitleaks/" + TOOL_SPECS.gitleaks.binary,
        args: [
          "git",
          ".",
          "--log-opts=--all HEAD",
          ...leaks,
          "--report-path",
          root + "/gitleaks-history-raw.json",
        ],
        timeoutMs: 240_000,
      },
    ],
    codeql: [
      {
        command: "@verified/codeql/" + TOOL_SPECS.codeql.binary,
        args: [
          "database",
          "create",
          db,
          "--language=javascript-typescript",
          "--source-root",
          ".",
          "--build-mode=none",
          "--codescanning-config",
          "./.github/codeql-config.yml",
          "--threads=2",
          "--ram=2048",
        ],
        timeoutMs: 600_000,
      },
      {
        command: "@verified/codeql/" + TOOL_SPECS.codeql.binary,
        args: [
          "database",
          "analyze",
          db,
          "codeql/javascript-queries:codeql-suites/javascript-security-and-quality.qls",
          "--format=sarif-latest",
          "--output",
          root + "/codeql-raw.sarif",
          "--threads=2",
          "--ram=2048",
          "--no-sarif-add-snippets",
          "--no-sarif-add-file-contents",
        ],
        timeoutMs: 900_000,
      },
    ],
  };
  const steps = REQUIRED_SECURITY_STEPS.map((name: string) => {
    const text = name.startsWith("audit-")
      ? audit()
      : name.startsWith("sbom-")
        ? JSON.stringify(sbom)
        : name === "npm-signatures"
          ? "audited 1 package in 1s\n1 package has a verified registry signature\n"
          : "completed";
    const evidence = plans[name].flatMap((_, index) => [
      output(name, `${index + 1}.stdout`, text),
      output(name, `${index + 1}.stderr`, ""),
    ]);
    if (name.startsWith("sbom-"))
      evidence.push(
        output(
          name,
          "identity.json",
          JSON.stringify({
            identity,
            scope: name.slice(5),
            detail: { components: 1, specVersion: "1.5" },
          }),
        ),
      );
    if (name.startsWith("gitleaks-"))
      evidence.push(output(name, "findings.json", "[]"));
    if (name === "gitleaks-history")
      evidence.push(
        output(
          name,
          "refs.json",
          JSON.stringify({
            head: identity.head,
            refs: identity.historyRefs,
            range: "--all HEAD",
            commits: 1,
            shallow: false,
          }),
        ),
      );
    if (name === "codeql")
      evidence.push(output(name, "report.sarif", JSON.stringify(sarif())));
    return {
      name,
      status: "passed",
      commands: plans[name].map((plan) => ({
        ...plan,
        cwd: ".",
        startedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        durationMs: 0,
        exitCode: 0,
        signal: null,
        error: null,
        timedOut: false,
        overflow: false,
        interrupted: false,
        termination: "none",
        cleanup: "reaped",
      })),
      evidence,
    };
  });
  const summary: any = {
    schemaVersion: SECURITY_EVIDENCE_SCHEMA_VERSION,
    runId,
    generatedAt: now.toISOString(),
    completedAt: now.toISOString(),
    freshnessDeadline: new Date(now.valueOf() + MAX_AGE_MS).toISOString(),
    identity,
    inputAfter: identity,
    tools: Object.fromEntries(
      ["gitleaks", "codeql"].map((name) => [
        name,
        {
          version: TOOL_SPECS[name].version,
          sha256: TOOL_SPECS[name].archiveSha256,
          contentSha256: "a".repeat(64),
          binarySha256: "b".repeat(64),
          binary: "@verified/" + name + "/" + TOOL_SPECS[name].binary,
          execution: "private-archive-callback-v1",
        },
      ]),
    ),
    steps,
    status: "passed",
    drift: null,
    interrupted: false,
    lifecycleError: null,
  };
  const validate = () =>
    validateSecuritySummary({
      summary,
      identity,
      now,
      exceptions: { schemaVersion: 1, exceptions: [] },
      readEvidence: (path: string) => {
        if (!files.has(path)) throw new Error("missing evidence");
        return files.get(path);
      },
    });
  return { summary, validate, files, now };
};
const scannerRepository = () => {
  const cwd = mkdtempSync(join(tmpdir(), "wanderer-security-receipts-"));
  temporaryDirectories.push(cwd);
  execFileSync("git", ["init", "--quiet", "--initial-branch=fixture"], {
    cwd,
  });
  mkdirSync(join(cwd, "scripts/security"), { recursive: true });
  writeFileSync(join(cwd, ".gitignore"), ".agent/\n");
  writeFileSync(
    join(cwd, "scripts/security/exceptions.json"),
    '{"schemaVersion":1,"exceptions":[]}',
  );
  writeFileSync(join(cwd, "source.txt"), "inert source\n");
  execFileSync("git", ["add", "."], { cwd });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Scanner Receipt Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ],
    { cwd },
  );
  mkdirSync(join(cwd, ".agent/security"), { recursive: true });
  writeFileSync(
    join(cwd, ".agent/security/summary.json"),
    '{"schemaVersion":3,"status":"passed","runId":"old-receipt"}',
  );
  return cwd;
};
describe("security evidence is complete, current and content-bound", () => {
  it("accepts complete receipts emitted by the real runner over inert scanner boundaries", async () => {
    const cwd = scannerRepository();
    let calls = 0;
    const active = new Set<string>();
    const closed: string[] = [];
    const toolCalls: Record<string, number> = {};
    const summary = await runSecurityCheck({
      cwd,
      useTool: async (
        _cwd: string,
        name: string,
        use: (tool: any) => Promise<any>,
      ) => {
        const directory = mkdtempSync(
          join(tmpdir(), "wanderer-sec01-receipt-fixture-"),
        );
        temporaryDirectories.push(directory);
        const binary = join(directory, "tool", TOOL_SPECS[name].binary);
        mkdirSync(join(directory, "tool"), { recursive: true });
        writeFileSync(binary, "inert executable fixture");
        active.add(binary);
        toolCalls[name] = 0;
        try {
          return await use({
            binary,
            version: TOOL_SPECS[name].version,
            sha256: TOOL_SPECS[name].archiveSha256,
            binarySha256: "b".repeat(64),
            contentSha256: "a".repeat(64),
          });
        } finally {
          expect(toolCalls[name]).toBe(2);
          active.delete(binary);
          rmSync(directory, { recursive: true, force: true });
          closed.push(binary);
        }
      },
      execute: async (command: string, args: string[]) => {
        calls++;
        if (command !== "npm") {
          expect(active.has(command)).toBe(true);
          expect(existsSync(command)).toBe(true);
          expect(command.includes(".agent/tools")).toBe(false);
          toolCalls[command.endsWith("/gitleaks") ? "gitleaks" : "codeql"]++;
        }
        expect(
          JSON.parse(
            readFileSync(join(cwd, ".agent/security/summary.json"), "utf8"),
          ).status,
        ).toBe("running");
        let stdout = "completed";
        if (command === "npm" && args[0] === "audit")
          stdout =
            args[1] === "signatures"
              ? "audited 1 package in 1s\n1 package has a verified registry signature\n"
              : audit();
        if (command === "npm" && args[0] === "sbom")
          stdout = JSON.stringify(sbom);
        if (command.endsWith("/gitleaks"))
          writeFileSync(args[args.indexOf("--report-path") + 1], "[]");
        if (command.endsWith("/codeql") && args[1] === "analyze")
          writeFileSync(
            args[args.indexOf("--output") + 1],
            JSON.stringify(sarif()),
          );
        return {
          stdout,
          stderr: "",
          exitCode: 0,
          signal: null,
          error: null,
          timedOut: false,
          overflow: false,
          interrupted: false,
          termination: "none",
          cleanup: "reaped",
          durationMs: 0,
        };
      },
    });
    expect(calls).toBe(9);
    expect(active.size).toBe(0);
    expect(closed.length).toBe(2);
    expect(closed.every((path) => !existsSync(path))).toBe(true);
    expect(summary.status).toBe("passed");
    expect(
      validateSecuritySummary({
        summary,
        identity: summary.identity,
        exceptions: { schemaVersion: 1, exceptions: [] },
        readEvidence: (path: string) => readFileSync(join(cwd, path)),
      }).status,
    ).toBe("passed");
  });
  for (const name of REQUIRED_SECURITY_STEPS) {
    it.each(["command", "args", "cwd", "timeoutMs"])(
      `rejects wrong ${name} %s including every CodeQL invocation`,
      (field) => {
        for (const index of name === "codeql" ? [0, 1] : [0]) {
          const { summary, validate } = evidenceFixture();
          const command = summary.steps.find((step: any) => step.name === name)
            .commands[index];
          command[field] =
            field === "args" ? [] : field === "timeoutMs" ? 1 : "wrong";
          expect(validate).toThrow();
        }
      },
    );
  }
  it.each([
    "wrong-byte-count",
    "missing-end",
    "backwards-time",
    "unbound-history-refs",
    "history-range",
    "history-count",
    "sbom-scope",
    "v2",
  ])("rejects %s in otherwise complete evidence", (mutation) => {
    const { summary, files, validate, now } = evidenceFixture();
    if (mutation === "wrong-byte-count") summary.steps[0].evidence[0].bytes++;
    if (mutation === "missing-end")
      delete summary.steps[0].commands[0].finishedAt;
    if (mutation === "backwards-time")
      summary.steps[0].commands[0].finishedAt = new Date(
        now.valueOf() - 1,
      ).toISOString();
    if (mutation === "v2") summary.schemaVersion = 2;
    if (
      [
        "unbound-history-refs",
        "history-range",
        "history-count",
        "sbom-scope",
      ].includes(mutation)
    ) {
      const step = summary.steps.find(
        (entry: any) =>
          entry.name ===
          (mutation === "sbom-scope" ? "sbom-full" : "gitleaks-history"),
      );
      const entry = step.evidence.find((entry: any) =>
        entry.path.endsWith(
          mutation === "sbom-scope" ? "identity.json" : "refs.json",
        ),
      );
      const report = JSON.parse(files.get(entry.path)!);
      if (mutation === "unbound-history-refs") report.refs = [];
      if (mutation === "history-range") report.range = "HEAD";
      if (mutation === "history-count") report.commits = 0;
      if (mutation === "sbom-scope") report.scope = "runtime";
      const text = JSON.stringify(report);
      files.set(entry.path, text);
      entry.bytes = Buffer.byteLength(text);
      entry.sha256 = createHash("sha256").update(text).digest("hex");
    }
    expect(validate).toThrow();
  });
  it.each([
    "missing-program",
    "wrong-program",
    "missing-args",
    "wrong-scope",
    "missing-cwd",
    "foreign-cwd",
    "missing-time",
    "nonfinite-duration",
    "missing-codeql-second-log",
    "duplicate-log",
    "substituted-log",
    "missing-history-refs",
    "missing-sbom-identity",
    "malformed-empty-object",
    "empty-json-string",
  ])("rejects incomplete execution receipt: %s", (mutation) => {
    const { summary, files, validate } = evidenceFixture();
    const command = summary.steps[0].commands[0];
    if (mutation === "missing-program") delete command.command;
    if (mutation === "wrong-program") command.command = "true";
    if (mutation === "missing-args") delete command.args;
    if (mutation === "wrong-scope")
      command.args = ["audit", "--json", "--omit=dev"];
    if (mutation === "missing-cwd") delete command.cwd;
    if (mutation === "foreign-cwd") command.cwd = "../other";
    if (mutation === "missing-time") delete command.startedAt;
    if (mutation === "nonfinite-duration") command.durationMs = Infinity;
    const step = summary.steps.find((entry: any) => entry.name === "codeql");
    if (mutation === "missing-codeql-second-log")
      step.evidence = step.evidence.filter(
        (entry: any) => !entry.path.endsWith("-2.stderr"),
      );
    if (mutation === "duplicate-log")
      summary.steps[0].evidence.push(summary.steps[0].evidence[0]);
    if (mutation === "substituted-log")
      summary.steps[0].evidence[1] = summary.steps[1].evidence[1];
    if (mutation === "missing-history-refs")
      summary.steps.find(
        (entry: any) => entry.name === "gitleaks-history",
      ).evidence = summary.steps
        .find((entry: any) => entry.name === "gitleaks-history")
        .evidence.filter((entry: any) => !entry.path.endsWith("refs.json"));
    if (mutation === "missing-sbom-identity")
      summary.steps.find((entry: any) => entry.name === "sbom-full").evidence =
        summary.steps
          .find((entry: any) => entry.name === "sbom-full")
          .evidence.filter(
            (entry: any) => !entry.path.endsWith("identity.json"),
          );
    if (["malformed-empty-object", "empty-json-string"].includes(mutation)) {
      const entry = summary.steps
        .find((entry: any) => entry.name === "gitleaks-tree")
        .evidence.find((entry: any) => entry.path.endsWith("findings.json"));
      const text =
        mutation === "malformed-empty-object" ? '{"length":0}' : '""';
      files.set(entry.path, text);
      entry.sha256 = createHash("sha256").update(text).digest("hex");
      entry.bytes = Buffer.byteLength(text);
    }
    expect(validate).toThrow();
  });
  it("accepts exactly the complete unchanged passing scanner set", () =>
    expect(evidenceFixture().validate().status).toBe("passed"));
  it.each([
    "missing-step",
    "duplicate-step",
    "failed",
    "running",
    "cancelled",
    "missing-command",
    "nonzero",
    "timeout",
    "missing-log",
    "changed-log",
    "foreign",
    "mid-run-change",
    "invalid-date",
    "future",
    "extended-expiry",
    "stale",
    "missing-tool",
    "old-v3",
    "missing-interruption",
    "interrupted-command",
    "unknown-cleanup",
    "missing-cleanup",
    "unclean-termination",
    "interrupted-summary",
    "lifecycle-failure",
    "mutable-tool-path",
    "missing-binary-hash",
    "missing-private-scope",
  ])("rejects %s evidence", (mutation) => {
    const { summary, files, validate, now } = evidenceFixture();
    if (mutation === "missing-step") summary.steps.pop();
    if (mutation === "duplicate-step") summary.steps.push(summary.steps[0]);
    if (["failed", "running", "cancelled"].includes(mutation))
      summary.steps[0].status = mutation;
    if (mutation === "missing-command") summary.steps[0].commands = [];
    if (mutation === "nonzero") summary.steps[0].commands[0].exitCode = 1;
    if (mutation === "timeout") summary.steps[0].commands[0].timedOut = true;
    if (mutation === "missing-log") files.clear();
    if (mutation === "changed-log")
      files.set(summary.steps[0].evidence[0].path, "changed");
    if (mutation === "foreign") summary.identity = { head: "other" };
    if (mutation === "mid-run-change") summary.inputAfter = { head: "other" };
    if (mutation === "invalid-date") summary.freshnessDeadline = "not-date";
    if (mutation === "future")
      summary.completedAt = new Date(now.valueOf() + 120_000).toISOString();
    if (mutation === "extended-expiry")
      summary.freshnessDeadline = new Date(
        now.valueOf() + 100 * MAX_AGE_MS,
      ).toISOString();
    if (mutation === "stale") {
      summary.generatedAt = new Date(
        now.valueOf() - 2 * MAX_AGE_MS,
      ).toISOString();
      summary.freshnessDeadline = new Date(
        now.valueOf() - MAX_AGE_MS,
      ).toISOString();
    }
    if (mutation === "missing-tool") delete summary.tools.codeql;
    if (mutation === "old-v3") summary.schemaVersion = 3;
    if (mutation === "missing-interruption")
      delete summary.steps[0].commands[0].interrupted;
    if (mutation === "interrupted-command")
      summary.steps[0].commands[0].interrupted = true;
    if (mutation === "unknown-cleanup")
      summary.steps[0].commands[0].cleanup = "unknown";
    if (mutation === "missing-cleanup")
      delete summary.steps[0].commands[0].cleanup;
    if (mutation === "unclean-termination")
      summary.steps[0].commands[0].termination = "control-eof";
    if (mutation === "interrupted-summary") summary.interrupted = true;
    if (mutation === "lifecycle-failure")
      summary.lifecycleError = "TOOL_CLEANUP_FAILED";
    if (mutation === "mutable-tool-path")
      summary.tools.codeql.binary = ".agent/tools/codeql-2.27.0/codeql";
    if (mutation === "missing-binary-hash")
      delete summary.tools.codeql.binarySha256;
    if (mutation === "missing-private-scope")
      delete summary.tools.codeql.execution;
    expect(validate).toThrow();
  });
});

describe("security scan cancellation composition", () => {
  it.each([
    { label: "original", options: "{graceMs:25,cleanupDeadlineMs:500}" },
    { label: "tiny", options: "{graceMs:1000,cleanupDeadlineMs:1}" },
    { label: "default", options: "{}" },
  ])(
    "naturally fails the standalone pipeline after paused telemetry, ancestor exit, and supervisor death ($label)",
    async ({ options }) => {
      const cwd = scannerRepository();
      const telemetryPaused = join(cwd, "scanner-telemetry-paused");
      const supervisorPid = join(cwd, "scanner-supervisor-pid");
      const ancestorExited = join(cwd, "scanner-ancestor-exited");
      const childReady = join(cwd, "scanner-unrecorded-child");
      const release = join(cwd, "scanner-release");
      const killed = join(cwd, "scanner-paused-supervisor-killed");
      const moduleUrl = new URL(checkModulePath, import.meta.url).href;
      const fixture = `const fs=require('node:fs');const {spawn}=require('node:child_process');const supervisor=process.ppid;fs.writeFileSync(${JSON.stringify(supervisorPid)},String(supervisor));process.kill(supervisor,'SIGSTOP');const pause=setInterval(()=>{let state='';try{state=fs.readFileSync('/proc/'+supervisor+'/stat','utf8').split(') ')[1].split(' ')[0]}catch{}if(state!=='T')return;clearInterval(pause);fs.writeFileSync(${JSON.stringify(telemetryPaused)},'T');const child=spawn(process.execPath,['-e',"const fs=require('fs');fs.writeFileSync(process.argv[1],String(process.pid));process.on('SIGTERM',()=>{});const wait=setInterval(()=>{if(fs.existsSync(process.argv[2])&&fs.existsSync(process.argv[3])){clearInterval(wait);process.kill(Number(fs.readFileSync(process.argv[4],'utf8')),'SIGKILL');fs.writeFileSync(process.argv[5],'1')}},5);setInterval(()=>{},1000)",${JSON.stringify(childReady)},${JSON.stringify(ancestorExited)},${JSON.stringify(release)},${JSON.stringify(supervisorPid)},${JSON.stringify(killed)}],{stdio:'inherit'});const wait=setInterval(()=>{if(fs.existsSync(${JSON.stringify(childReady)})){clearInterval(wait);fs.writeFileSync(${JSON.stringify(ancestorExited)},String(process.pid));process.exit(0)}},5)},5);`;
      const source = `import {runSecurityCheck,executeScanner} from ${JSON.stringify(moduleUrl)};
      let calls=0,toolCalls=0;
      const summary=await runSecurityCheck({cwd:${JSON.stringify(cwd)},
        useTool:async()=>{toolCalls++;throw new Error('unexpected tool');},
        execute:async(_command,_args,directory)=>{
          calls++;
          return executeScanner(process.execPath,['-e',${JSON.stringify(fixture)}],directory,2000,${options});
        }});
      console.log(JSON.stringify({status:summary.status,lifecycleError:summary.lifecycleError,calls,toolCalls,
        cleanup:summary.steps[0].commands[0].cleanup,
        laterCommands:summary.steps.slice(1).flatMap(step=>step.commands).length,
        stepCount:summary.steps.length}));
      if(summary.status!=='passed')process.exitCode=1;`;
      const caller = spawn(
        process.execPath,
        ["--input-type=module", "-e", source],
        {
          cwd,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const callerIdentity = processIdentity(caller.pid!);
      expect(callerIdentity).not.toBeNull();
      let stdout = "";
      let stderr = "";
      caller.stdout.setEncoding("utf8").on("data", (chunk) => {
        stdout += chunk;
      });
      caller.stderr.setEncoding("utf8").on("data", (chunk) => {
        stderr += chunk;
      });
      const completed = new Promise<{
        status: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error("Standalone caller did not naturally exit: " + stderr),
            ),
          5_000,
        );
        caller.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        caller.once("close", (status, signal) => {
          clearTimeout(timer);
          resolve({ status, signal });
        });
      });
      const state = (pid: number) => {
        try {
          return readFileSync(`/proc/${pid}/stat`, "utf8")
            .split(") ")[1]
            .split(" ")[0];
        } catch {
          return "absent";
        }
      };
      const waitFor = async (check: () => boolean, timeoutMs = 1_500) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (check()) return;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("standalone fixture did not reach expected state");
      };
      let verified = false;
      try {
        await waitFor(() => existsSync(telemetryPaused));
        const pausedPid = Number(readFileSync(supervisorPid, "utf8"));
        expect(state(pausedPid)).toBe("T");
        await waitFor(
          () => existsSync(childReady) && existsSync(ancestorExited),
        );
        const ancestorPid = Number(readFileSync(ancestorExited, "utf8"));
        await waitFor(() => ["Z", "absent"].includes(state(ancestorPid)));
        writeFileSync(release, "release");
        const result = await completed;
        expect(result.signal).toBeNull();
        expect(result.status).toBe(1);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual({
          status: "failed",
          lifecycleError: "SCANNER_CLEANUP_UNKNOWN",
          calls: 1,
          toolCalls: 0,
          cleanup: "unknown",
          laterCommands: 0,
          stepCount: 8,
        });
        for (const marker of [ancestorExited, childReady]) {
          const pid = Number(readFileSync(marker, "utf8"));
          await waitFor(() => state(pid) === "absent");
        }
        expect(
          JSON.parse(
            readFileSync(join(cwd, ".agent/security/summary.json"), "utf8"),
          ),
        ).toMatchObject({
          status: "failed",
          lifecycleError: "SCANNER_CLEANUP_UNKNOWN",
        });
        verified = true;
      } finally {
        // Rescue only a failed disposable test; a passing proof needs no outside kill.
        if (!verified && caller.pid) {
          signalOwnedGroup(callerIdentity, "SIGKILL");
        }
      }
    },
  );

  it("cancels a default-budget stopped supervisor only after observed stop and child readiness", async () => {
    const cwd = scannerRepository();
    const rootReady = join(cwd, "default-stopped-root-ready");
    const stopped = join(cwd, "default-stopped-supervisor");
    const childReady = join(cwd, "default-stopped-child-ready");
    const aborted = join(cwd, "default-stopped-aborted");
    const moduleUrl = new URL(checkModulePath, import.meta.url).href;
    const fixture = `const fs=require('node:fs');const {spawn}=require('node:child_process');const supervisor=process.ppid;process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(rootReady)},String(process.pid));process.kill(supervisor,'SIGSTOP');const poll=setInterval(()=>{let state='';try{state=fs.readFileSync('/proc/'+supervisor+'/stat','utf8').split(') ')[1].split(' ')[0]}catch{}if(state!=='T')return;clearInterval(poll);const child=spawn(process.execPath,['-e',"const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)",${JSON.stringify(childReady)}],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(stopped)},String(supervisor));setInterval(()=>{},1000)},5);`;
    const source = `import fs from 'node:fs';import {runSecurityCheck,executeScanner} from ${JSON.stringify(moduleUrl)};let calls=0,toolCalls=0;const controller=new AbortController();const watch=setInterval(()=>{if(fs.existsSync(${JSON.stringify(rootReady)})&&fs.existsSync(${JSON.stringify(stopped)})&&fs.existsSync(${JSON.stringify(childReady)})){clearInterval(watch);fs.writeFileSync(${JSON.stringify(aborted)},String(process.hrtime.bigint()));controller.abort()}} ,5);const summary=await runSecurityCheck({cwd:${JSON.stringify(cwd)},signal:controller.signal,useTool:async()=>{toolCalls++;throw Error('later dispatch')},execute:async(_c,_a,d,_timeout,options)=>{calls++;try{return await executeScanner(process.execPath,['-e',${JSON.stringify(fixture)}],d,2000,options)}finally{clearInterval(watch)}}});console.log(JSON.stringify({status:summary.status,interrupted:summary.interrupted,lifecycleError:summary.lifecycleError,calls,toolCalls,cleanup:summary.steps[0].commands[0].cleanup,later:summary.steps.slice(1).flatMap(s=>s.commands).length,receipt:summary.steps[0].commands.length}));process.exitCode=summary.status==='passed'?0:1;`;
    const caller = spawn(
      process.execPath,
      ["--input-type=module", "-e", source],
      {
        cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const callerIdentity = processIdentity(caller.pid!);
    expect(callerIdentity).not.toBeNull();
    let stdout = "";
    let stderr = "";
    caller.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    caller.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    const completed = new Promise<{
      status: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`caller timeout: ${stderr}`)),
        5_000,
      );
      caller.once("error", reject);
      caller.once("close", (status, signal) => {
        clearTimeout(timer);
        resolve({ status, signal });
      });
    });
    const state = (pid: number) => {
      try {
        return readFileSync(`/proc/${pid}/stat`, "utf8")
          .split(") ")[1]
          .split(" ")[0];
      } catch {
        return "absent";
      }
    };
    let verified = false;
    try {
      const readyDeadline = Date.now() + 1_500;
      while (
        (!existsSync(rootReady) ||
          !existsSync(stopped) ||
          !existsSync(childReady) ||
          !existsSync(aborted)) &&
        Date.now() < readyDeadline
      )
        await new Promise((resolve) => setTimeout(resolve, 5));
      expect(existsSync(rootReady)).toBe(true);
      expect(existsSync(stopped)).toBe(true);
      expect(existsSync(childReady)).toBe(true);
      expect(existsSync(aborted)).toBe(true);
      const supervisor = Number(readFileSync(stopped, "utf8"));
      expect(state(supervisor)).toBe("T");
      const root = Number(readFileSync(rootReady, "utf8"));
      const child = Number(readFileSync(childReady, "utf8"));
      const abortAt = Number(readFileSync(aborted, "utf8")) / 1_000_000;
      const result = await completed;
      const settledAt = Number(process.hrtime.bigint()) / 1_000_000;
      expect(settledAt - abortAt).toBeLessThan(3_450);
      expect(result).toEqual({ status: 1, signal: null });
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        status: "failed",
        interrupted: true,
        lifecycleError: "SCANNER_CLEANUP_UNKNOWN",
        calls: 1,
        toolCalls: 0,
        cleanup: "unknown",
        later: 0,
        receipt: 1,
      });
      expect(state(root)).toBe("absent");
      expect(state(child)).toBe("absent");
      expect(["Z", "absent"]).toContain(state(supervisor));
      expect(
        JSON.parse(
          readFileSync(join(cwd, ".agent/security/summary.json"), "utf8"),
        ),
      ).toMatchObject({
        status: "failed",
        lifecycleError: "SCANNER_CLEANUP_UNKNOWN",
      });
      verified = true;
    } finally {
      if (!verified && caller.pid) signalOwnedGroup(callerIdentity, "SIGKILL");
    }
  }, 7_000);

  it("naturally exits a standalone failed pipeline after unavailable-supervisor cleanup without later dispatch", async () => {
    const cwd = scannerRepository();
    const ready = join(cwd, "scanner-ready");
    const killed = join(cwd, "scanner-supervisor-killed");
    const grandchild = join(cwd, "scanner-grandchild");
    const moduleUrl = new URL(checkModulePath, import.meta.url).href;
    const fixture = `const fs=require('node:fs');const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'});process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));fs.writeFileSync(${JSON.stringify(grandchild)},String(child.pid));setTimeout(()=>{process.kill(process.ppid,'SIGKILL');fs.writeFileSync(${JSON.stringify(killed)},'1')},50);setInterval(()=>{},1000);`;
    const source = `import fs from 'node:fs';import {runSecurityCheck,executeScanner} from ${JSON.stringify(moduleUrl)};
      let calls=0,toolCalls=0;
      const summary=await runSecurityCheck({cwd:${JSON.stringify(cwd)},
        useTool:async()=>{toolCalls++;throw new Error('unexpected tool');},
        execute:async(_command,_args,directory)=>{
          calls++;
          const controller=new AbortController();
          const watcher=setInterval(()=>{if(fs.existsSync(${JSON.stringify(killed)})){clearInterval(watcher);controller.abort();}},10);
          try{return await executeScanner(process.execPath,['-e',${JSON.stringify(fixture)}],directory,1000,{signal:controller.signal,graceMs:25,cleanupDeadlineMs:1});}
          finally{clearInterval(watcher);}
        }});
      console.log(JSON.stringify({status:summary.status,lifecycleError:summary.lifecycleError,calls,toolCalls,
        cleanup:summary.steps[0].commands[0].cleanup,
        laterCommands:summary.steps.slice(1).flatMap(step=>step.commands).length,
        stepCount:summary.steps.length}));
      if(summary.status!=='passed')process.exitCode=1;`;
    const caller = spawn(
      process.execPath,
      ["--input-type=module", "-e", source],
      {
        cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const callerIdentity = processIdentity(caller.pid!);
    expect(callerIdentity).not.toBeNull();
    let stdout = "";
    let stderr = "";
    caller.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    caller.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    const completed = new Promise<{
      status: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              "Standalone caller did not naturally exit within 5000ms: " +
                stderr,
            ),
          ),
        5_000,
      );
      caller.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      caller.once("close", (status, signal) => {
        clearTimeout(timer);
        resolve({ status, signal });
      });
    });
    let verified = false;
    try {
      const result = await completed;
      expect(result.signal).toBeNull();
      expect(result.status).toBe(1);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        status: "failed",
        lifecycleError: "SCANNER_CLEANUP_UNKNOWN",
        calls: 1,
        toolCalls: 0,
        cleanup: "unknown",
        laterCommands: 0,
        stepCount: 8,
      });
      for (const marker of [ready, grandchild]) {
        const pid = Number(readFileSync(marker, "utf8"));
        let state = "absent";
        try {
          state = readFileSync(`/proc/${pid}/stat`, "utf8")
            .split(") ")[1]
            .split(" ")[0];
        } catch (error) {
          expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
        }
        expect(["absent", "Z"]).toContain(state);
      }
      expect(
        JSON.parse(
          readFileSync(join(cwd, ".agent/security/summary.json"), "utf8"),
        ),
      ).toMatchObject({
        status: "failed",
        lifecycleError: "SCANNER_CLEANUP_UNKNOWN",
      });
      verified = true;
    } finally {
      // Rescue only a failed disposable test; success must need no outside kill.
      if (!verified && caller.pid) {
        signalOwnedGroup(callerIdentity, "SIGKILL");
      }
    }
  });
  it("naturally exits a standalone failed pipeline after flooded adopted scanner cleanup without later dispatch", async () => {
    const cwd = scannerRepository();
    const root = join(cwd, "scanner-exited-root");
    const killed = join(cwd, "scanner-adopted-supervisor-killed");
    const grandchild = join(cwd, "scanner-adopted-grandchild");
    const moduleUrl = new URL(checkModulePath, import.meta.url).href;
    const fixture = `const fs=require('node:fs');const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',"const fs=require('fs');fs.writeFileSync(process.argv[1],String(process.pid));process.on('SIGTERM',()=>{});setTimeout(()=>{process.kill(process.ppid,'SIGKILL');fs.writeFileSync(process.argv[2],'1')},500);setInterval(()=>{},1000)",${JSON.stringify(grandchild)},${JSON.stringify(killed)}],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(root)},String(process.pid));process.exit(0);`;
    const source = `import fs from 'node:fs';import {runSecurityCheck,executeScanner} from ${JSON.stringify(moduleUrl)};
      let calls=0,toolCalls=0;
      const summary=await runSecurityCheck({cwd:${JSON.stringify(cwd)},
        useTool:async()=>{toolCalls++;throw new Error('unexpected tool');},
        execute:async(_command,_args,directory)=>{
          calls++;
          const controller=new AbortController();
          const watcher=setInterval(()=>{if(fs.existsSync(${JSON.stringify(killed)})){clearInterval(watcher);controller.abort();}},10);
          try{return await executeScanner(process.execPath,['-e',${JSON.stringify(fixture)}],directory,2000,{signal:controller.signal,graceMs:25,cleanupDeadlineMs:1,testStatusFault:'ownership-flood'});}
          finally{clearInterval(watcher);}
        }});
      console.log(JSON.stringify({status:summary.status,lifecycleError:summary.lifecycleError,calls,toolCalls,
        cleanup:summary.steps[0].commands[0].cleanup,
        laterCommands:summary.steps.slice(1).flatMap(step=>step.commands).length,
        stepCount:summary.steps.length}));
      if(summary.status!=='passed')process.exitCode=1;`;
    const caller = spawn(
      process.execPath,
      ["--input-type=module", "-e", source],
      {
        cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const callerIdentity = processIdentity(caller.pid!);
    expect(callerIdentity).not.toBeNull();
    let stdout = "";
    let stderr = "";
    caller.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    caller.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    const completed = new Promise<{
      status: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              "Standalone caller did not naturally exit within 5000ms: " +
                stderr,
            ),
          ),
        5_000,
      );
      caller.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      caller.once("close", (status, signal) => {
        clearTimeout(timer);
        resolve({ status, signal });
      });
    });
    let verified = false;
    try {
      const result = await completed;
      expect(result.signal).toBeNull();
      expect(result.status).toBe(1);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        status: "failed",
        lifecycleError: "SCANNER_CLEANUP_UNKNOWN",
        calls: 1,
        toolCalls: 0,
        cleanup: "unknown",
        laterCommands: 0,
        stepCount: 8,
      });
      for (const marker of [root, grandchild]) {
        const pid = Number(readFileSync(marker, "utf8"));
        const state = (() => {
          try {
            process.kill(pid, 0);
            return "alive";
          } catch {
            return "absent";
          }
        })();
        expect(state).toBe("absent");
      }
      expect(
        JSON.parse(
          readFileSync(join(cwd, ".agent/security/summary.json"), "utf8"),
        ),
      ).toMatchObject({
        status: "failed",
        lifecycleError: "SCANNER_CLEANUP_UNKNOWN",
      });
      verified = true;
    } finally {
      if (!verified && caller.pid) {
        signalOwnedGroup(callerIdentity, "SIGKILL");
      }
    }
  });
  it.each(["unknown", "incomplete", undefined])(
    "stops the pipeline after unproven cleanup %s and retains the failed receipt",
    async (cleanup) => {
      const cwd = scannerRepository();
      let calls = 0;
      let toolCalls = 0;
      const summary = await runSecurityCheck({
        cwd,
        useTool: async () => {
          toolCalls++;
          throw new Error("must not load a tool after unknown cleanup");
        },
        execute: async () => {
          calls++;
          return {
            stdout: audit(),
            stderr: "inert cleanup failure evidence",
            exitCode: 0,
            signal: null,
            error: null,
            timedOut: false,
            overflow: false,
            interrupted: false,
            termination: "none",
            cleanup,
            durationMs: 0,
          };
        },
      });
      expect(calls).toBe(1);
      expect(toolCalls).toBe(0);
      expect(summary.status).toBe("failed");
      expect(summary.lifecycleError).toBe("SCANNER_CLEANUP_UNKNOWN");
      expect(summary.interrupted).toBe(false);
      expect(summary.steps.map((step: any) => step.name)).toEqual(
        REQUIRED_SECURITY_STEPS,
      );
      expect(summary.steps.every((step: any) => step.status === "failed")).toBe(
        true,
      );
      expect(
        summary.steps.slice(1).every((step: any) => step.commands.length === 0),
      ).toBe(true);
      expect(summary.steps[0].commands[0].cleanup).toBe(cleanup);
      expect(
        readFileSync(join(cwd, summary.steps[0].evidence[1].path), "utf8"),
      ).toBe("inert cleanup failure evidence");
      const persisted = JSON.parse(
        readFileSync(join(cwd, ".agent/security/summary.json"), "utf8"),
      );
      expect(persisted.status).toBe("failed");
      expect(persisted.lifecycleError).toBe("SCANNER_CLEANUP_UNKNOWN");
    },
  );
  it.each(["SIGTERM", "SIGINT"])(
    "handles %s in a disposable caller and records an interrupted run",
    (interruption) => {
      const cwd = scannerRepository();
      const moduleUrl = new URL(checkModulePath, import.meta.url).href;
      const source = `import {runSecurityCheck,executeScanner} from ${JSON.stringify(moduleUrl)};
        let calls=0,toolCalls=0;
        const summary=await runSecurityCheck({cwd:${JSON.stringify(cwd)},
          useTool:async()=>{toolCalls++;throw new Error('unexpected tool');},
          execute:async(_command,_args,directory,timeout,options)=>{
            calls++;
            const pending=executeScanner(process.execPath,['-e','setInterval(()=>{},1000)'],directory,timeout,options);
            setTimeout(()=>process.kill(process.pid,${JSON.stringify(interruption)}),10);
            return pending;
          }});
        console.log(JSON.stringify({status:summary.status,interrupted:summary.interrupted,calls,toolCalls,
          stepCount:summary.steps.length,termListeners:process.listenerCount('SIGTERM'),intListeners:process.listenerCount('SIGINT')}));`;
      const result = JSON.parse(
        execFileSync(process.execPath, ["--input-type=module", "-e", source], {
          cwd,
          encoding: "utf8",
          timeout: 5_000,
        }),
      );
      expect(result).toEqual({
        status: "failed",
        interrupted: true,
        calls: 1,
        toolCalls: 0,
        stepCount: 8,
        termListeners: 0,
        intListeners: 0,
      });
      expect(
        JSON.parse(
          readFileSync(join(cwd, ".agent/security/summary.json"), "utf8"),
        ).status,
      ).toBe("failed");
    },
  );
  it.each(["before", "during"])(
    "persists failed state for an abort %s execution without starting later scanners",
    async (when) => {
      const cwd = scannerRepository();
      const controller = new AbortController();
      let calls = 0;
      let toolCalls = 0;
      const termListeners = process.listenerCount("SIGTERM");
      const intListeners = process.listenerCount("SIGINT");
      if (when === "before") controller.abort();
      const summary = await runSecurityCheck({
        cwd,
        signal: controller.signal,
        useTool: async () => {
          toolCalls++;
          throw new Error("must not load a vendor tool");
        },
        execute: async (
          _command: string,
          _args: string[],
          _cwd: string,
          _timeout: number,
          options: { signal: AbortSignal },
        ) => {
          calls++;
          expect(options.signal.aborted).toBe(false);
          controller.abort();
          return {
            stdout: audit(),
            stderr: "",
            exitCode: 0,
            signal: null,
            error: "SCANNER_INTERRUPTED",
            timedOut: false,
            overflow: false,
            interrupted: true,
            termination: "interrupted",
            cleanup: "reaped",
            durationMs: 0,
          };
        },
      });
      expect(calls).toBe(when === "before" ? 0 : 1);
      expect(toolCalls).toBe(0);
      expect(summary.status).toBe("failed");
      expect(summary.interrupted).toBe(true);
      expect(summary.steps.map((step: any) => step.name)).toEqual(
        REQUIRED_SECURITY_STEPS,
      );
      expect(summary.steps.every((step: any) => step.status === "failed")).toBe(
        true,
      );
      expect(
        JSON.parse(
          readFileSync(join(cwd, ".agent/security/summary.json"), "utf8"),
        ).status,
      ).toBe("failed");
      expect(process.listenerCount("SIGTERM")).toBe(termListeners);
      expect(process.listenerCount("SIGINT")).toBe(intListeners);
    },
  );

  it.each(["SIGTERM", "SIGINT"])(
    "fails a standalone pipeline when a ready owned scanner group receives %s",
    async (interruption) => {
      const cwd = scannerRepository();
      const rootReady = join(cwd, "owned-root-ready");
      const childReady = join(cwd, "owned-child-ready");
      const moduleUrl = new URL(checkModulePath, import.meta.url).href;
      const fixture = `const fs=require('node:fs');const {spawn}=require('node:child_process');process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});const c=spawn(process.execPath,['-e',"const fs=require('fs');process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});fs.writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)",${JSON.stringify(childReady)}],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(rootReady)},JSON.stringify({pid:process.pid,child:c.pid}));setInterval(()=>{},1000);`;
      const source = `import {runSecurityCheck,executeScanner} from ${JSON.stringify(moduleUrl)};let calls=0,toolCalls=0;const summary=await runSecurityCheck({cwd:${JSON.stringify(cwd)},useTool:async()=>{toolCalls++;throw Error('later dispatch')},execute:async(_c,_a,d)=>{calls++;return executeScanner(process.execPath,['-e',${JSON.stringify(fixture)}],d,2000,{graceMs:25,cleanupDeadlineMs:500})}});console.log(JSON.stringify({status:summary.status,interrupted:summary.interrupted,calls,toolCalls,receipt:summary.steps[0].commands.length,later:summary.steps.slice(1).flatMap(s=>s.commands).length}));process.exitCode=summary.status==='passed'?0:1;`;
      const caller = spawn(
        process.execPath,
        ["--input-type=module", "-e", source],
        {
          cwd,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const callerIdentity = processIdentity(caller.pid!);
      expect(callerIdentity).not.toBeNull();
      let stdout = "";
      let stderr = "";
      caller.stdout
        .setEncoding("utf8")
        .on("data", (chunk) => (stdout += chunk));
      caller.stderr
        .setEncoding("utf8")
        .on("data", (chunk) => (stderr += chunk));
      const completed = new Promise<{
        status: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`caller timeout: ${stderr}`)),
          5_000,
        );
        caller.once("error", reject);
        caller.once("close", (status, signal) => {
          clearTimeout(timer);
          resolve({ status, signal });
        });
      });
      let verified = false;
      try {
        const waitFor = async (marker: string) => {
          const deadline = Date.now() + 1_500;
          while (!existsSync(marker) && Date.now() < deadline)
            await new Promise((resolve) => setTimeout(resolve, 10));
          expect(existsSync(marker)).toBe(true);
        };
        await waitFor(rootReady);
        await waitFor(childReady);
        const owned = JSON.parse(readFileSync(rootReady, "utf8"));
        const ownedGroup = Number(
          readFileSync(`/proc/${owned.pid}/stat`, "utf8")
            .split(") ")[1]
            .split(" ")[2],
        );
        expect(ownedGroup).toBe(caller.pid);
        expect(signalOwnedGroup(callerIdentity, interruption)).toBe(true);
        const result = await completed;
        expect(result.signal).toBeNull();
        expect(result.status).toBe(1);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual({
          status: "failed",
          interrupted: true,
          calls: 1,
          toolCalls: 0,
          receipt: 1,
          later: 0,
        });
        const persisted = JSON.parse(
          readFileSync(join(cwd, ".agent/security/summary.json"), "utf8"),
        );
        expect(persisted.status).toBe("failed");
        expect(persisted.steps[0].commands).toHaveLength(1);
        expect(
          persisted.steps
            .slice(1)
            .every((step: any) => step.commands.length === 0),
        ).toBe(true);
        for (const pid of [owned.pid, owned.child]) {
          expect(() => process.kill(pid, 0)).toThrow();
        }
        verified = true;
      } finally {
        if (!verified && caller.pid) {
          signalOwnedGroup(callerIdentity, "SIGKILL");
        }
      }
    },
  );

  it("fails the standalone pipeline after guardian-only SIGKILL without later dispatch", async () => {
    const cwd = scannerRepository();
    const rootReady = join(cwd, "guardian-kill-root-ready");
    const childReady = join(cwd, "guardian-kill-child-ready");
    const moduleUrl = new URL(checkModulePath, import.meta.url).href;
    const fixture = `const fs=require('node:fs');const {spawn}=require('node:child_process');process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});const c=spawn(process.execPath,['-e',"const fs=require('fs');process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});fs.writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)",${JSON.stringify(childReady)}],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(rootReady)},JSON.stringify({pid:process.pid,child:c.pid}));setInterval(()=>{},1000);`;
    const source = `import {runSecurityCheck,executeScanner} from ${JSON.stringify(moduleUrl)};let calls=0,toolCalls=0;const summary=await runSecurityCheck({cwd:${JSON.stringify(cwd)},useTool:async()=>{toolCalls++;throw Error('later dispatch')},execute:async(_c,_a,d)=>{calls++;return executeScanner(process.execPath,['-e',${JSON.stringify(fixture)}],d,2000,{graceMs:25,cleanupDeadlineMs:500})}});console.log(JSON.stringify({status:summary.status,calls,toolCalls,receipt:summary.steps[0].commands.length,later:summary.steps.slice(1).flatMap(s=>s.commands).length}));process.exitCode=summary.status==='passed'?0:1;`;
    const caller = spawn(
      process.execPath,
      ["--input-type=module", "-e", source],
      { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const callerIdentity = processIdentity(caller.pid!);
    expect(callerIdentity).not.toBeNull();
    let stdout = "";
    let stderr = "";
    caller.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    caller.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    const completed = new Promise<{
      status: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`caller timeout: ${stderr}`)),
        5_000,
      );
      caller.once("error", reject);
      caller.once("close", (status, signal) => {
        clearTimeout(timer);
        resolve({ status, signal });
      });
    });
    let verified = false;
    try {
      const waitFor = async (marker: string) => {
        const deadline = Date.now() + 1_500;
        while (!existsSync(marker) && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 10));
        expect(existsSync(marker)).toBe(true);
      };
      await waitFor(rootReady);
      await waitFor(childReady);
      const owned = JSON.parse(readFileSync(rootReady, "utf8"));
      const supervisor = Number(
        readFileSync(`/proc/${owned.pid}/stat`, "utf8")
          .split(") ")[1]
          .split(" ")[1],
      );
      const guardian = Number(
        readFileSync(`/proc/${supervisor}/stat`, "utf8")
          .split(") ")[1]
          .split(" ")[1],
      );
      const guardianFields = readFileSync(`/proc/${guardian}/stat`, "utf8")
        .split(") ")[1]
        .split(" ");
      expect(() => process.kill(caller.pid!, 0)).not.toThrow();
      expect(guardianFields[1]).toBe(String(caller.pid));
      expect(guardianFields[2]).toBe(String(caller.pid));
      const guardianStart = guardianFields[19];
      expect(guardianStart).toMatch(/^\d+$/);
      const pidfdKill = `import ctypes, os, signal, sys
pid, caller, expected_start = map(int, sys.argv[1:])
def record(target):
    tail = open(f"/proc/{target}/stat", encoding="utf8").read().rsplit(")", 1)[1].split()
    return int(tail[1]), int(tail[2]), int(tail[19])
before = record(pid)
if before != (caller, caller, expected_start): raise RuntimeError("pre-acquisition ownership mismatch")
fd = os.pidfd_open(pid, 0)
try:
    if record(pid) != before: raise RuntimeError("post-acquisition identity mismatch")
    libc = ctypes.CDLL(None, use_errno=True)
    send = libc.pidfd_send_signal
    send.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint]
    if send(fd, signal.SIGKILL, None, 0): raise OSError(ctypes.get_errno(), "pidfd_send_signal")
finally:
    os.close(fd)`;
      execFileSync(
        "python3",
        [
          "-B",
          "-c",
          pidfdKill,
          String(guardian),
          String(caller.pid),
          guardianStart,
        ],
        { cwd },
      );
      const result = await completed;
      expect(result.signal).toBeNull();
      expect(result.status).toBe(1);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toMatchObject({
        status: "failed",
        calls: 1,
        toolCalls: 0,
        receipt: 1,
        later: 0,
      });
      const persisted = JSON.parse(
        readFileSync(join(cwd, ".agent/security/summary.json"), "utf8"),
      );
      expect(persisted.status).toBe("failed");
      expect(persisted.steps[0].commands[0].cleanup).toBe("unknown");
      expect(
        persisted.steps
          .slice(1)
          .every((step: any) => step.commands.length === 0),
      ).toBe(true);
      for (const pid of [owned.pid, owned.child])
        expect(() => process.kill(pid, 0)).toThrow();
      verified = true;
    } finally {
      if (!verified && caller.pid) signalOwnedGroup(callerIdentity, "SIGKILL");
    }
  });

  it("reaps a late ordinary fork adopted during teardown through the standalone pipeline", async () => {
    const cwd = scannerRepository();
    const rootReady = join(cwd, "late-root-ready");
    const rootHandlerReady = join(cwd, "late-root-handler-ready");
    const rootTerm = join(cwd, "late-root-term");
    const lateReady = join(cwd, "late-child-ready");
    const adopted = join(cwd, "late-child-adopted");
    const moduleUrl = new URL(checkModulePath, import.meta.url).href;
    const fixture = `import os
import signal
import time
ending = [False]
original_root = os.getpid()
def term(_signum, _frame):
    if ending[0]:
        return
    ending[0] = True
    open(${JSON.stringify(rootTerm)}, "w").write(str(os.getpid()))
    pid = os.fork()
    if pid == 0:
        signal.signal(signal.SIGTERM, lambda *_: None)
        open(${JSON.stringify(lateReady)}, "w").write(str(os.getpid()))
        while os.getppid() == original_root:
            time.sleep(.001)
        open(${JSON.stringify(adopted)}, "w").write(f"{os.getpid()}:{os.getppid()}")
        while True:
            time.sleep(1)
    while not os.path.exists(${JSON.stringify(lateReady)}):
        time.sleep(.001)
    os._exit(0)
signal.signal(signal.SIGTERM, term)
open(${JSON.stringify(rootReady)}, "w").write(str(os.getpid()))
open(${JSON.stringify(rootHandlerReady)}, "w").write(str(os.getpid()))
while True:
    time.sleep(1)`;
    const source = `import fs from 'node:fs';import {runSecurityCheck,executeScanner} from ${JSON.stringify(moduleUrl)};let calls=0,toolCalls=0;const controller=new AbortController();const watch=setInterval(()=>{if(fs.existsSync(${JSON.stringify(rootReady)})&&fs.existsSync(${JSON.stringify(rootHandlerReady)})){clearInterval(watch);controller.abort()}},5);const summary=await runSecurityCheck({cwd:${JSON.stringify(cwd)},signal:controller.signal,useTool:async()=>{toolCalls++;throw Error('later dispatch')},execute:async(_c,_a,d)=>{calls++;try{return await executeScanner('python3',['-c',${JSON.stringify(fixture)}],d,2000,{signal:controller.signal,graceMs:25,cleanupDeadlineMs:500})}finally{clearInterval(watch)}}});console.log(JSON.stringify({status:summary.status,interrupted:summary.interrupted,calls,toolCalls,receipt:summary.steps[0].commands.length,later:summary.steps.slice(1).flatMap(s=>s.commands).length}));process.exitCode=summary.status==='passed'?0:1;`;
    const caller = spawn(
      process.execPath,
      ["--input-type=module", "-e", source],
      { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const callerIdentity = processIdentity(caller.pid!);
    expect(callerIdentity).not.toBeNull();
    let stdout = "";
    let stderr = "";
    caller.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    caller.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    const completed = new Promise<{
      status: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`caller timeout: ${stderr}`)),
        5_000,
      );
      caller.once("error", reject);
      caller.once("close", (status, signal) => {
        clearTimeout(timer);
        resolve({ status, signal });
      });
    });
    let verified = false;
    try {
      const result = await completed;
      expect(result.signal).toBeNull();
      expect(result.status).toBe(1);
      expect(stderr).toBe("");
      expect(existsSync(rootTerm)).toBe(true);
      expect(existsSync(lateReady)).toBe(true);
      const adoptionDeadline = Date.now() + 1_500;
      while (!existsSync(adopted) && Date.now() < adoptionDeadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(existsSync(adopted)).toBe(true);
      const rootPid = Number(readFileSync(rootReady, "utf8"));
      const latePid = Number(readFileSync(lateReady, "utf8"));
      const [adoptedPid, adoptedParent] = readFileSync(adopted, "utf8")
        .split(":")
        .map(Number);
      expect(Number(readFileSync(rootTerm, "utf8"))).toBe(rootPid);
      expect(adoptedPid).toBe(latePid);
      expect(adoptedParent).not.toBe(rootPid);
      expect(JSON.parse(stdout)).toEqual({
        status: "failed",
        interrupted: true,
        calls: 1,
        toolCalls: 0,
        receipt: 1,
        later: 0,
      });
      const persisted = JSON.parse(
        readFileSync(join(cwd, ".agent/security/summary.json"), "utf8"),
      );
      expect(persisted.status).toBe("failed");
      for (const marker of [rootReady, rootHandlerReady, lateReady]) {
        const pid = Number(readFileSync(marker, "utf8"));
        expect(() => process.kill(pid, 0)).toThrow();
      }
      verified = true;
    } finally {
      if (!verified && caller.pid) signalOwnedGroup(callerIdentity, "SIGKILL");
    }
  });
});
