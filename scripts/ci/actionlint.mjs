import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  chmodSync,
  lstatSync,
  linkSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readRegularFile } from "../agent/common.mjs";
import { withPrivateArchive } from "../security/private-archive.mjs";

export const ACTIONLINT = Object.freeze({
  version: "1.7.12",
  url: "https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz",
  sha256: "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8",
});
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashFile = (path) => hash(readRegularFile(path));
const stat = (path) => {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};
const safe = (path) => {
  const current = resolve(path);
  if (dirname(current) !== current) safe(dirname(current));
  if (stat(current)?.isSymbolicLink())
    throw new Error(`CI policy: symlink in tool path ${current}`);
};
const atomic = (path, bytes, mode) => {
  safe(path);
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, bytes, {
    flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    mode,
  });
  renameSync(temporary, path);
};
const downloadVerifiedArchive = (archive, spec, spawn) => {
  const temporary = `${archive}.${randomUUID()}.part`;
  safe(temporary);
  const result = spawn(
    "curl",
    [
      "--fail",
      "--location",
      "--silent",
      "--show-error",
      "--output",
      temporary,
      spec.url,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (result.error || result.signal || result.status !== 0) {
    rmSync(temporary, { force: true });
    throw new Error(
      `CI policy: actionlint download failed (${result.error?.message ?? result.signal ?? result.status})`,
    );
  }
  if (hashFile(temporary) !== spec.sha256) {
    rmSync(temporary, { force: true });
    throw new Error("CI policy: actionlint download checksum mismatch");
  }
  chmodSync(temporary, 0o600);
  try {
    linkSync(temporary, archive);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  } finally {
    rmSync(temporary, { force: true });
  }
};

export async function bootstrapActionlint(
  cwd,
  {
    spec = ACTIONLINT,
    spawn = spawnSync,
    privateArchive = withPrivateArchive,
  } = {},
) {
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error(
      "CI policy: pinned actionlint bootstrap currently supports Linux x64; another platform needs reviewed official checksum support",
    );
  const directory = join(cwd, `.agent/tools/actionlint-${spec.version}`);
  safe(directory);
  mkdirSync(directory, { recursive: true });
  const archive = join(directory, "actionlint.tar.gz");
  safe(archive);
  if (!stat(archive)) downloadVerifiedArchive(archive, spec, spawn);
  if (!stat(archive)?.isFile())
    throw new Error("CI policy: cached actionlint archive is missing");
  return privateArchive({
    cwd,
    label: "actionlint",
    source: archive,
    expectedHash: spec.sha256,
    use: ({ archive: immutableArchive, directory: run }) => {
      const unpack = spawn("tar", ["-xOzf", immutableArchive, "actionlint"], {
        encoding: null,
        timeout: 30_000,
        maxBuffer: 32 * 1024 * 1024,
      });
      if (
        unpack.error ||
        unpack.signal ||
        unpack.status !== 0 ||
        !unpack.stdout?.length
      )
        throw new Error(
          "CI policy: cannot extract actionlint from verified archive",
        );
      const binary = join(run, "actionlint");
      atomic(binary, unpack.stdout, 0o700);
      const result = spawn(
        binary,
        ["-oneline", ".github/workflows/deploy-pages.yml"],
        { cwd, encoding: "utf8", timeout: 60_000 },
      );
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      if (result.error || result.signal || result.status !== 0)
        throw new Error("CI policy: actionlint failed or did not finish");
      return {
        version: spec.version,
        archiveSha256: spec.sha256,
        binarySha256: hash(unpack.stdout),
        exitCode: 0,
      };
    },
  }).catch((error) => {
    if (String(error.stderr || error.message).includes("checksum"))
      throw new Error("CI policy: cached actionlint archive checksum mismatch");
    throw error;
  });
}

export const runActionlint = (cwd) => bootstrapActionlint(cwd);
