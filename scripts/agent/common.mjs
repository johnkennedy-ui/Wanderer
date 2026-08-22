import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join, relative, resolve, sep } from "node:path";

export const AGENT_DIRECTORY = ".agent";
export const REQUIRED_BASELINE = "a4c74f9";
export const SUPPORTED_NODE_MAJOR = 22;

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
  mkdirSync(directory, { recursive: true });
  return directory;
};

export const writeJsonAtomic = (path, value) => {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
};

export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

export const missionStatePath = (cwd) => agentPath(cwd, "mission.json");

export const readMissionState = (cwd) => {
  const path = missionStatePath(cwd);
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
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = String(
      error.stderr ?? error.message ?? "git command failed",
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

export const parseGitStatus = (output) => {
  const entries = output
    .split("\n")
    .filter(Boolean)
    .map((line) => ({ status: line.slice(0, 2), path: line.slice(3) }));
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
    gitOutput(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]),
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

  return [...new Set([...trackedChanges, ...untrackedChanges])];
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
