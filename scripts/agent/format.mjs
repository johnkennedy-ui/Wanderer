import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import {
  AgentError,
  gitOutput,
  isApprovedSpecification,
  normaliseRepositoryPath,
} from "./common.mjs";
import { isFormattingEligiblePath } from "./checks.mjs";

const trackedFormattingFiles = (cwd) =>
  gitOutput(cwd, ["ls-files", "-z"])
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

export const selectTrackedFormattingFiles = (cwd, requestedFiles = null) => {
  const existsInsideRepository = (path) =>
    !path.startsWith("../") &&
    !path.startsWith("/") &&
    !isApprovedSpecification(path) &&
    isFormattingEligiblePath(path) &&
    existsSync(join(cwd, path));
  if (requestedFiles !== null)
    return requestedFiles.filter(existsInsideRepository);
  return trackedFormattingFiles(cwd).filter(existsInsideRepository);
};

export const runFormat = ({ cwd = process.cwd(), action, files = null }) => {
  const selectedFiles = selectTrackedFormattingFiles(cwd, files);
  if (selectedFiles.length === 0) {
    process.stdout.write("format: no eligible tracked files selected\n");
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
  const result = spawnSync(
    process.execPath,
    [prettierPath, action, ...selectedFiles],
    {
      cwd,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
};

const main = () => {
  const { action, files } = parseArguments(process.argv.slice(2));
  process.exitCode = runFormat({ action, files });
};

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
