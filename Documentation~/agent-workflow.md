# Agent mission workflow

Repository state and evidence live in ignored `.agent/`. They supplement the
receiving agent's own active goal; they do not replace the original user goal or
grant publication/settings authority. Preserve baseline, fixtures, unrelated
work and the original objective through corrections and continuation.

## Start, iterate, freeze, complete

Use the exact repository Node version in `.nvmrc` and npm 11.x, then `npm ci`.
Install locked Playwright Chromium separately on first use. Linux x64 plus
Python 3 is the currently supported local scanner-bootstrap platform.

```bash
npm run agent:mission-start -- --mission <id> --objective "<objective>" --baseline <full-commit>
npm run agent:status
npm run agent:run -- --timeout 180 -- npm run typecheck
npm run agent:check
npm run agent:evidence
```

Start requires a feature branch, a baseline descended from `a4c74f9`, and no
pre-existing tracked changes. Approved untracked `FRANK_*.md` specifications are
preserved, not formatted. Existing schema-1 missions can be upgraded without
restarting or losing their timestamp, objective, baseline, fixture hashes or
historical runs:

```bash
npm run agent:mission-start -- --upgrade-record
```

Upgrade verifies baseline ancestry and fixture bytes and retains the old record
under `.agent/history/`. Historical command records are never promoted to current
passing evidence. Do not use `--replace` to erase a failed task or evade a budget.

The shared `impact-map.mjs` drives focused selection and save/world impact
statements. Added/modified/renamed tests select themselves; deleted tests require
owning/full coverage and review. `saveProjection.ts` selects save and session
checks. Unknown paths and harness/CI/dependency/config changes escalate safely.
It includes staged, unstaged and untracked repository files, excluding only
agent/dependency runtime outputs. A requested filtered test command that selects
no tests fails in its own runner; an intentional no-browser decision is reported
as `browserCoverage: "none"` for documentation-only impact.

`agent:check` is development feedback: it never launches a browser matrix.
`agent:check -- --complete` keeps the full inexpensive `verify` suite for an
executable finished change, then uses the same impact map to select either
primary + Pages smoke browser coverage or the full two-base matrix. Legacy
`agent:check -- --full` remains an explicit full-matrix completion-style check.
These are profiles, not sequential gates: a later Finish reuses valid matching
`verify` and browser records instead of running them again. Run the completion
profile only after committing the frozen candidate; pre-commit records have a
different source fingerprint and Finish must rerun the affected gates.

Formatting includes new as well as tracked eligible source, preserves approved
specifications and generated lockfiles, refuses symlinks/outside paths, and
checks actual formatted bytes after a writer returns. Empty selection is no work,
not a claim that files were formatted. Python/TOML and binary assets are outside
Prettier's supported policy; their own parsers/consumers must validate them.

After review, commit all source, docs and configuration, then run completion on
that exact committed candidate:

```bash
npm run agent:check -- --complete
npm run agent:doctor
npm run agent:finish
```

Use exactly one Finish mode. For base-path/build/asset/deployment/harness
changes, replace the normal Finish command above with:

```bash
npm run agent:finish -- --full-matrix
```

To validate the existing required records later without rerunning them:

```bash
npm run agent:finish -- --check-only
```

Doctor distinguishes environment prerequisites from code outcomes: Node/npm,
locked dependency tree, browser/libraries, scanner platform, current mission
policy, baseline ancestry, dirty/untracked/ignored inputs and stale records.
Readiness does not establish PASS. Finish requires a frozen candidate. Its normal
release scope is `verify`, the full root browser suite with root-build reuse,
the focused Pages smoke suite, fresh security, and final Pages artifact
verification. The Pages smoke reuses existing tests (no copies): direct startup,
model/GLB loading, initial controls, campfire save/reload, a public boss journey,
and production CSP. `--full-matrix` replaces that browser scope with the retained
full two-base matrix for cross-cutting base-path risk. No rebuild follows the
browser gate.
It checks each fixed command's schema, mission/repository/baseline, actual
HEAD/tree/index/source/dependency fingerprint, times/exit/interruption, and
original record/log digests. It rehashes historical fixtures and time-sensitive
security evidence. Arbitrary successful commands and report creation are not
completion.

`agent:run` records fingerprints before/after, including relevant untracked
inputs and reviewed non-secret environment values. Unexpected ignored build
inputs fail; evidence-only outputs do not change source identity. Tool caches
are independently checked against pinned archives; output imports/executable
bypasses are rejected. This is drift detection, not independent authority against
someone who can edit both the checks and their records.

After two materially identical failures, stop blind retries. Preserve the logs,
record diagnosis and the actual change, and only then use
`--force-after-diagnosis "<specific diagnosis and intervention>"` where warranted.
The runner preserves failed receipts and process-tree timeout/interruption
handling; an unrelated success cannot erase a required failure. Do not increase
individual test watchdogs, remove assertions or drop suites to manufacture green.

Successful completion writes one candidate-keyed JSON/Markdown pair under
`.agent/completions/`, explicitly separating local PASS from unverified remote
CI/settings and unperformed deployment. `agent:evidence` remains an inspection
report only. Apply the [CI/security contract](CI_SECURITY_CONTRACT.md) before any
separately authorized remote action. Final candidate evidence and independent
review—not these instructions—determine acceptance.
