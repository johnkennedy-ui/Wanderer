import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  constants,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join, relative, resolve, sep } from "node:path";
import {
  OUTPUT_ONLY_ROOTS,
  assertInputReferences,
  isDependencyOutputPath,
  isSourceSnapshotExcludedPath,
} from "./input-path-policy.mjs";

export const AGENT_DIRECTORY = ".agent";
export const REQUIRED_BASELINE = "a4c74f9";
export const SUPPORTED_NODE_MAJOR = 22;
export const AGENT_EVIDENCE_SCHEMA_VERSION = 2;
export const AGENT_POLICY_VERSION = "wanderer-agent-v2";

export class AgentError extends Error {
  constructor(message, code = "AGENT_ERROR") {
    super(message);
    this.name = "AgentError";
    this.code = code;
  }
}

export const agentPath = (cwd, ...segments) =>
  join(cwd, AGENT_DIRECTORY, ...segments);

export const ensureAgentDirectory = (cwd, ...segments) => {
  const directory = agentPath(cwd, ...segments);
  assertNoSymlinkAncestors(directory);
  mkdirSync(directory, { recursive: true });
  return directory;
};

export const writeJsonAtomic = (path, value) => {
  assertNoSymlinkAncestors(path);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
};

export const readJson = (path) => JSON.parse(readRegularFile(path, "utf8"));

export const missionStatePath = (cwd) => agentPath(cwd, "mission.json");

export const readMissionState = (cwd) => {
  const path = missionStatePath(cwd);
  assertNoSymlinkAncestors(path);
  if (!existsSync(path))
    throw new AgentError(
      "No .agent/mission.json exists. Run npm run agent:mission-start first.",
      "MISSION_NOT_STARTED",
    );
  return readJson(path);
};

export const writeMissionState = (cwd, state) => {
  ensureAgentDirectory(cwd);
  writeJsonAtomic(missionStatePath(cwd), state);
};

export const gitOutput = (cwd, args) => {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = String(
      error.stderr || error.message || "git command failed",
    ).trim();
    throw new AgentError(
      `git ${args.join(" ")} failed: ${detail}`,
      "GIT_COMMAND_FAILED",
    );
  }
};

export const gitSucceeds = (cwd, args) => {
  try {
    execFileSync("git", args, { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

export const npmVersion = (cwd) => {
  try {
    return execFileSync("npm", ["--version"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = String(
      error.stderr ?? error.message ?? "npm --version failed",
    ).trim();
    throw new AgentError(
      `Unable to read npm version: ${detail}`,
      "NPM_UNAVAILABLE",
    );
  }
};

export const normaliseRepositoryPath = (path) => path.split(sep).join("/");

export const isApprovedSpecification = (path) =>
  /^FRANK_.+\.md$/i.test(basename(path));

const isAgentRuntimeOrDependencyPath = (path) =>
  /^(?:\.agent|node_modules)(?:\/|$)/.test(normaliseRepositoryPath(path));

export const parseGitStatus = (output) => {
  const parts = output
    .split(output.includes("\0") ? "\0" : "\n")
    .filter(Boolean);
  const entries = [];
  for (let index = 0; index < parts.length; index += 1) {
    const line = parts[index];
    const entry = { status: line.slice(0, 2), path: line.slice(3) };
    if (output.includes("\0") && /[RC]/.test(entry.status))
      entry.previousPath = parts[++index];
    entries.push(entry);
  }
  const untracked = entries.filter((entry) => entry.status === "??");
  const tracked = entries.filter((entry) => entry.status !== "??");
  const approvedUntrackedSpecifications = untracked
    .filter((entry) => isApprovedSpecification(entry.path))
    .map((entry) => entry.path);

  return {
    state: entries.length === 0 ? "clean" : "dirty",
    trackedState: tracked.length === 0 ? "clean" : "dirty",
    entries,
    trackedChanges: tracked.map((entry) => entry.path),
    untrackedFiles: untracked.map((entry) => entry.path),
    approvedUntrackedSpecifications,
  };
};

export const readWorktreeState = (cwd) =>
  parseGitStatus(
    gitOutput(cwd, ["status", "--porcelain=v1", "--untracked-files=all", "-z"]),
  );

const listFixtureFiles = (directory) => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listFixtureFiles(path);
    return entry.isFile() ? [path] : [];
  });
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const sha256Text = sha256;

export const collectFixtureHashes = (cwd) => {
  const categories = {
    saves: join(cwd, "src/tests/fixtures/saves/v2"),
    world: join(cwd, "src/tests/fixtures/world/v1"),
  };

  return Object.fromEntries(
    Object.entries(categories).map(([category, directory]) => [
      category,
      Object.fromEntries(
        listFixtureFiles(directory)
          .sort()
          .map((path) => [
            normaliseRepositoryPath(relative(cwd, path)),
            sha256(readFileSync(path)),
          ]),
      ),
    ]),
  );
};

export const parseNodeMajor = (version) =>
  Number.parseInt(version.replace(/^v/, "").split(".")[0], 10);

export const commandText = (command) =>
  command
    .map((part) =>
      /^[a-zA-Z0-9_./:=+-]+$/.test(part) ? part : JSON.stringify(part),
    )
    .join(" ");

export const normaliseFailureTail = (tail) =>
  tail
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .split("\n")
    .filter(Boolean)
    .slice(-12)
    .map((line) =>
      line
        .trim()
        .replace(
          /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g,
          "<timestamp>",
        )
        .replace(/\bpid\s+\d+\b/gi, "pid <pid>")
        .replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/g, "<duration>")
        .replace(/\s+/g, " "),
    )
    .join("\n");

export const failureSignature = ({ command, exitCode, tail }) =>
  `sha256:${sha256(
    JSON.stringify({
      command,
      exitCode: exitCode ?? null,
      tail: normaliseFailureTail(tail),
    }),
  )}`;

export const lastLogLines = (path, limit = 12) => {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .slice(-limit)
    .join("\n");
};

export const changedFilesSince = (cwd, baselineCommit) => {
  const trackedChanges = gitOutput(cwd, [
    "diff",
    "--name-only",
    "-z",
    baselineCommit,
  ])
    .split("\0")
    .filter(Boolean)
    .map(normaliseRepositoryPath);
  const untrackedChanges = gitOutput(cwd, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .split("\0")
    .filter(Boolean)
    .map(normaliseRepositoryPath)
    .filter((path) => !isApprovedSpecification(path));

  return [...new Set([...trackedChanges, ...untrackedChanges])].filter(
    (path) => !isAgentRuntimeOrDependencyPath(path),
  );
};

export const changedPathsSince = (cwd, baselineCommit) => {
  const values = gitOutput(cwd, [
    "diff",
    "--name-status",
    "-z",
    "--find-renames",
    baselineCommit,
  ])
    .split("\0")
    .filter(Boolean);
  const tracked = [];
  for (let index = 0; index < values.length;) {
    const status = values[index++];
    if (status.startsWith("R") || status.startsWith("C")) {
      const previousPath = normaliseRepositoryPath(values[index++]);
      const path = normaliseRepositoryPath(values[index++]);
      tracked.push({
        status: status.startsWith("R") ? "renamed" : "modified",
        path,
        previousPath,
      });
      continue;
    }
    const path = normaliseRepositoryPath(values[index++]);
    tracked.push({
      status: status.startsWith("D") ? "deleted" : "modified",
      path,
      previousPath: status.startsWith("D") ? path : null,
    });
  }
  const untracked = nulGit(cwd, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .map(normaliseRepositoryPath)
    .filter(
      (path) =>
        !isApprovedSpecification(path) && !isAgentRuntimeOrDependencyPath(path),
    )
    .map((path) => ({ status: "added", path, previousPath: null }));
  return [...tracked, ...untracked].filter(
    (entry) => !isAgentRuntimeOrDependencyPath(entry.path),
  );
};

const nulGit = (cwd, args) => gitOutput(cwd, args).split("\0").filter(Boolean);

const indexRecords = (cwd) =>
  nulGit(cwd, ["ls-files", "-s", "-z"]).map((entry) => {
    const separator = entry.indexOf("\t");
    const [mode, object, stage] = entry.slice(0, separator).split(" ");
    return {
      path: normaliseRepositoryPath(entry.slice(separator + 1)),
      mode,
      object,
      stage,
    };
  });

export const readRegularFile = (path, encoding = null) => {
  assertNoSymlinkAncestors(path);
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile())
      throw new AgentError(
        "Expected a regular evidence/input file.",
        "INPUT_FILE_INVALID",
      );
    const content = readFileSync(descriptor, encoding);
    const after = fstatSync(descriptor);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new AgentError(
        "File changed during descriptor-bound read.",
        "INPUT_READ_DRIFT",
      );
    return content;
  } finally {
    closeSync(descriptor);
  }
};

const hashWorktreeEntry = (path) => {
  let descriptor = null;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error.code !== "ELOOP") throw error;
    const stat = lstatSync(path);
    return {
      type: "symlink",
      mode: (stat.mode & 0o7777).toString(8),
      hash: sha256("link:" + readlinkSync(path)),
    };
  }
  try {
    const before = fstatSync(descriptor);
    const mode = (before.mode & 0o7777).toString(8);
    if (!before.isFile()) return { type: "unsupported", mode, hash: null };
    const content = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new AgentError(
        "File changed during descriptor-bound hash.",
        "INPUT_READ_DRIFT",
      );
    return { type: "file", mode, hash: sha256(content) };
  } finally {
    closeSync(descriptor);
  }
};

export const assertNoSymlinkAncestors = (path) => {
  const absolute = resolve(path);
  let current = absolute;
  while (true) {
    let details;
    try {
      details = lstatSync(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (details?.isSymbolicLink())
      throw new AgentError(
        "Symlink in protected path: " + current,
        "SYMLINK_PATH_REJECTED",
      );
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return absolute;
};

const safeOutputPath = isSourceSnapshotExcludedPath;

const assertOutputOnlyEntry = (cwd, path) => {
  if (!/^\.agent(?:\/|$)/.test(path)) return;
  const absolute = join(cwd, path);
  assertNoSymlinkAncestors(absolute);
  if (!existsSync(absolute)) return;
  // These are outputs of reviewed, checksum-verifying tool bootstraps, not imports.
  if (
    /^\.agent\/tools\/(?:downloads|actionlint-1\.7\.12|gitleaks-8\.30\.1|codeql-2\.27\.0)(?:\/|$)/.test(
      path,
    )
  )
    return;
  if (/^\.agent\/security\/codeql-db(?:\/|$)/.test(path)) return;
  const entry = hashWorktreeEntry(absolute);
  if (
    entry.type === "symlink" ||
    (parseInt(entry.mode, 8) & 0o111) !== 0 ||
    /\.(?:[cm]?js|[cm]?ts|sh|exe|wasm)$/i.test(path)
  )
    throw new AgentError(
      "Output-only path " +
        path +
        " is executable or link-like and cannot be excluded.",
      "OUTPUT_EXCLUSION_BYPASS",
    );
};

const ignoredInputPaths = (cwd) =>
  nulGit(cwd, [
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "-z",
  ]).map(normaliseRepositoryPath);

export const collectInputFingerprint = ({
  cwd = process.cwd(),
  environment = process.env,
  allowedEnvironment = [
    "CI",
    "NODE_ENV",
    "VITE_BASE_PATH",
    "PLAYWRIGHT_BASE_PATH",
    "PLAYWRIGHT_PORT",
    "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
    "PLAYWRIGHT_BROWSERS_PATH",
    "VITEST_MAX_WORKERS",
  ],
} = {}) => {
  for (const directory of ["node_modules", ...OUTPUT_ONLY_ROOTS])
    assertNoSymlinkAncestors(join(cwd, directory));
  if (
    environment.NODE_OPTIONS ||
    Object.keys(environment).some(
      (key) => key.startsWith("VITE_") && key !== "VITE_BASE_PATH",
    )
  )
    throw new AgentError(
      "Unapproved build-affecting environment input (value withheld).",
      "UNAPPROVED_ENVIRONMENT",
    );
  const records = indexRecords(cwd)
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    )
    .map((index) => {
      const absolute = join(cwd, index.path);
      const working = existsSync(absolute)
        ? hashWorktreeEntry(absolute)
        : { type: "missing", mode: null, hash: null };
      if (working.type === "unsupported")
        throw new AgentError(
          "Tracked input " + index.path + " has unsupported filesystem type.",
          "UNSUPPORTED_INPUT_TYPE",
        );
      if (working.type === "symlink") {
        const target = realpathSync(absolute);
        const targetPath = normaliseRepositoryPath(
          relative(resolve(cwd), target),
        );
        if (targetPath.startsWith("../") || safeOutputPath(targetPath))
          throw new AgentError(
            "Tracked symlink escapes source inputs: " + index.path,
            "INPUT_SYMLINK_REJECTED",
          );
        working.targetHash = sha256(readRegularFile(target));
      }
      return { ...index, working };
    });
  const allUntracked = nulGit(cwd, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]).map(normaliseRepositoryPath);
  for (const path of allUntracked)
    if (safeOutputPath(path)) assertOutputOnlyEntry(cwd, path);
  const untracked = allUntracked
    .filter((path) => !safeOutputPath(path))
    .sort()
    .map((path) => ({ path, ...hashWorktreeEntry(join(cwd, path)) }));
  const ignored = ignoredInputPaths(cwd).sort();
  for (const path of ignored) {
    if (safeOutputPath(path)) {
      assertOutputOnlyEntry(cwd, path);
      continue;
    }
    throw new AgentError(
      "Ignored input " + path + " may affect validation or builds.",
      "IGNORED_INPUT_REJECTED",
    );
  }
  for (const path of untracked)
    if (path.type === "symlink")
      throw new AgentError(
        "Untracked symlink " +
          path.path +
          " cannot be an approved build input.",
        "UNTRACKED_SYMLINK_REJECTED",
      );
  const sourceEntries = [
    ...records.map((record) => ({ path: record.path, ...record.working })),
    ...untracked,
  ];
  const configurationInputs = new Map(
    sourceEntries
      .filter(
        (entry) =>
          entry.type === "file" && !isSourceSnapshotExcludedPath(entry.path),
      )
      .map((entry) => [entry.path, entry]),
  );
  const configurationContents = new Map();
  const readConfig = (path) => {
    // Only exact regular-file members of this fingerprint may supply inherited
    // configuration. Do not discover additional files through compiler lookup.
    const entry = configurationInputs.get(path);
    if (!entry) return undefined;
    if (!configurationContents.has(path)) {
      const bytes = readRegularFile(join(cwd, path));
      if (sha256(bytes) !== entry.hash)
        throw new AgentError(
          "Compiler configuration changed after input hashing.",
          "INPUT_READ_DRIFT",
        );
      configurationContents.set(path, bytes.toString("utf8"));
    }
    return configurationContents.get(path);
  };
  const readSource = readConfig;
  for (const entry of sourceEntries) {
    if (
      entry.type !== "file" ||
      !/\.(?:[cm]?[jt]sx?|json|html?|css)$/.test(entry.path)
    )
      continue;
    assertInputReferences(
      entry.path,
      readRegularFile(join(cwd, entry.path), "utf8"),
      { readConfig, readSource, sourceFiles: [...configurationInputs.keys()] },
    );
  }
  const dependencyRoot = join(cwd, "node_modules");
  const dependencyFiles = [];
  const walkDependencies = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name);
      const path = normaliseRepositoryPath(relative(dependencyRoot, absolute));
      if (isDependencyOutputPath(path)) continue;
      const details = lstatSync(absolute);
      if (details.isDirectory()) walkDependencies(absolute);
      else {
        if (details.isSymbolicLink()) {
          const resolved = realpathSync(absolute);
          if (!resolved.startsWith(resolve(dependencyRoot) + sep))
            throw new AgentError(
              "Installed dependency link escapes locked dependencies: " + path,
              "DEPENDENCY_LINK_REJECTED",
            );
        }
        dependencyFiles.push({ path, ...hashWorktreeEntry(absolute) });
      }
    }
  };
  if (existsSync(dependencyRoot)) walkDependencies(dependencyRoot);
  const executable = environment.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browserExecutableHash = executable
    ? sha256(readFileSync(executable))
    : null;
  const env = Object.fromEntries(
    [...allowedEnvironment]
      .sort()
      .filter((key) => environment[key] !== undefined)
      .map((key) => [key, String(environment[key])]),
  );
  const payload = {
    schemaVersion: AGENT_EVIDENCE_SCHEMA_VERSION,
    policyVersion: AGENT_POLICY_VERSION,
    runtime: runtimeIdentity(cwd),
    dependencies: {
      count: dependencyFiles.length,
      digest: "sha256:" + sha256(JSON.stringify(dependencyFiles)),
    },
    browserExecutableHash,
    head: gitOutput(cwd, ["rev-parse", "HEAD"]).trim(),
    tree: gitOutput(cwd, ["rev-parse", "HEAD^{tree}"]).trim(),
    records,
    untracked,
    env,
  };
  return {
    ...payload,
    digest: "sha256:" + sha256(JSON.stringify(payload)),
    ignoredOutput: {
      count: ignored.filter(safeOutputPath).length,
      digest:
        "sha256:" + sha256(JSON.stringify(ignored.filter(safeOutputPath))),
    },
  };
};

export const runtimeIdentity = (cwd) => ({
  nodeVersion: process.version,
  npmVersion: npmVersion(cwd),
  lockfileHash: existsSync(join(cwd, "package-lock.json"))
    ? "sha256:" + sha256(readRegularFile(join(cwd, "package-lock.json")))
    : null,
  policyVersion: AGENT_POLICY_VERSION,
});

export const repositoryIdentity = (cwd) => ({
  root: realpathSync(gitOutput(cwd, ["rev-parse", "--show-toplevel"]).trim()),
  commonDirectory: realpathSync(
    resolve(cwd, gitOutput(cwd, ["rev-parse", "--git-common-dir"]).trim()),
  ),
});

export const validationIdentity = (cwd, state = readMissionState(cwd)) => {
  if (
    !state.missionId ||
    !/^[a-f0-9]{40}$/.test(state.baselineCommit ?? "") ||
    state.schemaVersion !== AGENT_EVIDENCE_SCHEMA_VERSION ||
    state.policyVersion !== AGENT_POLICY_VERSION
  )
    throw new AgentError(
      "Mission identity/policy is missing or historical; upgrade its record without replacing the mission.",
      "MISSION_IDENTITY_INVALID",
    );
  if (
    !gitSucceeds(cwd, [
      "merge-base",
      "--is-ancestor",
      state.baselineCommit,
      "HEAD",
    ])
  )
    throw new AgentError(
      "Mission baseline is missing or outside the candidate ancestry.",
      "BASELINE_REJECTED",
    );
  const repository = repositoryIdentity(cwd);
  if (JSON.stringify(state.repository) !== JSON.stringify(repository))
    throw new AgentError(
      "Mission belongs to another repository/worktree.",
      "FOREIGN_MISSION",
    );
  return {
    missionId: state.missionId,
    baselineCommit: state.baselineCommit,
    repository,
    policyVersion: AGENT_POLICY_VERSION,
  };
};

export const resolveWithinRepository = (cwd, requestedPath) => {
  const resolved = resolve(cwd, requestedPath);
  const repositoryRelative = relative(cwd, resolved);
  if (
    repositoryRelative === "" ||
    (!repositoryRelative.startsWith(`..${sep}`) && repositoryRelative !== "..")
  )
    return resolved;
  throw new AgentError(
    "Output paths must stay inside the repository.",
    "PATH_OUTSIDE_REPOSITORY",
  );
};
