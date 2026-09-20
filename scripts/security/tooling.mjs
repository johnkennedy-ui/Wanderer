import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  constants,
  openSync,
  closeSync,
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertNoSymlinkAncestors, readRegularFile } from "../agent/common.mjs";
import { withPrivateArchive } from "./private-archive.mjs";

export class SecurityToolError extends Error {
  constructor(message, code = "SECURITY_TOOL_ERROR") {
    super(message);
    this.name = "SecurityToolError";
    this.code = code;
  }
}
export const TOOL_SPECS = Object.freeze({
  codeql: Object.freeze({
    version: "2.27.0",
    archive: "codeql-bundle-linux64.tar.gz",
    archiveSha256:
      "8e870433e5c80d0e916c3c1aa9005fc88aab990bcdcc649fade9dfc4d7e94305",
    url: "https://github.com/github/codeql-action/releases/download/codeql-bundle-v2.27.0/codeql-bundle-linux64.tar.gz",
    prefix: "codeql",
    binary: "codeql",
  }),
  gitleaks: Object.freeze({
    version: "8.30.1",
    archive: "gitleaks_8.30.1_linux_x64.tar.gz",
    archiveSha256:
      "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
    url: "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz",
    prefix: "-",
    binary: "gitleaks",
  }),
});
export const sha256File = (path) =>
  createHash("sha256").update(readRegularFile(path)).digest("hex");
export const publishVerifiedArchive = (temporary, archive, expectedHash) => {
  if (sha256File(temporary) !== expectedHash)
    throw new SecurityToolError(
      "Downloaded scanner checksum mismatch.",
      "TOOL_ARCHIVE_CHECKSUM_MISMATCH",
    );
  try {
    linkSync(temporary, archive);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (sha256File(archive) !== expectedHash)
      throw new SecurityToolError(
        "Concurrent scanner cache winner checksum mismatch.",
        "TOOL_ARCHIVE_CHECKSUM_MISMATCH",
      );
  } finally {
    unlinkSync(temporary);
  }
  return archive;
};
export const toolPaths = (cwd, name, requestedSpec = TOOL_SPECS[name]) => {
  const spec = requestedSpec;
  if (!spec)
    throw new SecurityToolError("Unknown tool: " + name, "UNKNOWN_TOOL");
  const root = join(cwd, ".agent/tools");
  return {
    spec,
    root,
    archive: join(root, "downloads", spec.archive),
    directory: join(root, name + "-" + spec.version),
    binary: join(root, name + "-" + spec.version, spec.binary),
  };
};
export const verifyToolArchive = (cwd, name) => {
  const paths = toolPaths(cwd, name);
  assertNoSymlinkAncestors(paths.archive);
  if (!existsSync(paths.archive) || !lstatSync(paths.archive).isFile())
    throw new SecurityToolError(
      name + " archive is missing.",
      "TOOL_ARCHIVE_MISSING",
    );
  const actual = sha256File(paths.archive);
  if (actual !== paths.spec.archiveSha256)
    throw new SecurityToolError(
      name + " archive checksum mismatch.",
      "TOOL_ARCHIVE_CHECKSUM_MISMATCH",
    );
  return {
    archive: paths.archive,
    sha256: actual,
    version: paths.spec.version,
    url: paths.spec.url,
  };
};
export const prepareToolRoot = (cwd, create = false) => {
  const path = join(cwd, ".agent/tools/package.json");
  assertNoSymlinkAncestors(path);
  const expected = '{"type":"commonjs"}\n';
  if (create) {
    mkdirSync(dirname(path), { recursive: true });
    let descriptor;
    try {
      descriptor = openSync(
        path,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (descriptor !== undefined) {
      try {
        writeFileSync(descriptor, expected);
      } finally {
        closeSync(descriptor);
      }
    }
  }
  if (!existsSync(path) || readRegularFile(path, "utf8") !== expected)
    throw new SecurityToolError(
      "Tool cache must have the reviewed CommonJS package boundary; do not modify vendor archive files.",
      "TOOL_PACKAGE_BOUNDARY_INVALID",
    );
};

const inspectArchive = (cwd, name, action, archive, directory, spec) => {
  prepareToolRoot(cwd);
  assertNoSymlinkAncestors(directory);
  if (!existsSync(archive))
    throw new SecurityToolError(
      name + " archive is missing.",
      "TOOL_ARCHIVE_MISSING",
    );
  try {
    const inventory = JSON.parse(
      execFileSync(
        "python3",
        [
          fileURLToPath(new URL("archive.py", import.meta.url)),
          action,
          archive,
          directory,
          spec.archiveSha256,
          spec.prefix,
        ],
        {
          cwd,
          encoding: "utf8",
          timeout: 300_000,
          maxBuffer: 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    );
    const binary = join(directory, spec.binary);
    if (!lstatSync(binary).isFile())
      throw new Error("Scanner executable missing");
    return {
      binary,
      version: spec.version,
      sha256: spec.archiveSha256,
      binarySha256: sha256File(binary),
      ...inventory,
    };
  } catch (error) {
    throw new SecurityToolError(
      name +
        " verified archive/cache check failed: " +
        String(error.stderr || error.message).slice(0, 1000),
      "TOOL_CACHE_INVALID",
    );
  }
};
export const verifyCachedTool = async (
  cwd,
  name,
  { spec = TOOL_SPECS[name] } = {},
) => {
  const paths = toolPaths(cwd, name, spec);
  return withPrivateArchive({
    cwd,
    label: name + "-verify",
    source: paths.archive,
    expectedHash: paths.spec.archiveSha256,
    use: ({ archive }) =>
      inspectArchive(cwd, name, "verify", archive, paths.directory, paths.spec),
  });
};
// Kept as an explicit verification-only compatibility interface, never a way to bless arbitrary binaries.
export const recordVerifiedTool = verifyCachedTool;
export const ensureTool = async (
  cwd,
  name,
  { spec = TOOL_SPECS[name] } = {},
) => {
  prepareToolRoot(cwd, true);
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new SecurityToolError(
      "Pinned scanner bundle requires Linux x64; other platforms are not verified.",
      "TOOL_PLATFORM_UNSUPPORTED",
    );
  const paths = toolPaths(cwd, name, spec);
  assertNoSymlinkAncestors(paths.archive);
  assertNoSymlinkAncestors(paths.directory);
  if (!existsSync(paths.archive)) {
    mkdirSync(dirname(paths.archive), { recursive: true });
    const temporary = paths.archive + "." + randomUUID() + ".part";
    const response = await fetch(paths.spec.url, {
      signal: AbortSignal.timeout(600_000),
    });
    if (!response.ok || !response.body)
      throw new SecurityToolError(
        "Scanner download failed: HTTP " + response.status,
        "TOOL_DOWNLOAD_FAILED",
      );
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
    );
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(temporary)) hash.update(chunk);
    if (hash.digest("hex") !== paths.spec.archiveSha256)
      throw new SecurityToolError(
        "Downloaded scanner checksum mismatch; retained untrusted .part file, not executed.",
        "TOOL_ARCHIVE_CHECKSUM_MISMATCH",
      );
    publishVerifiedArchive(temporary, paths.archive, paths.spec.archiveSha256);
  }
  return withPrivateArchive({
    cwd,
    label: name + "-cache",
    source: paths.archive,
    expectedHash: paths.spec.archiveSha256,
    use: ({ archive }) =>
      inspectArchive(
        cwd,
        name,
        existsSync(paths.directory) ? "verify" : "install",
        archive,
        paths.directory,
        paths.spec,
      ),
  });
};
export const withVerifiedTool = async (
  cwd,
  name,
  use,
  { spec = TOOL_SPECS[name] } = {},
) => {
  await ensureTool(cwd, name, { spec });
  const paths = toolPaths(cwd, name, spec);
  return withPrivateArchive({
    cwd,
    label: name,
    source: paths.archive,
    expectedHash: paths.spec.archiveSha256,
    use: async ({ archive, directory }) => {
      const destination = join(directory, "tool");
      writeFileSync(join(directory, "package.json"), '{"type":"commonjs"}\n', {
        flag: "wx",
        mode: 0o600,
      });
      const tool = inspectArchive(
        cwd,
        name,
        "install",
        archive,
        destination,
        paths.spec,
      );
      return use(tool);
    },
  });
};
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [action, name, ...extra] = process.argv.slice(2);
  const operations = {
    "verify-archive": verifyToolArchive,
    "verify-cache": verifyCachedTool,
    record: recordVerifiedTool,
    install: ensureTool,
  };
  Promise.resolve()
    .then(() => {
      if (!operations[action] || !name || extra.length)
        throw new SecurityToolError(
          "Usage: tooling.mjs install|verify-archive|verify-cache codeql|gitleaks",
        );
      return operations[action](process.cwd(), name);
    })
    .then((value) => console.log(JSON.stringify(value)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
