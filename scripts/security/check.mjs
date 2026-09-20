import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertNoSymlinkAncestors,
  collectInputFingerprint,
  readRegularFile,
} from "../agent/common.mjs";
import { withVerifiedTool, TOOL_SPECS } from "./tooling.mjs";
import { executeScanner } from "./scanner-process.mjs";
import { isSourceSnapshotExcludedPath } from "../agent/input-path-policy.mjs";

export { executeScanner } from "./scanner-process.mjs";

export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const SECURITY_EVIDENCE_SCHEMA_VERSION = 4;
export const REQUIRED_SECURITY_STEPS = [
  "audit-full",
  "audit-runtime",
  "npm-signatures",
  "sbom-full",
  "sbom-runtime",
  "gitleaks-tree",
  "gitleaks-history",
  "codeql",
];
export class SecurityCheckError extends Error {
  constructor(message, code = "SECURITY_CHECK_FAILED") {
    super(message);
    this.name = "SecurityCheckError";
    this.code = code;
  }
}
const fail = (message, code) => {
  throw new SecurityCheckError(message, code);
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const writeJson = (path, value) => {
  assertNoSymlinkAncestors(path);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + "." + randomUUID() + ".tmp";
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  renameSync(temporary, path);
};
const git = (cwd, args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const json = (text, label) => {
  try {
    return JSON.parse(text);
  } catch {
    return fail(label + " is not JSON.", "SCANNER_JSON_INVALID");
  }
};
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const levels = ["info", "low", "moderate", "high", "critical"];

export const parseAudit = (text, scope) => {
  const value = json(text, scope + " audit");
  if (
    value.error ||
    value.auditReportVersion !== 2 ||
    !object(value.vulnerabilities) ||
    !object(value.metadata?.vulnerabilities)
  )
    fail(scope + " audit schema is unsupported.", "AUDIT_SCHEMA_INVALID");
  const counts = value.metadata.vulnerabilities;
  if (
    [...levels, "total"].some(
      (key) => !Number.isSafeInteger(counts[key]) || counts[key] < 0,
    ) ||
    levels.reduce((sum, key) => sum + counts[key], 0) !== counts.total
  )
    fail("Audit counts are invalid.", "AUDIT_SCHEMA_INVALID");
  const findings = Object.entries(value.vulnerabilities).map(
    ([name, entry]) => {
      if (
        !object(entry) ||
        !levels.includes(entry.severity) ||
        !Array.isArray(entry.via) ||
        !Array.isArray(entry.nodes) ||
        !entry.nodes.length ||
        entry.nodes.some((path) => typeof path !== "string") ||
        typeof entry.range !== "string"
      )
        fail("Audit finding is malformed.", "AUDIT_FINDING_INVALID");
      return {
        name,
        severity: entry.severity,
        via: entry.via,
        nodes: entry.nodes,
        range: entry.range,
        fixAvailable: entry.fixAvailable,
      };
    },
  );
  if (
    findings.length !== counts.total ||
    levels.some(
      (level) =>
        findings.filter((entry) => entry.severity === level).length !==
        counts[level],
    )
  )
    fail("Audit findings and totals disagree.", "AUDIT_SCHEMA_INVALID");
  return { scope, findings, metadata: counts };
};

export const validateExceptions = (value, now = new Date()) => {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.exceptions))
    fail("Exception policy is malformed.", "EXCEPTIONS_INVALID");
  const ids = new Set();
  for (const entry of value.exceptions) {
    const fields = [
      "id",
      "advisory",
      "package",
      "version",
      "path",
      "applicability",
      "ownerApproval",
      "mitigation",
      "expiresAt",
      "retestCondition",
    ];
    if (
      !entry ||
      fields.some((key) => typeof entry[key] !== "string" || !entry[key].trim())
    )
      fail("Security exception is incomplete.", "EXCEPTION_INCOMPLETE");
    if (ids.has(entry.id))
      fail("Security exception is duplicated.", "EXCEPTION_DUPLICATE");
    ids.add(entry.id);
    if (
      !Number.isFinite(Date.parse(entry.expiresAt)) ||
      Date.parse(entry.expiresAt) <= now.valueOf()
    )
      fail("Security exception is expired.", "EXCEPTION_EXPIRED");
  }
  // No owner-approved exceptions exist for this mission. A text field cannot
  // create approval; admitting any exception requires a reviewed policy change.
  if (value.exceptions.length)
    fail(
      "No owner-approved exception is configured; require independent owner review, never self-approval.",
      "EXCEPTION_UNAPPROVED",
    );
  return [];
};

export const validateSarif = (value, expectedTool = "CodeQL") => {
  if (
    value?.version !== "2.1.0" ||
    !Array.isArray(value.runs) ||
    value.runs.length !== 1
  )
    fail("SARIF must contain exactly one run.", "SARIF_INVALID");
  const run = value.runs[0];
  if (
    run?.tool?.driver?.name !== expectedTool ||
    !Array.isArray(run.results) ||
    !Array.isArray(run.tool.driver.rules) ||
    !run.tool.driver.rules.length
  )
    fail("SARIF tool, rules or results are invalid.", "SARIF_INVALID");
  if (
    !Array.isArray(run.invocations) ||
    run.invocations.length !== 1 ||
    run.invocations[0].executionSuccessful !== true
  )
    fail(
      "SARIF execution did not succeed or is incomplete.",
      "SARIF_EXECUTION_FAILED",
    );
  for (const key of [
    "toolExecutionNotifications",
    "toolConfigurationNotifications",
  ]) {
    const notes = run.invocations[0][key] ?? [];
    if (
      !Array.isArray(notes) ||
      notes.some((note) => !["none", "note"].includes(note.level))
    )
      fail("SARIF has execution notifications.", "SARIF_NOTIFICATION");
  }
  for (const entry of run.results) {
    const rule = run.tool.driver.rules.find((rule) => rule.id === entry.ruleId);
    const level = entry.level ?? rule?.defaultConfiguration?.level ?? "warning";
    if (
      !rule ||
      !["none", "note", "warning", "error"].includes(level) ||
      typeof entry.message?.text !== "string"
    )
      fail("SARIF result schema is incomplete.", "SARIF_INVALID");
    const securitySeverity = Number(
      rule.properties?.["security-severity"] ?? 0,
    );
    if (
      ["warning", "error"].includes(level) ||
      !Number.isFinite(securitySeverity) ||
      securitySeverity > 0
    )
      fail("SARIF has unapproved findings.", "SARIF_FINDINGS");
    if (entry.suppressions?.length)
      fail("SARIF contains unreviewed suppressions.", "SARIF_SUPPRESSION");
  }
  return {
    tool: expectedTool,
    results: run.results.length,
    rules: run.tool.driver.rules.length,
  };
};
export const parseSignatures = (text) => {
  const audited = Number(text.match(/audited (\d+) packages? in /)?.[1]);
  const signatures = Number(
    text.match(
      /(\d+) packages? ha(?:s|ve) a? ?verified registry signatures?/,
    )?.[1],
  );
  const attestations = Number(
    text.match(/(\d+) packages? ha(?:s|ve) a? ?verified attestations?/)?.[1] ??
      0,
  );
  if (
    !Number.isSafeInteger(audited) ||
    audited <= 0 ||
    signatures !== audited ||
    !Number.isSafeInteger(attestations) ||
    attestations > audited ||
    /(?:missing|invalid) registry signature|invalid attestation/i.test(text)
  )
    fail(
      "Signature coverage is invalid, unsupported or incomplete.",
      "SIGNATURE_COVERAGE_UNKNOWN",
    );
  return {
    audited,
    signatures,
    attestations,
    scope:
      "Installed packages on registries supplying signing keys; not every cross-platform lock entry or package has provenance.",
  };
};
export const validateSbom = (value) => {
  if (
    value?.bomFormat !== "CycloneDX" ||
    !["1.4", "1.5", "1.6"].includes(value.specVersion) ||
    !Array.isArray(value.components) ||
    !value.components.length ||
    value.components.some(
      (entry) =>
        typeof entry.name !== "string" || typeof entry.version !== "string",
    )
  )
    fail("SBOM is empty or unsupported.", "SBOM_SCHEMA_INVALID");
  return {
    components: value.components.length,
    specVersion: value.specVersion,
  };
};
export const sanitizePaths = (value, cwd, additional = []) => {
  if (typeof value === "string") {
    for (const path of [resolve(cwd), ...additional, homedir()])
      value = value.replaceAll(path, ".");
    return value;
  }
  if (Array.isArray(value))
    return value.map((entry) => sanitizePaths(entry, cwd, additional));
  if (object(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sanitizePaths(entry, cwd, additional),
      ]),
    );
  return value;
};

const requireExecution = (result, allowed = [0]) => {
  if (
    result.error ||
    result.signal ||
    result.timedOut ||
    result.overflow ||
    result.interrupted !== false ||
    result.cleanup !== "reaped" ||
    result.termination !== "none" ||
    !allowed.includes(result.exitCode)
  )
    fail(
      "Scanner failed, timed out or was interrupted; inspect its redacted evidence.",
      "SCANNER_EXECUTION_FAILED",
    );
};
const fileEvidence = (cwd, path) => {
  const bytes = readRegularFile(path);
  return {
    path: relative(cwd, path).replaceAll("\\", "/"),
    sha256: hash(bytes),
    bytes: bytes.length,
  };
};
const currentIdentity = (cwd) => {
  const value = collectInputFingerprint({ cwd });
  return {
    head: value.head,
    tree: value.tree,
    sourceInputDigest: value.digest,
    runtime: value.runtime,
    historyRefs: git(cwd, ["for-each-ref", "--format=%(refname) %(objectname)"])
      .trim()
      .split("\n")
      .filter(Boolean),
    shallow: git(cwd, ["rev-parse", "--is-shallow-repository"]).trim(),
  };
};
const safeFindings = (findings) =>
  findings.map((entry) => ({
    file: entry.File,
    line: entry.StartLine,
    rule: entry.RuleID,
    commit: entry.Commit,
    identifier: entry.Fingerprint,
  }));
const validateLeaks = (value) => {
  if (
    !Array.isArray(value) ||
    value.some(
      (entry) =>
        !object(entry) ||
        typeof entry.RuleID !== "string" ||
        typeof entry.File !== "string" ||
        !Number.isInteger(entry.StartLine),
    )
  )
    fail("Gitleaks report is malformed.", "GITLEAKS_REPORT_INVALID");
  if (value.length)
    fail(
      "Potential secret findings require private owner triage; do not publish or test credentials.",
      "GITLEAKS_FINDINGS",
    );
  return { findings: 0 };
};

const collectSecurityCheck = async ({ cwd, execute, useTool, signal }) => {
  const started = new Date();
  const runId = randomUUID();
  const root = join(cwd, ".agent/security/runs", runId);
  assertNoSymlinkAncestors(root);
  mkdirSync(root, { recursive: true });
  // Invalidate any previous successful receipt before even prerequisite reads.
  const running = {
    schemaVersion: SECURITY_EVIDENCE_SCHEMA_VERSION,
    runId,
    generatedAt: started.toISOString(),
    completedAt: null,
    status: "running",
    steps: [],
  };
  writeJson(join(root, "summary.json"), running);
  writeJson(join(cwd, ".agent/security/summary.json"), running);
  const before = currentIdentity(cwd);
  validateExceptions(
    json(
      readFileSync(join(cwd, "scripts/security/exceptions.json"), "utf8"),
      "Exceptions",
    ),
    started,
  );
  const source = mkdtempSync(join(tmpdir(), "wanderer-security-source-"));
  const steps = [];
  const tools = {};
  const privateCommands = new Map();
  const privateRoots = [];
  let lifecycleError = null;
  let terminalCleanupError = null;
  const assertNotInterrupted = () => {
    if (terminalCleanupError)
      fail(
        "Scanner cleanup is unproven; later commands are disabled.",
        terminalCleanupError,
      );
    if (signal.aborted)
      fail("Security scan was interrupted.", "SCANNER_INTERRUPTED");
  };
  const withTool = (name, operation) => {
    assertNotInterrupted();
    return useTool(cwd, name, async (tool) => {
      const suffix = "/tool/" + TOOL_SPECS[name].binary;
      const binary = resolve(tool.binary);
      if (
        !binary.endsWith(suffix) ||
        binary.startsWith(resolve(cwd, ".agent") + "/")
      )
        fail(
          "Scanner execution is not private archive scoped.",
          "SECURITY_TOOL_EXECUTION_SCOPE",
        );
      const privateRoot = binary.slice(0, -suffix.length);
      const logical = verifiedCommand(name);
      privateRoots.push(privateRoot);
      privateCommands.set(binary, logical);
      tools[name] = {
        binary: logical,
        execution: "private-archive-callback-v1",
        version: tool.version,
        sha256: tool.sha256,
        binarySha256: tool.binarySha256,
        contentSha256: tool.contentSha256,
        files: tool.files,
      };
      try {
        assertNotInterrupted();
        return await operation(tool);
      } finally {
        privateCommands.delete(binary);
      }
    });
  };
  const step = async (name, operation) => {
    const evidence = [];
    const commands = [];
    const save = (label, content) => {
      const path = join(root, name + "-" + label);
      writeFileSync(path, content, { mode: 0o600 });
      evidence.push(fileEvidence(cwd, path));
      return path;
    };
    const run = async (command, args, directory = cwd, timeoutMs = 240_000) => {
      const startedAt = new Date().toISOString();
      assertNotInterrupted();
      const result = await execute(command, args, directory, timeoutMs, {
        signal,
      });
      const finishedAt = new Date().toISOString();
      const receipt = {
        command: privateCommands.get(command) ?? command,
        args: sanitizePaths(args, cwd, [source]),
        cwd: sanitizePaths(resolve(directory), cwd, [source]),
        timeoutMs,
        startedAt,
        finishedAt,
        exitCode: result.exitCode,
        signal: result.signal,
        error: result.error,
        timedOut: result.timedOut,
        overflow: result.overflow,
        interrupted: result.interrupted,
        termination: result.termination,
        cleanup: result.cleanup,
        durationMs: result.durationMs,
      };
      commands.push(receipt);
      save(
        commands.length + ".stdout",
        sanitizePaths(result.stdout, cwd, [source, ...privateRoots]),
      );
      save(
        commands.length + ".stderr",
        sanitizePaths(result.stderr, cwd, [source, ...privateRoots]),
      );
      if (result.cleanup !== "reaped") {
        terminalCleanupError = "SCANNER_CLEANUP_UNKNOWN";
        lifecycleError = terminalCleanupError;
        assertNotInterrupted();
      }
      return result;
    };
    try {
      assertNotInterrupted();
      const detail = await operation({ run, save, evidence });
      steps.push({ name, status: "passed", detail, commands, evidence });
    } catch (error) {
      steps.push({
        name,
        status: "failed",
        reason: error.code || "SCANNER_UNKNOWN",
        commands,
        evidence,
      });
    }
    writeJson(join(root, "progress.json"), { runId, steps });
  };
  try {
    const inputs = [
      ...new Set(
        git(cwd, [
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "-z",
        ])
          .split("\0")
          .filter(Boolean),
      ),
    ].filter((path) => !isSourceSnapshotExcludedPath(path));
    for (const path of inputs) {
      const input = join(cwd, path);
      assertNoSymlinkAncestors(input);
      if (!existsSync(input)) continue;
      if (!lstatSync(input).isFile())
        fail(
          "Unsupported secret/static scan input type.",
          "SCANNER_INPUT_INVALID",
        );
      const target = join(source, path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(input, target);
    }
    for (const [scope, args] of [
      ["full", []],
      ["runtime", ["--omit=dev"]],
    ])
      await step("audit-" + scope, async ({ run }) => {
        const result = await run("npm", ["audit", "--json", ...args]);
        const report = parseAudit(result.stdout, scope);
        requireExecution(result, [0, 1]);
        if (report.findings.length)
          fail("Unapproved dependency findings.", "UNAPPROVED_FINDINGS");
        requireExecution(result);
        return report;
      });
    await step("npm-signatures", async ({ run }) => {
      const result = await run("npm", ["audit", "signatures", "--color=false"]);
      requireExecution(result);
      return parseSignatures(result.stdout);
    });
    for (const [scope, args] of [
      ["full", []],
      ["runtime", ["--omit=dev"]],
    ])
      await step("sbom-" + scope, async ({ run, save }) => {
        const result = await run("npm", [
          "sbom",
          "--sbom-format",
          "cyclonedx",
          "--package-lock-only",
          ...args,
        ]);
        requireExecution(result);
        const report = json(result.stdout, "SBOM");
        const detail = validateSbom(report);
        save(
          "identity.json",
          JSON.stringify({ identity: before, scope, detail }),
        );
        return detail;
      });
    const leakArgs = [
      "--config",
      join(cwd, "scripts/security/gitleaks.toml"),
      "--redact=100",
      "--report-format=json",
      "--exit-code=1",
      "--no-banner",
      "--no-color",
      "--ignore-gitleaks-allow",
      "--timeout=180",
    ];
    try {
      await withTool("gitleaks", async (leaks) => {
        for (const scope of ["tree", "history"])
          await step("gitleaks-" + scope, async ({ run, save }) => {
            if (
              scope === "history" &&
              git(cwd, ["rev-parse", "--is-shallow-repository"]).trim() !==
                "false"
            )
              fail("Fetched history is shallow.", "SHALLOW_HISTORY");
            const reportPath = join(root, "gitleaks-" + scope + "-raw.json");
            const args =
              scope === "tree"
                ? ["dir", source]
                : ["git", cwd, "--log-opts=--all HEAD"];
            const result = await run(leaks.binary, [
              ...args,
              ...leakArgs,
              "--report-path",
              reportPath,
            ]);
            if (!existsSync(reportPath))
              fail("Gitleaks report missing.", "GITLEAKS_REPORT_MISSING");
            const report = json(
              readFileSync(reportPath, "utf8"),
              "Gitleaks report",
            );
            save(
              "findings.json",
              JSON.stringify(
                sanitizePaths(
                  Array.isArray(report) ? safeFindings(report) : report,
                  cwd,
                  [source],
                ),
              ),
            );
            requireExecution(result, [0, 1]);
            const detail = validateLeaks(report);
            requireExecution(result);
            if (scope === "tree")
              return {
                ...detail,
                inputFiles: inputs.length,
                untrackedIncluded: true,
                excluded:
                  "Only reviewed generated output/dependency caches; source tests/docs are included.",
              };
            const refs = git(cwd, [
              "for-each-ref",
              "--format=%(refname) %(objectname)",
            ])
              .trim()
              .split("\n")
              .filter(Boolean);
            const count = Number(
              git(cwd, ["rev-list", "--all", "HEAD", "--count"]).trim(),
            );
            save(
              "refs.json",
              JSON.stringify({
                head: before.head,
                refs,
                range: "--all HEAD",
                commits: count,
                shallow: false,
              }),
            );
            return {
              ...detail,
              refs,
              range: "--all HEAD",
              commits: count,
              shallow: false,
            };
          });
      });
    } catch (error) {
      lifecycleError = error.code || "TOOL_LIFECYCLE_FAILED";
      for (const scope of ["tree", "history"]) {
        const name = "gitleaks-" + scope;
        if (!steps.some((entry) => entry.name === name))
          await step(name, () => {
            throw error;
          });
      }
    }
    await step("codeql", ({ run, save }) =>
      withTool("codeql", async (tool) => {
        const database = join(cwd, ".agent/security/codeql-db", runId);
        assertNoSymlinkAncestors(database);
        mkdirSync(dirname(database), { recursive: true });
        const created = await run(
          tool.binary,
          [
            "database",
            "create",
            database,
            "--language=javascript-typescript",
            "--source-root",
            source,
            "--build-mode=none",
            "--codescanning-config",
            join(source, ".github/codeql-config.yml"),
            "--threads=2",
            "--ram=2048",
          ],
          cwd,
          600_000,
        );
        requireExecution(created);
        const reportPath = join(root, "codeql-raw.sarif");
        const analyzed = await run(
          tool.binary,
          [
            "database",
            "analyze",
            database,
            "codeql/javascript-queries:codeql-suites/javascript-security-and-quality.qls",
            "--format=sarif-latest",
            "--output",
            reportPath,
            "--threads=2",
            "--ram=2048",
            "--no-sarif-add-snippets",
            "--no-sarif-add-file-contents",
          ],
          cwd,
          900_000,
        );
        requireExecution(analyzed);
        const report = json(readFileSync(reportPath, "utf8"), "SARIF");
        save(
          "report.sarif",
          JSON.stringify(sanitizePaths(report, cwd, [source, ...privateRoots])),
        );
        return validateSarif(report);
      }),
    );
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
  let after;
  let drift = null;
  try {
    after = currentIdentity(cwd);
    if (JSON.stringify(before) !== JSON.stringify(after))
      drift = "SOURCE_CHANGED_DURING_SCAN";
  } catch {
    drift = "SOURCE_UNREADABLE_AFTER_SCAN";
  }
  const summary = {
    schemaVersion: SECURITY_EVIDENCE_SCHEMA_VERSION,
    runId,
    generatedAt: started.toISOString(),
    completedAt: new Date().toISOString(),
    freshnessDeadline: new Date(started.valueOf() + MAX_AGE_MS).toISOString(),
    identity: before,
    inputAfter: after,
    tools,
    steps,
    interrupted: signal.aborted,
    lifecycleError,
    status:
      !signal.aborted &&
      !lifecycleError &&
      !drift &&
      steps.length === REQUIRED_SECURITY_STEPS.length &&
      steps.every((entry) => entry.status === "passed")
        ? "passed"
        : "failed",
    drift,
  };
  if (summary.status === "passed") {
    try {
      validateSecuritySummary({
        summary,
        identity: after,
        exceptions: json(
          readRegularFile(
            join(cwd, "scripts/security/exceptions.json"),
            "utf8",
          ),
          "Exceptions",
        ),
        readEvidence: (path) => readRegularFile(join(cwd, path)),
      });
    } catch (error) {
      summary.status = "failed";
      summary.receiptError = error.code || "SECURITY_RECEIPT_INVALID";
    }
  }
  writeJson(join(root, "summary.json"), summary);
  writeJson(join(cwd, ".agent/security/summary.json"), summary);
  return summary;
};

// The listeners belong to one invocation and are always removed; SIGKILL cannot
// flush a receipt, so an externally killed run remains running/incomplete.
export const runSecurityCheck = async ({
  cwd = process.cwd(),
  execute = executeScanner,
  useTool = withVerifiedTool,
  signal,
} = {}) => {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on("SIGTERM", interrupt);
  process.on("SIGINT", interrupt);
  signal?.addEventListener("abort", interrupt, { once: true });
  if (signal?.aborted) interrupt();
  try {
    return await collectSecurityCheck({
      cwd,
      execute,
      useTool,
      signal: controller.signal,
    });
  } finally {
    process.removeListener("SIGTERM", interrupt);
    process.removeListener("SIGINT", interrupt);
    signal?.removeEventListener("abort", interrupt);
  }
};
const verifiedCommand = (name) =>
  "@verified/" + name + "/" + TOOL_SPECS[name].binary;

// Exact supported invocation contract. Unknown command/scope shapes fail, even
// when their supplied exit code and report hashes claim success.
const expectedInvocations = (name, runId) => {
  const root = "./.agent/security/runs/" + runId;
  const db = "./.agent/security/codeql-db/" + runId;
  const make = (command, args, timeoutMs = 240_000) => ({
    command,
    args,
    cwd: ".",
    timeoutMs,
  });
  if (name.startsWith("audit-"))
    return [
      make("npm", [
        "audit",
        "--json",
        ...(name === "audit-runtime" ? ["--omit=dev"] : []),
      ]),
    ];
  if (name === "npm-signatures")
    return [make("npm", ["audit", "signatures", "--color=false"])];
  if (name.startsWith("sbom-"))
    return [
      make("npm", [
        "sbom",
        "--sbom-format",
        "cyclonedx",
        "--package-lock-only",
        ...(name === "sbom-runtime" ? ["--omit=dev"] : []),
      ]),
    ];
  if (name.startsWith("gitleaks-"))
    return [
      make(verifiedCommand("gitleaks"), [
        ...(name === "gitleaks-tree"
          ? ["dir", "."]
          : ["git", ".", "--log-opts=--all HEAD"]),
        "--config",
        "./scripts/security/gitleaks.toml",
        "--redact=100",
        "--report-format=json",
        "--exit-code=1",
        "--no-banner",
        "--no-color",
        "--ignore-gitleaks-allow",
        "--timeout=180",
        "--report-path",
        root + "/" + name + "-raw.json",
      ]),
    ];
  return [
    make(
      verifiedCommand("codeql"),
      [
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
      600_000,
    ),
    make(
      verifiedCommand("codeql"),
      [
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
      900_000,
    ),
  ];
};
const expectedReports = (name) =>
  name.startsWith("sbom-")
    ? [name + "-identity.json"]
    : name === "gitleaks-tree"
      ? [name + "-findings.json"]
      : name === "gitleaks-history"
        ? [name + "-findings.json", name + "-refs.json"]
        : name === "codeql"
          ? ["codeql-report.sarif"]
          : [];

export const validateSecuritySummary = ({
  summary,
  identity,
  now = new Date(),
  readEvidence,
  exceptions,
}) => {
  validateExceptions(exceptions, now);
  const start = Date.parse(summary?.generatedAt);
  const end = Date.parse(summary?.completedAt);
  const deadline = Date.parse(summary?.freshnessDeadline);
  if (
    summary?.schemaVersion !== SECURITY_EVIDENCE_SCHEMA_VERSION ||
    !/^[a-f0-9-]{36}$/.test(summary.runId ?? "") ||
    summary.status !== "passed" ||
    summary.drift ||
    summary.interrupted !== false ||
    summary.lifecycleError !== null ||
    !Array.isArray(summary.steps) ||
    JSON.stringify(summary.steps.map((step) => step.name)) !==
      JSON.stringify(REQUIRED_SECURITY_STEPS)
  )
    fail(
      "Security evidence is failed or incomplete.",
      "SECURITY_EVIDENCE_INCOMPLETE",
    );
  if (
    ![start, end, deadline].every(Number.isFinite) ||
    end < start ||
    end > now.valueOf() + 60_000 ||
    start > now.valueOf() ||
    deadline !== start + MAX_AGE_MS ||
    now.valueOf() >= deadline
  )
    fail(
      "Security evidence timestamps are stale or invalid.",
      "SECURITY_EVIDENCE_STALE",
    );
  if (
    JSON.stringify(summary.identity) !== JSON.stringify(identity) ||
    JSON.stringify(summary.inputAfter) !== JSON.stringify(identity)
  )
    fail(
      "Security evidence belongs to foreign or changed inputs.",
      "SECURITY_EVIDENCE_FOREIGN",
    );
  for (const name of ["gitleaks", "codeql"])
    if (
      summary.tools?.[name]?.version !== TOOL_SPECS[name].version ||
      summary.tools[name].sha256 !== TOOL_SPECS[name].archiveSha256 ||
      summary.tools[name].binary !== verifiedCommand(name) ||
      summary.tools[name].execution !== "private-archive-callback-v1" ||
      !/^[a-f0-9]{64}$/.test(summary.tools[name].binarySha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(summary.tools[name].contentSha256 ?? "")
    )
      fail(
        "Scanner tool identity missing or foreign.",
        "SECURITY_TOOL_IDENTITY",
      );
  let previousCommandEnd = start;
  for (const step of summary.steps) {
    const invocations = expectedInvocations(step.name, summary.runId);
    const expectedNames = [
      ...invocations.flatMap((_, index) => [
        step.name + "-" + (index + 1) + ".stdout",
        step.name + "-" + (index + 1) + ".stderr",
      ]),
      ...expectedReports(step.name),
    ];
    const expectedPaths = expectedNames.map(
      (name) => ".agent/security/runs/" + summary.runId + "/" + name,
    );
    if (
      step.status !== "passed" ||
      !Array.isArray(step.commands) ||
      step.commands.length !== invocations.length ||
      !Array.isArray(step.evidence) ||
      JSON.stringify(step.evidence.map((entry) => entry.path)) !==
        JSON.stringify(expectedPaths)
    )
      fail(
        "Scanner execution/log/report membership is incomplete or duplicated.",
        "SECURITY_EVIDENCE_INCOMPLETE",
      );
    for (const [index, command] of step.commands.entries()) {
      const expected = invocations[index];
      const commandStart = Date.parse(command.startedAt);
      const commandEnd = Date.parse(command.finishedAt);
      if (
        !object(command) ||
        JSON.stringify({
          command: command.command,
          args: command.args,
          cwd: command.cwd,
          timeoutMs: command.timeoutMs,
        }) !== JSON.stringify(expected) ||
        command.exitCode !== 0 ||
        command.signal !== null ||
        command.error !== null ||
        command.timedOut !== false ||
        command.overflow !== false ||
        command.interrupted !== false ||
        command.termination !== "none" ||
        command.cleanup !== "reaped" ||
        ![commandStart, commandEnd, command.durationMs].every(
          Number.isFinite,
        ) ||
        commandStart < previousCommandEnd ||
        commandEnd < commandStart ||
        commandEnd > end ||
        command.durationMs < 0 ||
        command.durationMs > command.timeoutMs ||
        Math.abs(commandEnd - commandStart - command.durationMs) > 1_000
      )
        fail(
          "Scanner invocation, scope, cwd or timing is invalid.",
          "SECURITY_EXECUTION_INVALID",
        );
      previousCommandEnd = commandEnd;
    }
    const outputs = new Map();
    for (const evidence of step.evidence) {
      if (
        !new RegExp(
          "^\\.agent/security/runs/" + summary.runId + "/[a-z0-9.-]+$",
        ).test(evidence.path) ||
        !/^[a-f0-9]{64}$/.test(evidence.sha256 ?? "")
      )
        fail(
          "Scanner evidence path/schema is invalid.",
          "SECURITY_EVIDENCE_INVALID",
        );
      const content = readEvidence(evidence.path);
      if (
        !Number.isSafeInteger(evidence.bytes) ||
        evidence.bytes < 0 ||
        Buffer.byteLength(content) !== evidence.bytes ||
        hash(content) !== evidence.sha256
      )
        fail("Scanner evidence log changed.", "SECURITY_EVIDENCE_CHANGED");
      outputs.set(evidence.path.split("/").at(-1), String(content));
    }
    const stdout = outputs.get(step.name + "-1.stdout");
    if (step.name.startsWith("audit-")) {
      if (parseAudit(stdout, step.name).findings.length)
        fail("Unapproved dependency findings.", "UNAPPROVED_FINDINGS");
    } else if (step.name === "npm-signatures") parseSignatures(stdout);
    else if (step.name.startsWith("sbom-")) {
      const detail = validateSbom(json(stdout, "SBOM"));
      const report = json(
        outputs.get(step.name + "-identity.json"),
        "SBOM identity",
      );
      if (
        JSON.stringify(report?.identity) !== JSON.stringify(identity) ||
        report.scope !== step.name.slice(5) ||
        JSON.stringify(report.detail) !== JSON.stringify(detail)
      )
        fail(
          "SBOM report identity or scope is foreign.",
          "SECURITY_EVIDENCE_FOREIGN",
        );
    } else if (step.name === "codeql")
      validateSarif(json(outputs.get("codeql-report.sarif"), "SARIF"));
    else {
      validateLeaks(
        json(outputs.get(step.name + "-findings.json"), "Secret findings"),
      );
      if (step.name === "gitleaks-history") {
        const report = json(
          outputs.get("gitleaks-history-refs.json"),
          "History identity",
        );
        if (
          !object(report) ||
          report.head !== identity.head ||
          report.range !== "--all HEAD" ||
          report.shallow !== false ||
          identity.shallow !== "false" ||
          !Array.isArray(report.refs) ||
          JSON.stringify(report.refs) !==
            JSON.stringify(identity.historyRefs) ||
          !Number.isSafeInteger(report.commits) ||
          report.commits < 1
        )
          fail(
            "Secret scan history identity or scope is incomplete.",
            "SECURITY_EVIDENCE_FOREIGN",
          );
      }
    }
  }
  return summary;
};
export const validateSecurityEvidence = ({
  cwd = process.cwd(),
  now = new Date(),
} = {}) => {
  const path = join(cwd, ".agent/security/summary.json");
  assertNoSymlinkAncestors(path);
  if (!existsSync(path))
    fail("Security evidence is missing.", "SECURITY_EVIDENCE_MISSING");
  return validateSecuritySummary({
    summary: json(readRegularFile(path, "utf8"), "Security summary"),
    identity: currentIdentity(cwd),
    now,
    exceptions: json(
      readRegularFile(join(cwd, "scripts/security/exceptions.json"), "utf8"),
      "Exceptions",
    ),
    readEvidence: (path) => {
      const absolute = join(cwd, path);
      assertNoSymlinkAncestors(absolute);
      return readRegularFile(absolute);
    },
  });
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  Promise.resolve()
    .then(() => {
      if (process.argv.length !== 2)
        fail("Usage: node scripts/security/check.mjs", "INVALID_ARGUMENT");
      return runSecurityCheck();
    })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (result.status !== "passed") process.exitCode = 1;
    })
    .catch((error) => {
      console.error(
        (error.code || "SECURITY_CHECK_FAILED") + ": " + error.message,
      );
      process.exitCode = 1;
    });
}
