import { existsSync, realpathSync, lstatSync } from "node:fs";
import * as prettier from "prettier";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";

import {
  AgentError,
  gitOutput,
  isApprovedSpecification,
  normaliseRepositoryPath,
  resolveWithinRepository,
  assertNoSymlinkAncestors,
  readRegularFile,
} from "./common.mjs";
import { isFormattingEligiblePath } from "./checks.mjs";

const trackedFormattingFiles = (cwd) =>
  gitOutput(cwd, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .split("\0")
    .filter(Boolean)
    .map(normaliseRepositoryPath)
    .filter(isFormattingEligiblePath)
    .sort();

const parseArguments = (argv) => {
  const action = argv[0];
  if (action !== "--check" && action !== "--write")
    throw new AgentError(
      "Usage: format.mjs --check|--write [--files file ...]",
      "INVALID_ARGUMENT",
    );
  if (argv.length === 1) return { action, files: null };
  if (argv[1] !== "--files")
    throw new AgentError(
      "Expected --files before an explicit file list.",
      "INVALID_ARGUMENT",
    );
  return { action, files: argv.slice(2).map(normaliseRepositoryPath) };
};

const isCanonicalRepositoryPath = (path) =>
  path !== "" && path !== ".." && !path.startsWith("../");

const selectCanonicalTrackedFile = (cwd, trackedFiles, requestedPath) => {
  const normalizedPath = normaliseRepositoryPath(requestedPath);
  if (
    isApprovedSpecification(normalizedPath) ||
    !isFormattingEligiblePath(normalizedPath)
  )
    return null;

  const repositoryRoot = realpathSync(cwd);
  const requestedLocation = resolveWithinRepository(
    repositoryRoot,
    normalizedPath,
  );
  assertNoSymlinkAncestors(requestedLocation);
  if (!existsSync(requestedLocation)) return null;
  if (!lstatSync(requestedLocation).isFile())
    throw new AgentError(
      "Formatting inputs must be regular files.",
      "FORMATTING_INPUT_INVALID",
    );

  const canonicalRelativePath = normaliseRepositoryPath(
    relative(repositoryRoot, realpathSync(requestedLocation)),
  );
  if (!isCanonicalRepositoryPath(canonicalRelativePath))
    throw new AgentError(
      "Formatting paths must resolve inside the repository.",
      "PATH_OUTSIDE_REPOSITORY",
    );
  return trackedFiles.has(canonicalRelativePath) ? canonicalRelativePath : null;
};

export const selectTrackedFormattingFiles = (cwd, requestedFiles = null) => {
  const trackedFiles = new Set(trackedFormattingFiles(cwd));
  const candidates = requestedFiles ?? [...trackedFiles];
  return [
    ...new Set(
      candidates
        .map((path) => selectCanonicalTrackedFile(cwd, trackedFiles, path))
        .filter(Boolean),
    ),
  ].sort();
};

export const runFormat = async ({
  cwd = process.cwd(),
  action,
  files = null,
  execute = spawnSync,
}) => {
  const selectedFiles = selectTrackedFormattingFiles(cwd, files);
  if (selectedFiles.length === 0) {
    process.stdout.write(
      "format: no eligible source files selected; no formatting work\n",
    );
    return 0;
  }

  const prettierPath = join(
    cwd,
    "node_modules",
    "prettier",
    "bin",
    "prettier.cjs",
  );
  if (!existsSync(prettierPath))
    throw new AgentError(
      "Local Prettier is unavailable; run npm ci before formatting.",
      "PRETTIER_UNAVAILABLE",
    );
  const dirty = [];
  const options = new Map();
  for (const file of selectedFiles) {
    const path = join(cwd, file);
    const info = await prettier.getFileInfo(path, {
      ignorePath: [
        join(cwd, ".gitignore"),
        join(cwd, ".prettierignore"),
      ].filter(existsSync),
      withNodeModules: false,
    });
    if (info.ignored || !info.inferredParser) {
      process.stdout.write(
        `format: skipped ${JSON.stringify(file)} (${info.ignored ? "ignored" : "unsupported"})\n`,
      );
      continue;
    }
    const config = { ...(await prettier.resolveConfig(path)), filepath: path };
    options.set(file, config);
    if (!(await prettier.check(readRegularFile(path, "utf8"), config)))
      dirty.push(file);
    else
      process.stdout.write(
        `format: already formatted ${JSON.stringify(file)}\n`,
      );
  }
  if (!dirty.length) return 0;
  const result = execute(
    process.execPath,
    [prettierPath, action, ...dirty.map((path) => "./" + path)],
    { cwd, stdio: "inherit", timeout: 180_000 },
  );
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0) return result.status || 1;
  for (const file of dirty) {
    const path = join(cwd, file);
    assertNoSymlinkAncestors(path);
    if (
      !(await prettier.check(readRegularFile(path, "utf8"), options.get(file)))
    )
      throw new AgentError(
        "Formatter did not produce formatted bytes: " + file,
        "FALSE_FORMAT_PASS",
      );
  }
  return 0;
};

const main = async () => {
  const { action, files } = parseArguments(process.argv.slice(2));
  process.exitCode = await runFormat({ action, files });
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
