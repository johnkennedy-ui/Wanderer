import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
const policyPath = "../../../scripts/ci/policy.mjs";
const contractPath = "../../../scripts/ci/contract.mjs";
const { assertWorkflow, loadPins, parseYaml, assertPackage, checkDirectory } =
  await import(policyPath);
const {
  requiredResultsPass,
  publicationAllowed,
  AGGREGATE_SCRIPT,
  FRESHNESS_SCRIPT,
} = await import(contractPath);
const cwd = process.cwd();
const pins = loadPins(cwd);
const source = readFileSync(".github/workflows/deploy-pages.yml", "utf8");
const good = () => parseYaml(source);
const verifyAction = (workflow: any, name: string) =>
  workflow.jobs.verify.steps.find((step: any) =>
    step.uses?.startsWith(`${name}@`),
  );
const packageJson = () => JSON.parse(readFileSync("package.json", "utf8"));
const vitestSource = readFileSync("vitest.config.ts", "utf8");
const nodeVersion = readFileSync(".nvmrc", "utf8");
const temporary: string[] = [];
afterEach(() =>
  temporary
    .splice(0)
    .forEach((path) => rmSync(path, { force: true, recursive: true })),
);
const reject = (mutate: (workflow: any) => void) => {
  const workflow = good();
  mutate(workflow);
  expect(() => assertWorkflow(workflow, pins)).toThrow("CI policy:");
};

describe("actual repository workflow mutation tests", () => {
  it("accepts the real parsed workflow and its real package/test commands", () =>
    expect(checkDirectory(cwd)).toBe(true));
  it.each(["pull_request", "push", "merge_group", "workflow_dispatch"])(
    "rejects missing %s event",
    (event) => reject((w) => delete w.on[event]),
  );
  it.each([
    [
      "path filters",
      (w: any) => {
        w.on.pull_request = { paths: ["src/**"] };
      },
    ],
    [
      "PR target",
      (w: any) => {
        w.on.pull_request_target = null;
      },
    ],
    [
      "privileged follow-on",
      (w: any) => {
        w.on.workflow_run = {};
      },
    ],
    [
      "missing browser",
      (w: any) => {
        w.jobs.verify.steps = w.jobs.verify.steps.filter(
          (s: any) => !s.run?.includes("test:browser"),
        );
      },
    ],
    [
      "missing security",
      (w: any) => {
        w.jobs.security.steps.pop();
      },
    ],
    [
      "missing aggregate predecessor",
      (w: any) => {
        w.jobs["ci-required"].needs = ["verify"];
      },
    ],
    [
      "aggregate not always evaluated",
      (w: any) => {
        delete w.jobs["ci-required"].if;
      },
    ],
    [
      "aggregate forged success",
      (w: any) => {
        w.jobs["ci-required"].steps[0].with.script = "return true;";
      },
    ],
    [
      "missing deploy aggregate",
      (w: any) => {
        w.jobs.deploy.needs = ["verify"];
      },
    ],
    [
      "missing producer dependency",
      (w: any) => {
        w.jobs.deploy.needs = ["ci-required"];
      },
    ],
    [
      "build Pages grant",
      (w: any) => {
        w.jobs.verify.permissions = { pages: "write" };
      },
    ],
    [
      "test OIDC grant",
      (w: any) => {
        w.jobs.verify.permissions = { "id-token": "write" };
      },
    ],
    [
      "ordinary contents grant",
      (w: any) => {
        w.jobs.security.permissions = { contents: "write" };
      },
    ],
    [
      "string write-all permissions",
      (w: any) => {
        w.permissions = "write-all";
      },
    ],
    [
      "extra deploy scope",
      (w: any) => {
        w.jobs.deploy.permissions.actions = "write";
      },
    ],
    [
      "moving pin",
      (w: any) => {
        w.jobs.verify.steps[0].uses = "actions/checkout@v7";
      },
    ],
    [
      "unapproved 40hex pin",
      (w: any) => {
        w.jobs.verify.steps[0].uses = `actions/checkout@${"a".repeat(40)}`;
      },
    ],
    [
      "persisted credentials",
      (w: any) => {
        w.jobs.verify.steps[0].with["persist-credentials"] = true;
      },
    ],
    [
      "shallow history",
      (w: any) => {
        w.jobs.security.steps[0].with["fetch-depth"] = 1;
      },
    ],
    [
      "non-main dispatch",
      (w: any) => {
        w.jobs.deploy.if = "${{ github.event_name == 'workflow_dispatch' }}";
      },
    ],
    [
      "OR publication bypass",
      (w: any) => {
        w.jobs.deploy.if += " || true";
      },
    ],
    [
      "PR publication",
      (w: any) => {
        w.jobs.deploy.if = w.jobs.deploy.if.replace("'push'", "'pull_request'");
      },
    ],
    [
      "merge-group publication",
      (w: any) => {
        w.jobs.deploy.if = w.jobs.deploy.if.replace("'push'", "'merge_group'");
      },
    ],
    [
      "deploy npm",
      (w: any) => {
        w.jobs.deploy.steps.push({ run: "npm run build" });
      },
    ],
    [
      "deploy checkout",
      (w: any) => {
        w.jobs.deploy.steps.push(w.jobs.verify.steps[0]);
      },
    ],
    [
      "deploy arbitrary metadata code",
      (w: any) => {
        w.jobs.deploy.steps[0].with.script =
          "require('child_process').execSync('npm install')";
      },
    ],
    [
      "step continue on error",
      (w: any) => {
        w.jobs.verify.steps[4]["continue-on-error"] = true;
      },
    ],
    [
      "job continue on error",
      (w: any) => {
        w.jobs.security["continue-on-error"] = true;
      },
    ],
    [
      "swallowed scanner",
      (w: any) => {
        w.jobs.security.steps.at(-1).run += " || true";
      },
    ],
    [
      "conditional scanner",
      (w: any) => {
        w.jobs.security.steps.at(-1).if = "false";
      },
    ],
    [
      "conditional verification",
      (w: any) => {
        w.jobs.verify.if = "false";
      },
    ],
    [
      "empty suite",
      (w: any) => {
        w.jobs.verify.steps[4].run = "npm test -- --passWithNoTests";
      },
    ],
    [
      "artifact latest search",
      (w: any) => {
        w.jobs.deploy.steps[1].with.artifact_name = "latest";
      },
    ],
    [
      "artifact URL",
      (w: any) => {
        w.jobs.deploy.steps[1].with.artifact_url =
          "https://example.invalid/artifact";
      },
    ],
    [
      "wrong output path",
      (w: any) => {
        verifyAction(w, "actions/upload-pages-artifact").with.path = ".";
      },
    ],
    [
      "missing final digest",
      (w: any) => {
        w.jobs.verify.steps = w.jobs.verify.steps.filter(
          (step: any) =>
            !step.run?.startsWith("node scripts/security/artifact.mjs verify"),
        );
      },
    ],
    [
      "post-check output mutation",
      (w: any) => {
        const uploadIndex = w.jobs.verify.steps.findIndex((step: any) =>
          step.uses?.startsWith("actions/upload-pages-artifact@"),
        );
        w.jobs.verify.steps.splice(uploadIndex, 0, {
          run: "echo bad >> dist/index.html",
        });
      },
    ],
    [
      "missing retained verification evidence",
      (w: any) => {
        w.jobs.verify.steps = w.jobs.verify.steps.filter(
          (step: any) => step.id !== "verification-evidence",
        );
      },
    ],
    [
      "retention artifact collides with Pages payload",
      (w: any) => {
        verifyAction(w, "actions/upload-artifact").with.name = verifyAction(
          w,
          "actions/upload-pages-artifact",
        ).with.name;
      },
    ],
    [
      "retention includes arbitrary agent records",
      (w: any) => {
        verifyAction(w, "actions/upload-artifact").with.path = ".agent/**";
      },
    ],
    [
      "retention omits browser witness",
      (w: any) => {
        verifyAction(w, "actions/upload-artifact").with.path =
          ".agent/artifacts/pages.json";
      },
    ],
    [
      "retention silently ignores missing files",
      (w: any) => {
        verifyAction(w, "actions/upload-artifact").with["if-no-files-found"] =
          "ignore";
      },
    ],
    [
      "deploy selects evidence instead of Pages payload",
      (w: any) => {
        w.jobs.deploy.steps[1].with.artifact_name = verifyAction(
          w,
          "actions/upload-artifact",
        ).with.name;
      },
    ],
    [
      "deploy downloads or processes audit evidence",
      (w: any) => {
        w.jobs.deploy.steps.push({ run: "cat .agent/artifacts/pages.json" });
      },
    ],
    [
      "wrong environment",
      (w: any) => {
        w.jobs.deploy.environment.name = "unprotected";
      },
    ],
    [
      "self-hosted PR runner",
      (w: any) => {
        w.jobs.verify["runs-on"] = "self-hosted";
      },
    ],
    [
      "missing timeout",
      (w: any) => {
        delete w.jobs.verify["timeout-minutes"];
      },
    ],
    [
      "publication cancellation",
      (w: any) => {
        w.jobs.deploy.concurrency["cancel-in-progress"] = true;
      },
    ],
    [
      "local action",
      (w: any) => {
        w.jobs.security.steps.push({ uses: "./unsafe" });
      },
    ],
    [
      "reusable workflow",
      (w: any) => {
        w.jobs.extra = { uses: "elsewhere/repo/.github/workflows/x.yml@main" };
      },
    ],
    [
      "container",
      (w: any) => {
        w.jobs.verify.container = "node:latest";
      },
    ],
    [
      "untrusted shell interpolation",
      (w: any) => {
        w.jobs.verify.steps.push({
          run: "echo '${{ github.event.pull_request.title }}'",
        });
      },
    ],
  ] as Array<[string, (workflow: any) => void]>)(
    "rejects %s",
    (_name, mutation) => reject(mutation),
  );

  it.each([
    "verify",
    "test",
    "build",
    "security:check",
    "check:architecture",
    "test:browser",
  ])("rejects package bypass in %s", (script) => {
    const value = packageJson();
    value.scripts[script] = "true";
    expect(() => assertPackage(value, vitestSource, nodeVersion)).toThrow(
      "CI policy:",
    );
  });
  it("rejects loss of full test discovery and unsupported toolchains", () => {
    expect(() =>
      assertPackage(
        packageJson(),
        vitestSource.replace(
          "src/tests/**/*.test.ts",
          "src/tests/app/*.test.ts",
        ),
        nodeVersion,
      ),
    ).toThrow("discovery");
    expect(() => assertPackage(packageJson(), vitestSource, "24")).toThrow(
      "toolchain",
    );
  });
  it("rejects malformed, duplicate-key, alias and anchor YAML", () => {
    for (const text of [
      "jobs: [",
      "jobs: {}\njobs: {}",
      "base: &base {a: 1}\ncopy: *base",
    ])
      expect(() => parseYaml(text)).toThrow("CI policy:");
  });
  it("rejects unverified release catalog entries", () => {
    const directory = mkdtempSync(join(tmpdir(), "wanderer-ci-pins-"));
    temporary.push(directory);
    mkdirSync(join(directory, "scripts/ci"), { recursive: true });
    const value = JSON.parse(
      readFileSync("scripts/ci/action-pins.json", "utf8"),
    );
    value.actions["actions/checkout"].sha = "0".repeat(40);
    writeFileSync(
      join(directory, "scripts/ci/action-pins.json"),
      JSON.stringify(value),
    );
    expect(() => loadPins(directory)).toThrow("provenance");
  });
});

describe("actual aggregate and publication decision programs", () => {
  const goodResults = () => ({
    verify: { result: "success" },
    security: { result: "success" },
  });
  it.each(["failure", "cancelled", "skipped", "", "pending", undefined])(
    "rejects %s predecessor in both evaluator and deployed script",
    (result) => {
      for (const name of ["verify", "security"]) {
        const values: any = goodResults();
        values[name] = { result };
        let failed = false;
        vm.runInNewContext(AGGREGATE_SCRIPT, {
          process: { env: { NEEDS: JSON.stringify(values) } },
          core: {
            setFailed: () => {
              failed = true;
            },
          },
        });
        expect(failed).toBe(true);
        expect(requiredResultsPass(values)).toBe(false);
      }
    },
  );
  it.each([
    {},
    { verify: { result: "success" } },
    { verify: null, security: {} },
    null,
    [],
    { ...goodResults(), extra: { result: "success" } },
  ])("rejects missing/incomplete results %#", (values) => {
    let failed = false;
    vm.runInNewContext(AGGREGATE_SCRIPT, {
      process: { env: { NEEDS: JSON.stringify(values) } },
      core: {
        setFailed: () => {
          failed = true;
        },
      },
    });
    expect(failed).toBe(true);
    expect(requiredResultsPass(values)).toBe(false);
  });
  it("accepts exactly all-success and rejects malformed JSON", () => {
    vm.runInNewContext(AGGREGATE_SCRIPT, {
      process: { env: { NEEDS: JSON.stringify(goodResults()) } },
      core: {
        setFailed: () => {
          throw new Error("unexpected rejection");
        },
      },
    });
    expect(requiredResultsPass(goodResults())).toBe(true);
    expect(() =>
      vm.runInNewContext(AGGREGATE_SCRIPT, {
        process: { env: { NEEDS: "invalid" } },
      }),
    ).toThrow();
  });
  it("covers the event/ref/conclusion truth table including forks and merge groups", () => {
    for (const event of [
      "push",
      "workflow_dispatch",
      "pull_request",
      "pull_request_target",
      "merge_group",
      "workflow_run",
    ]) {
      for (const ref of [
        "refs/heads/main",
        "refs/heads/feature",
        "refs/pull/1/merge",
        "refs/heads/fork/main",
      ]) {
        for (const conclusion of [
          "success",
          "failure",
          "cancelled",
          "skipped",
          undefined,
        ]) {
          expect(
            publicationAllowed({
              ref,
              event,
              aggregate: conclusion,
              producer: conclusion,
              successful: true,
            }),
          ).toBe(
            ref === "refs/heads/main" &&
              ["push", "workflow_dispatch"].includes(event) &&
              conclusion === "success",
          );
        }
      }
    }
    expect(
      publicationAllowed({
        ref: "refs/heads/main",
        event: "push",
        aggregate: "success",
        producer: "success",
        successful: false,
      }),
    ).toBe(false);
  });
  it("runs the actual freshness program against matching and advanced main", async () => {
    for (const match of [true, false]) {
      let failed = false;
      await vm.runInNewContext(`(async () => { ${FRESHNESS_SCRIPT} })()`, {
        context: { repo: { owner: "owner", repo: "repo" }, sha: "accepted" },
        github: {
          rest: {
            repos: {
              getBranch: async () => ({
                data: { commit: { sha: match ? "accepted" : "newer" } },
              }),
            },
          },
        },
        core: {
          setFailed: () => {
            failed = true;
          },
        },
      });
      expect(failed).toBe(!match);
    }
  });
});
