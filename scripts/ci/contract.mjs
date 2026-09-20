// This intentionally accepts one reviewed workflow, not arbitrary Actions expressions.
// Change this contract and its mutation tests together under independent owner review.
export const MANDATORY_JOBS = Object.freeze(["verify", "security"]);
export const ARTIFACT_NAME =
  "github-pages-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.sha }}";
export const DEPLOY_CONDITION =
  "${{ success() && github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && needs.ci-required.result == 'success' && needs.verify.result == 'success' }}";

export function requiredResultsPass(needs) {
  return (
    needs !== null &&
    typeof needs === "object" &&
    !Array.isArray(needs) &&
    Object.keys(needs).length === 2 &&
    ["verify", "security"].every((name) => needs[name]?.result === "success")
  );
}

export function publicationAllowed({
  ref,
  event,
  aggregate,
  producer,
  successful,
}) {
  return (
    successful === true &&
    ref === "refs/heads/main" &&
    ["push", "workflow_dispatch"].includes(event) &&
    aggregate === "success" &&
    producer === "success"
  );
}

export const AGGREGATE_SCRIPT = `const needs = JSON.parse(process.env.NEEDS);
if (!(${requiredResultsPass.toString()})(needs)) {
  core.setFailed('Every mandatory predecessor must succeed; missing, skipped, cancelled and failed results are rejected.');
}`;
export const FRESHNESS_SCRIPT = `const { data } = await github.rest.repos.getBranch({ owner: context.repo.owner, repo: context.repo.repo, branch: 'main' });
if (data.commit.sha !== context.sha) core.setFailed('main advanced after verification; publication refused');`;

export const REQUIRED_SCRIPTS = Object.freeze({
  "format:check": "node scripts/agent/format.mjs --check",
  typecheck: "tsc --noEmit",
  test: "vitest run",
  "check:architecture": "node src/tests/architecture-guard.mjs",
  "check:ci-policy": "node scripts/ci/policy.mjs",
  "test:ci-policy": "vitest run src/tests/agent/ci-policy.test.ts",
  build: "vite build && node scripts/security/artifact.mjs create",
  verify:
    "npm run format:check && npm run typecheck && npm run test && npm run check:architecture && npm run check:ci-policy && npm run build",
  "test:browser": "node scripts/agent/browser-test.mjs",
  "security:check": "node scripts/security/check.mjs",
  "agent:doctor": "node scripts/agent/doctor.mjs",
  "agent:finish": "node scripts/agent/finish.mjs",
});

export function expectedWorkflow(pins) {
  const action = (name) => `${name}@${pins[name].sha}`;
  const checkout = {
    uses: action("actions/checkout"),
    with: { "persist-credentials": false, "fetch-depth": 0 },
  };
  // No cache is used: no cache key can omit the toolchain or admit stale evidence.
  const node = {
    uses: action("actions/setup-node"),
    with: { "node-version-file": ".nvmrc", "package-manager-cache": false },
  };
  return {
    name: "Verify and deploy Pages",
    on: {
      pull_request: null,
      push: { branches: ["main"] },
      merge_group: null,
      workflow_dispatch: null,
    },
    permissions: { contents: "read" },
    concurrency: {
      group: "verify-${{ github.workflow }}-${{ github.ref }}",
      "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
    },
    jobs: {
      verify: {
        "runs-on": "ubuntu-latest",
        "timeout-minutes": 30,
        steps: [
          checkout,
          node,
          { run: "npm ci" },
          {
            run: "node node_modules/playwright/cli.js install --with-deps chromium",
          },
          { run: "npm run verify" },
          { run: "npm run test:browser -- --reuse-root-build" },
          {
            run: "node scripts/security/artifact.mjs verify --base /Wanderer/",
          },
          {
            uses: action("actions/upload-pages-artifact"),
            with: { name: ARTIFACT_NAME, path: "dist", "retention-days": 1 },
          },
          {
            id: "verification-evidence",
            uses: action("actions/upload-artifact"),
            with: {
              name: "verification-evidence-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.sha }}",
              path: ".agent/artifacts/pages.json\n.agent/artifacts/pages.browser.json",
              "if-no-files-found": "error",
              "include-hidden-files": true,
              "retention-days": 14,
            },
          },
        ],
      },
      security: {
        "runs-on": "ubuntu-latest",
        "timeout-minutes": 30,
        steps: [
          checkout,
          node,
          { run: "npm ci" },
          { run: "npm run security:check" },
        ],
      },
      "ci-required": {
        if: "${{ always() }}",
        needs: ["verify", "security"],
        "runs-on": "ubuntu-latest",
        "timeout-minutes": 5,
        steps: [
          {
            uses: action("actions/github-script"),
            env: { NEEDS: "${{ toJSON(needs) }}" },
            with: { script: AGGREGATE_SCRIPT },
          },
        ],
      },
      deploy: {
        if: DEPLOY_CONDITION,
        needs: ["ci-required", "verify"],
        "runs-on": "ubuntu-latest",
        "timeout-minutes": 10,
        // contents:read is used only for the pinned getBranch metadata check.
        permissions: { contents: "read", pages: "write", "id-token": "write" },
        environment: {
          name: "github-pages",
          url: "${{ steps.deployment.outputs.page_url }}",
        },
        concurrency: {
          group: "pages-publication-${{ github.repository }}",
          "cancel-in-progress": false,
        },
        steps: [
          {
            uses: action("actions/github-script"),
            with: { script: FRESHNESS_SCRIPT },
          },
          {
            id: "deployment",
            uses: action("actions/deploy-pages"),
            with: { artifact_name: ARTIFACT_NAME },
          },
        ],
      },
    },
  };
}
