import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import YAML, { isAlias, visit } from "yaml";
import { expectedWorkflow, REQUIRED_SCRIPTS } from "./contract.mjs";
import { runActionlint } from "./actionlint.mjs";

export function policyError(message) {
  throw new Error(`CI policy: ${message}`);
}
const actions = [
  "actions/checkout",
  "actions/setup-node",
  "actions/github-script",
  "actions/upload-pages-artifact",
  "actions/deploy-pages",
  "actions/upload-artifact",
].sort();
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
};
const equal = (left, right) =>
  JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

export function loadPins(cwd) {
  const value = JSON.parse(
    readFileSync(join(cwd, "scripts/ci/action-pins.json"), "utf8"),
  );
  if (
    value.schemaVersion !== 1 ||
    value.verification !== "verified-official-release-ref-and-commit" ||
    !equal(Object.keys(value.actions ?? {}).sort(), actions)
  )
    policyError("verified official action pin catalog is required");
  for (const [name, pin] of Object.entries(value.actions)) {
    if (
      !/^[a-f0-9]{40}$/.test(pin.sha ?? "") ||
      /^0+$/.test(pin.sha) ||
      !/^v\d+\.\d+\.\d+$/.test(pin.release ?? "") ||
      pin.source !== `https://github.com/${name}` ||
      !/^[a-f0-9]{64}$/.test(pin.actionYamlSha256 ?? "")
    )
      policyError(`invalid release/full-SHA provenance for ${name}`);
  }
  return value.actions;
}

export function assertWorkflow(workflow, pins) {
  // Exact structure deliberately rejects extra jobs, conditions, env, permissions,
  // containers, local/reusable actions, filters, bypasses and arbitrary expressions.
  const expected = expectedWorkflow(pins);
  for (const key of new Set([
    ...Object.keys(expected),
    ...Object.keys(workflow ?? {}),
  ])) {
    if (!equal(workflow?.[key], expected[key])) {
      if (key === "jobs") {
        for (const name of new Set([
          ...Object.keys(expected.jobs),
          ...Object.keys(workflow?.jobs ?? {}),
        ])) {
          if (!equal(workflow?.jobs?.[name], expected.jobs[name]))
            policyError(
              `job ${name} differs from the reviewed mandatory privilege/gate/artifact contract; unsupported structures require review`,
            );
        }
      }
      policyError(
        `${key} differs from the reviewed event/permission/concurrency contract`,
      );
    }
  }
  return true;
}

export function parseYaml(text) {
  const document = YAML.parseDocument(text, {
    uniqueKeys: true,
    version: "1.2",
    strict: true,
  });
  if (document.errors.length || document.warnings.length)
    policyError(
      [...document.errors, ...document.warnings]
        .map((error) => error.message)
        .join("; "),
    );
  visit(document, {
    Node(_key, node) {
      if (isAlias(node) || node.anchor)
        policyError(
          "YAML aliases and anchors are unsupported; expand the reviewed structure",
        );
    },
  });
  return document.toJS({ maxAliasCount: 0 });
}

export function assertPackage(packageJson, vitestSource, nodeVersion) {
  for (const [name, command] of Object.entries(REQUIRED_SCRIPTS))
    if (packageJson.scripts?.[name] !== command)
      policyError(
        `package script ${name} must execute the complete reviewed command`,
      );
  if (
    packageJson.engines?.node !== "22.x" ||
    packageJson.engines?.npm !== "10.x" ||
    nodeVersion.trim() !== "22.23.2"
  )
    policyError("Node 22.23.2/npm10 toolchain contract differs");
  const approved = `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/tests/**/*.test.ts"], environment: "node", maxWorkers: 2, }, });`;
  if (vitestSource.replace(/\s/g, "") !== approved.replace(/\s/g, ""))
    policyError(
      "Vitest configuration differs from reviewed full-discovery contract (including soak/control tests)",
    );
}

export function checkDirectory(cwd) {
  const directory = join(cwd, ".github/workflows");
  const names = readdirSync(directory)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();
  if (!equal(names, ["deploy-pages.yml"]))
    policyError(
      "exactly deploy-pages.yml is accepted; no unreviewed follow-on/reusable workflow",
    );
  assertWorkflow(
    parseYaml(readFileSync(join(directory, names[0]), "utf8")),
    loadPins(cwd),
  );
  assertPackage(
    JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")),
    readFileSync(join(cwd, "vitest.config.ts"), "utf8"),
    readFileSync(join(cwd, ".nvmrc"), "utf8"),
  );
  return true;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.length !== 2)
      policyError("Usage: node scripts/ci/policy.mjs");
    checkDirectory(process.cwd());
    await runActionlint(process.cwd());
    console.log(
      "CI policy and pinned actionlint passed; live GitHub enforcement remains separately verified.",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
