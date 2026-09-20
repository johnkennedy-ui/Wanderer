import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertNoSymlinkAncestors,
  collectInputFingerprint,
} from "../agent/common.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const byteSort = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const fileStat = (path) => {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};
const base = (value) => {
  if (value !== "/" && value !== "/Wanderer/")
    throw new Error("Artifact base must be exactly / or /Wanderer/");
  return value;
};
const safeFile = (path) => {
  assertNoSymlinkAncestors(path);
  const details = fileStat(path);
  if (!details?.isFile() || details.mode & 0o111)
    throw new Error(
      "Artifact input must be a non-executable regular file: " + path,
    );
  return details;
};
const regularDirectory = (path) => {
  assertNoSymlinkAncestors(path);
  if (!fileStat(path)?.isDirectory())
    throw new Error("Artifact directory is missing or invalid: " + path);
};
const manifestPathFor = (cwd, basePath) =>
  join(
    cwd,
    ".agent/artifacts",
    base(basePath) === "/" ? "root.json" : "pages.json",
  );

export const readArtifactIdentity = ({
  cwd = process.cwd(),
  basePath = "/Wanderer/",
} = {}) => {
  const input = collectInputFingerprint({
    cwd,
    environment: {
      ...process.env,
      VITE_BASE_PATH: basePath,
      PLAYWRIGHT_BASE_PATH: basePath,
    },
  });
  return {
    sourceSha: input.head,
    sourceTree: input.tree,
    sourceInputDigest: input.digest,
    lockfileSha256: sha256(readFileSync(join(cwd, "package-lock.json"))),
    tools: {
      node: process.version,
      npm: execFileSync("npm", ["--version"], { cwd, encoding: "utf8" }).trim(),
    },
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  };
};

const outputMembership = (cwd, basePath) => {
  const policyPath = join(cwd, "scripts/security/public-assets.json");
  safeFile(policyPath);
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  if (
    policy.schemaVersion !== 1 ||
    !Array.isArray(policy.paths) ||
    !policy.paths.length ||
    new Set(policy.paths).size !== policy.paths.length ||
    policy.paths.some(
      (path) =>
        typeof path !== "string" ||
        path.startsWith("/") ||
        path
          .split("/")
          .some(
            (part) =>
              !part || part === "." || part === ".." || part.startsWith("."),
          ),
    )
  )
    throw new Error("Artifact public membership policy is malformed");
  const indexPath = join(cwd, "dist/index.html");
  safeFile(indexPath);
  const html = readFileSync(indexPath, "utf8");
  const scripts = [
    ...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g),
  ];
  const styles = [
    ...html.matchAll(
      /<link\b(?=[^>]*\brel="stylesheet")[^>]*\bhref="([^"]+)"[^>]*>/g,
    ),
  ];
  const icons = [
    ...html.matchAll(
      /<link\b(?=[^>]*\brel="icon")[^>]*\bhref="([^"]+)"[^>]*>/g,
    ),
  ];
  if (
    scripts.length !== 1 ||
    styles.length !== 1 ||
    icons.length !== 1 ||
    !/\btype="module"/.test(scripts[0][0]) ||
    icons[0][1] !== basePath + "favicon.svg"
  )
    throw new Error(
      "Artifact HTML differs from the reviewed production entry layout/base",
    );
  const bundles = [scripts[0][1], styles[0][1]].map((url) => {
    if (!url.startsWith(basePath))
      throw new Error("Artifact HTML has a different base path");
    const path = url.slice(basePath.length);
    if (!/^assets\/index-[a-zA-Z0-9_-]+\.(?:js|css)$/.test(path))
      throw new Error("Artifact HTML contains an unsupported bundle path");
    return path;
  });
  if (!bundles[0].endsWith(".js") || !bundles[1].endsWith(".css"))
    throw new Error("Artifact script/stylesheet types are inconsistent");
  for (const path of policy.paths) {
    const source = join(cwd, "public", path);
    const output = join(cwd, "dist", path);
    safeFile(source);
    safeFile(output);
    if (sha256(readFileSync(source)) !== sha256(readFileSync(output)))
      throw new Error("Artifact public asset differs from its source: " + path);
  }
  return new Set(["index.html", ...bundles, ...policy.paths]);
};

export const collectArtifact = ({
  cwd = process.cwd(),
  basePath = process.env.VITE_BASE_PATH ?? "/",
  identity = readArtifactIdentity({ cwd, basePath }),
} = {}) => {
  base(basePath);
  const output = join(cwd, "dist");
  regularDirectory(output);
  const expected = outputMembership(cwd, basePath);
  const directories = new Set();
  for (const path of expected)
    for (let parent = dirname(path); parent !== "."; parent = dirname(parent))
      directories.add(parent.split(sep).join("/"));
  const files = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort(byteSort)) {
      const path = join(directory, name);
      const rel = relative(output, path).split(sep).join("/");
      assertNoSymlinkAncestors(path);
      const details = fileStat(path);
      if (details?.isDirectory()) {
        if (!directories.has(rel))
          throw new Error("Artifact contains an unexpected directory: " + rel);
        walk(path);
      } else {
        safeFile(path);
        if (!expected.has(rel))
          throw new Error(
            "Artifact contains an unexpected/forbidden payload: " + rel,
          );
        files.push({
          path: rel,
          mode: (details.mode & 0o777).toString(8).padStart(4, "0"),
          size: details.size,
          sha256: sha256(readFileSync(path)),
        });
      }
    }
  };
  walk(output);
  files.sort((a, b) => byteSort(a.path, b.path));
  if (files.length !== expected.size)
    throw new Error("Artifact membership is incomplete");
  return {
    schemaVersion: 2,
    basePath,
    identity,
    files,
    contentSha256: sha256(JSON.stringify(files)),
  };
};

export const createArtifact = (options = {}) => {
  const cwd = options.cwd ?? process.cwd();
  const basePath = options.basePath ?? process.env.VITE_BASE_PATH ?? "/";
  const path = manifestPathFor(cwd, basePath);
  assertNoSymlinkAncestors(path);
  const manifest = collectArtifact({ ...options, cwd, basePath });
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n", {
    flag: constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    mode: 0o600,
  });
  renameSync(temporary, path);
  const witness = path.replace(/\.json$/, ".browser.json");
  assertNoSymlinkAncestors(witness);
  writeFileSync(witness, JSON.stringify({ status: "unverified" }) + "\n", {
    flag: "w",
    mode: 0o600,
  });
  return { manifest, path };
};

export const verifyArtifact = (options = {}) => {
  const cwd = options.cwd ?? process.cwd();
  const basePath = options.basePath ?? "/Wanderer/";
  const path = manifestPathFor(cwd, basePath);
  safeFile(path);
  const recorded = JSON.parse(readFileSync(path, "utf8"));
  const current = collectArtifact({ ...options, cwd, basePath });
  // Equality to a newly constructed fixed-schema record rejects extra/missing fields,
  // malformed hashes, stale source/lock/tool/run identity and any file/mode drift.
  if (JSON.stringify(recorded) !== JSON.stringify(current))
    throw new Error(
      "Artifact identity or content changed after manifest creation",
    );
  if (options.requireBrowser) {
    const witnessPath = path.replace(/\.json$/, ".browser.json");
    safeFile(witnessPath);
    const witness = JSON.parse(readFileSync(witnessPath, "utf8"));
    const completed = Date.parse(witness.completedAt);
    if (
      witness.status !== "passed" ||
      witness.manifestSha256 !== sha256(readFileSync(path)) ||
      witness.basePath !== basePath ||
      witness.command !== "node node_modules/playwright/cli.js test" ||
      !Number.isFinite(completed) ||
      completed > Date.now() + 60_000
    )
      throw new Error("Artifact lacks current successful browser verification");
  }
  return { manifest: current, path };
};

export const markBrowserVerified = (options = {}) => {
  const result = verifyArtifact(options);
  const path = result.path.replace(/\.json$/, ".browser.json");
  assertNoSymlinkAncestors(path);
  const value = {
    status: "passed",
    basePath: result.manifest.basePath,
    manifestSha256: sha256(readFileSync(result.path)),
    completedAt: new Date().toISOString(),
    command: "node node_modules/playwright/cli.js test",
  };
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", {
    flag: constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    mode: 0o600,
  });
  renameSync(temporary, path);
  return value;
};

export const parseArguments = (argv, environment = process.env) => {
  const [action, ...rest] = argv;
  if (
    !["create", "verify"].includes(action) ||
    (rest.length !== 0 && (rest.length !== 2 || rest[0] !== "--base"))
  )
    throw new Error(
      "Usage: artifact.mjs create|verify [--base / or /Wanderer/]",
    );
  return {
    action,
    basePath: base(
      rest[1] ??
        (action === "create"
          ? (environment.VITE_BASE_PATH ?? "/")
          : "/Wanderer/"),
    ),
  };
};
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const { action, basePath } = parseArguments(process.argv.slice(2));
    const result =
      action === "create"
        ? createArtifact({ basePath })
        : verifyArtifact({ basePath, requireBrowser: true });
    console.log(
      JSON.stringify({
        path: result.path,
        contentSha256: result.manifest.contentSha256,
      }),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
