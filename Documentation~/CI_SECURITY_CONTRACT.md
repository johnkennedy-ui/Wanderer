# CI and security operating contract

This contract describes executable controls, not a statement that this candidate
has passed local validation or been installed on GitHub. The final ignored
completion receipt and independently observed GitHub run/settings identify what
actually passed. A failed or unavailable mandatory check means local acceptance
is incomplete.

## Boundaries and maintainers

The repository owner maintains the constrained workflow, action pins, artifact
membership and scanner policy. Changes to `.github/`, `scripts/agent/`,
`scripts/ci/`, `scripts/security/`, lockfiles and this contract require independent
owner review. `CODEOWNERS` expresses routing, not enforced protection or a way
for the sole account to approve its own PR. Repository-local checks are editable
by a writer and are not an independent cryptographic trust authority.

- `scripts/ci/policy.mjs` uses the standard YAML parser, rejects duplicate keys
  and unsupported structures, and invokes checksum-pinned actionlint. It accepts
  the explicit shape in `scripts/ci/contract.mjs`, not arbitrary expression
  semantics. Mutation coverage is `src/tests/agent/ci-policy.test.ts`.
- `verify` covers formatting, TypeScript, all Vitest tests (including the three
  already-discovered soak files), architecture, CI policy and one root build.
  Do not append the identical soak suite as a second mandatory execution.
- Every PR, main push, merge-group and manual run verifies; there are no path
  filters or skip-marker conventions. Manual feature-branch runs cannot publish.
- `verify` and `security` run on ephemeral GitHub-hosted runners with read-only
  contents, no persisted checkout credential, and no Pages/OIDC authority.
  `security` runs CodeQL locally and evaluates findings; no SARIF upload or
  security-events permission is needed. Analysis exit zero is not acceptance.
- `ci-required` evaluates `always()` and explicitly requires both named jobs to
  have result `success`. Missing, failed, cancelled and skipped results fail.
- Deploy needs both producer and aggregate. Only main push/manual-main events
  qualify. The protected `github-pages` environment and only the deploy job
  receive Pages/OIDC permissions. This job has no checkout, npm, application
  command or arbitrary artifact URL; pinned actions inspect main freshness and
  deploy the exact same-run artifact name.
- Publication concurrency serializes deployment, but main can advance after the
  final metadata read. This residual race is not an ordering guarantee; enforce
  owner review and inspect the deployed run/SHA when publication is authorized.

## Tested artifact continuity

`build` creates `.agent/artifacts/root.json` or `pages.json` immediately after
Vite. Manifests are outside `dist`, sorted, and bind file contents/modes, the
source/index/working-input fingerprint, HEAD/tree, lockfile, Node/npm, base path,
and workflow run/attempt. `.agent/artifacts/*.browser.json` is reset by each
build. A manifest alone is not proof that a browser test passed.

`test:browser` builds and tests `/` and `/Wanderer/`, checking the artifact before
and after each matrix. `--reuse-root-build` requires the manifest already made
by `verify`; it avoids rebuilding that root output. The command leaves the
browser-tested Pages output. Its CLI pre-upload verifier requires the successful
browser witness; never recreate a manifest or rebuild after those checks.
`upload-pages-artifact` uses the exact name
`github-pages-${run_id}-${run_attempt}-${sha}`, used unchanged by deploy.

After uploading those verified bytes, the read-only verification job retains
only `pages.json` and `pages.browser.json` in a separate full-SHA-pinned artifact,
`verification-evidence-${run_id}-${run_attempt}-${sha}`, for 14 days. Missing
evidence fails verification. The manifest preserves the source/tree/lock/tool
identity and output hashes after runner disposal. No raw scanner/agent logs are
included. This audit artifact stays outside `dist`; deploy neither downloads nor
executes it and gains no new permissions. Actual remote retention remains
unverified until an authorized workflow run is observed.

The membership policy is the reviewed original `public/` asset list in
`scripts/security/public-assets.json`, plus the actual hashed entry JS/CSS and
HTML. New public files are not silently authorized. Unexpected payloads, empty
unexpected directories, missing files, executable files, symlinks, source maps,
and changed public asset bytes fail. Asset-policy changes require review, not a
blanket extension allowlist. Unit and CLI regressions are in `artifact.test.ts`.

Production source maps are disabled. `index.html` supplies a production meta
CSP with same-origin scripts and no script `unsafe-inline`/`unsafe-eval`.
Style allowances support the existing renderer/UI; inspect the actual policy
before changing them. The browser security scenario runs at both bases, checks
storage/rendering and attempts a deliberately blocked inline script. The normal
gameplay matrix remains mandatory. Meta CSP does not implement header-only
`frame-ancestors`, report-only or hosting response headers. The same meta policy
is present during development; there are no dev-only relaxations configured.
No hosting response-header or native-device claim is implied.

## Security acceptance and evidence

`security:check` is the complete scanner gate, not a per-keystroke command:

| Control                   | Acceptance and limitation                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm audit, full + runtime | Supported JSON schema and consistent counts; no unaccepted findings at any severity. Build/dev tools execute in CI even when not shipped. Network/schema/execution errors are not zero findings.                                                                                                                                                                                                                                                                                                |
| npm audit signatures      | Records packages actually audited, verified registry signatures and separately verified provenance attestations. Unsupported, invalid or incomplete coverage fails. Cross-platform lock entries and packages without provenance are distinguished from installed coverage.                                                                                                                                                                                                                      |
| npm SBOM                  | CycloneDX full/build and runtime inventories, separately bound to source/lock identity. Inventory is not vulnerability clearance.                                                                                                                                                                                                                                                                                                                                                               |
| Gitleaks                  | Pinned archive checksum, redacted reports, source snapshot including untracked inputs, plus non-shallow fetched reachable history `--all HEAD`; records refs and commit count. This is not a claim to inspect unavailable remote/unreachable history.                                                                                                                                                                                                                                           |
| CodeQL                    | Pinned maintained JavaScript/TypeScript security-and-quality suite on an isolated source snapshot, using the reviewed `.github/codeql-config.yml` production-source boundary; successful execution plus SARIF acceptance. Warning/error/security findings, unknown schema, incomplete invocation and unreviewed suppressions fail. Test-only fixture construction remains covered by Vitest and the scanner-process security tests rather than being silently treated as shipped-code findings. |

Pinned Linux x64 archives are cached under `.agent/tools/`; no global
installation or credential is required. Python 3 opens archive paths through
no-follow directory descriptors and copies a checksum-verified snapshot into a
fresh mode-0700 temporary directory. Extraction consumes that snapshot, not a
reopened cache path. Cache membership, regular-file types, hashes and modes
remain checked; a marker cannot bless changed vendor files. Downloads publish
create-if-absent and a competing winner must still pass verification.

Gitleaks tree/history and CodeQL create/analyze run inside a private verified
archive callback. The executable remains present until supervised commands
settle, then `finally` removes the private run. Actionlint also extracts and
executes privately. CodeQL's archive-relative `codeql` member and a private
CommonJS package boundary preserve the vendor layout without editing vendor
bytes. Cache-path replacement cannot redirect an already-private executable;
this is not protection against arbitrary same-UID or kernel compromise.

A per-command Linux Python guardian and its inner supervisor are subreapers;
both remain in the outer gate's process group. The guardian can adopt ordinary
descendants when the scanner ancestor or inner supervisor exits, rather than
relying solely on periodically sampled ownership. Timeout, bounded byte output
and SIGTERM/SIGINT/AbortSignal request bounded termination and reaping. Missing,
malformed or contradictory status, unknown cleanup, abnormal supervisor exit
and interruptions fail closed. SIGKILL cannot finalize a receipt; an incomplete
run cannot become PASS. Hostile breakaways and a killed guardian are not a
claim of successful catchable cleanup; an outer group kill still contains the
ordinary inherited group.

Python cleanup acquires Linux pidfds, rechecks the recorded creation identity
and complete parent chain after acquisition, then signals through those stable
handles. Unsupported handle operations must not fall back to bare-PID signals.
Node's deadline fallback releases its inherited pipes and returns unknown
cleanup; it does not signal processes by PID or prove that the guardian reaped
them. Inner-supervisor death remains a terminal failure even when the guardian
contains its descendants. No later scanner may run after unproven cleanup.

Ownership telemetry uses individually bounded newline-delimited frames. The
caller keeps the latest valid snapshot, handles fragmented and batched frames,
and discards an oversized unfinished frame through its delimiter before
accepting another. Telemetry is diagnostic, not independent signaling
permission. Required regressions include creation-identity reuse, an unrecorded
child after ancestor and supervisor exit, ordinary timeout/cancellation,
malformed status, natural standalone failed exit and zero later dispatch.
Focused tests are not a substitute for independent review or the final gate.

Tool downloads and private CodeQL extraction are substantial costs; retain the
archive cache, never cache PASS records. Dependabot maintains action/npm version
updates; enabling security updates is a separate owner setting.
Check the actual Node temporary directory and its free space before private
extraction: the pinned CodeQL archive and extracted tree together need more
than 2 GiB, before analysis output. An inherited small tmpfs is not equivalent
to disk-backed `/tmp`. Select adequate scratch space for the invocation; do not
delete retained evidence or alter global configuration to make a check pass.

There are **no owner-approved exceptions**. `exceptions.json` must remain empty;
expired, incomplete, duplicated or self-approved entries fail. A genuine future
exception needs independent owner approval, exact advisory/package/version/path,
applicability, mitigation, expiry and retest condition plus a reviewed matcher.
An approval-looking string cannot grant authority.

Reports live under `.agent/security/runs/<run-id>/`. Summary schema 4 requires
all eight ordered scanner steps and nine exact invocations, including command,
arguments/scope, normalized working directory, timeout, finite duration and
ordered start/end timestamps. Each invocation has unique complete stdout/stderr
logs with hashes and byte counts; both CodeQL invocations must be present.
Private commands use exact `@verified/<tool>/<archive-member>` identities bound
to pinned archive and binary/content hashes. Every command must attest no
interruption, normal termination and completed reaping; a lifecycle or cleanup
failure cannot preserve a passing summary.
Unproven cleanup is terminal for that invocation: retain the failed command's
logs and receipt, and start no later scanner or tool callback. This is distinct
from a user interruption and cannot be reclassified as completed reaping.
SBOM identity/scope files and Gitleaks history refs/range/count are required and
revalidated against the current source identity. Secret findings must be an
actual empty array, not another JSON value with a zero `length` property.
A new run atomically replaces any old summary with a non-admissible running
receipt before prerequisite reads; the completed producer uses the same strict
validator as later evidence collection. Older schema-2/3 summaries are retained
but cannot pass the current gate.

Scanner identities, unchanged source inputs and valid timestamps with maximum
age 24 hours remain mandatory. Finish runs security fresh rather than
indefinitely reusing advisory data. Missing, malformed, stale or foreign evidence
fails. Raw redacted diagnostics remain local; do not publish reports containing
private paths or credential values.

## Output-only input boundary

`input-path-policy.mjs` supplies one exclusion predicate to the source
fingerprint and scanner snapshot: `.agent`, `dist`, `test-results`,
`playwright-report`, `.vite` and `node_modules/.vite` are output-only roots.
Locked dependency files have a separate complete fingerprint inventory; only
its top-level `.vite` cache is excluded from that inventory. An unreferenced
build/report change does not invalidate source evidence, but referencing these
output roots as source inputs is rejected, even when the reference occurs in
an intermediate helper rather than the top-level configuration.

The locked TypeScript parser checks imports, type-only imports, import-type
nodes, import-equals references, re-exports, `require`, module resolution,
simple constant dynamic imports including import-options syntax, literal URL
references, compiler input/alias fields, and supported build/test configuration
path strings.
Compiler aliases use TypeScript's effective `baseUrl` and configuration-origin
semantics. Inherited configurations come only from hash-bound regular-file
members of the same source fingerprint through the no-follow reader. External,
dependency-package or symlinked configuration inheritance is unsupported and
fails closed. Wildcard path mappings are checked both as declared patterns and
after substituting actual source module specifiers from the same fingerprint;
prefix-only confinement and traversal captures cannot make output roots into
source inputs. Anchored source aliases remain supported. The parser cannot
discover unrecorded input files.
Unresolved host module imports fail for review; browser-test `page.evaluate`
callbacks are explicitly a browser execution boundary, not a host import.
HTML script/resource references and CSS imports/URLs use the same path policy.
These are constrained repository checks, not a proof of arbitrary JavaScript
or shell semantics. New indirect input mechanisms require independent review
and regression coverage rather than an exception to the exclusion policy.
Tests cover every output root, source/scanner consistency, encoded/normalized
paths and evidence-only stability in `input-path-policy.test.ts` and
`agent-tools.test.ts`.

## Completion, review and rollback

`agent:finish` is the only supported local completion command. Commit all source,
documentation and configuration first, then run it. It verifies identity and
prerequisites, runs the fixed complete gate through the existing bounded runner,
rehashes historical fixtures and artifact/security evidence, and writes one
candidate-keyed JSON/Markdown receipt under `.agent/completions/`. The
`--check-only` option verifies existing required records; it cannot turn missing
or stale checks into success. `agent:evidence` is an inspection report, not PASS.

The result deliberately separates local PASS, remote CI not verified, settings
not verified and deployment not performed. PR-head, synthetic merge and main
SHAs are distinct. Local lint/simulations never prove GitHub enforcement.

Stop publication on identity/security failure. Correct or revert the isolated
fault through the same reviewed gate; retain main-only restrictions, immutable
pins and least privilege. Never restore the historical privileged/build-only
workflow, force-reset history or disable checks for a green deployment. A
known-good artifact may be republished only with its recorded identity and
separate deployment authority. Saves and historical fixtures remain untouched.

## Owner actions still requiring separate authority

Read-only observations on 17 September 2026 found main unprotected and no
rulesets; Pages already allowed only the `main` branch; CodeQL default setup was
not configured; private vulnerability reporting and vulnerability alerts were
disabled. These observations are historical readback, not installed candidate
policy. The authenticated actor and only eligible collaborator were both
`johnkennedy-ui`, so self-approval cannot establish independent review.

1. Review the local candidate and arrange a genuinely separate eligible reviewer
   or distinct limited automation identity; do not create a sole-account approval
   deadlock or give the agent a bypass.
2. Separately authorize a normal feature PR. Observe actual checks and their
   exact names/App/event/tested SHA before selecting `ci-required` as required.
3. Protect main: required PR/review and observed checks, no agent bypass,
   force-push or deletion; require owner review for policy/lock/ownership changes.
4. Re-read Pages main-only policy; agree practical independent deployment
   approvals and administrator-bypass policy. Do not change settings implicitly.
5. Review allowed/pinned Actions, Dependabot alerts/security updates, secret
   protection and private reporting availability. CodeQL here is enforced by the
   mandatory security result evaluator; do not claim a green SARIF upload is a
   merge threshold or install duplicate default analysis without review.
6. Capture readback and authorized PR/main runs independently. Deployment is
   optional and separately authorized; only claim it with run/artifact/SHA and
   hosted smoke evidence. No remote writes are authorized by this document.
