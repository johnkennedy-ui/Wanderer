# Repository-change discipline: mechanisms and limits

This is the repository-local retrospective and portable checklist requested by
the hardening mission, not a new global policy or published agent skill. The
ignored completion receipt determines candidate acceptance; this document does
not certify local validation, GitHub protection or deployment.

## Corrected starting point

The reconciled baseline was `1eeed9714fb516cda707fed53adf72823da3e93d`.
It already had PR/main verification and browser checks. The earlier build-only
workflow belonged to a historical revision; claiming to introduce all CI here
would have been wrong. The actual gaps included privileged application builds,
manual publishing without a main restriction, moving action tags, rebuilding
Pages after browser tests, and completion records without content binding.

Normal Vitest discovery already included the three soak files. Baseline
`verify` passed 419 tests; adding a second identical mandatory soak invocation
would add cost, not coverage. The baseline browser run did not pass in this
environment: retained traces show the existing wall-placement journey exhausting
its unchanged 30-second watchdog. Full Chromium did not establish a successful
replacement run. This is a real acceptance gap, not evidence that security
hardening caused it, nor permission to drop assertions or extend timeouts.
That baseline failure is retained. A subsequent independent, unchanged-timeout
browser matrix passed 204 cases across root/Pages and desktop/touch, with all
309 snapshot files and eight fixtures unchanged. Its retained browser witnesses
and 69-file Pages output were rehashed by the parent. This is browser assurance,
not final security, committed-candidate or publication acceptance.

## What fails automatically now

| Previous failure mechanism                                          | Executable control                                                                                                                                   | Normal-test evidence                                           | Future encounter / owner                                                             |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Historical source mistaken for current baseline                     | Mission requires resolved baseline ancestry, branch and original fixture hashes; final identity includes HEAD/tree/index/worktree                    | `agent-tools.test.ts`, `finish.test.ts`                        | Mission start, doctor and finish; mission owner                                      |
| Privileged builds or non-main manual publication                    | Constrained workflow contract, standard YAML parser and pinned actionlint; distinct read-only verify/security and minimal deploy jobs                | `ci-policy.test.ts` mutations                                  | Every `verify` and PR/main/manual workflow; repository owner reviews policy changes  |
| Skipped or swallowed mandatory checks yield a green aggregate       | Exact job structure and `always()` aggregate require both mandatory results to equal success                                                         | `ci-policy.test.ts`                                            | Same required CI status; owner must separately enforce the observed status on GitHub |
| A fresh post-test build is substituted for tested bytes             | Build manifests plus browser witnesses bind output contents/modes/membership and source/tool/run identity; pre-upload verifier checks existing bytes | `artifact.test.ts` and the production browser runner           | Every build/browser/upload path; CI maintainer                                       |
| Scanner exit zero or malformed output called clean                  | Schema/count/findings validators, mandatory report digests, execution status and freshness                                                           | `security.test.ts`                                             | Every complete security gate; owner reviews thresholds and tool pins                 |
| Mutable cache markers bless modified scanner code                   | Trusted archive digest and complete installed-file/type/mode comparison; fixed tool package boundary                                                 | `security.test.ts` plus real bootstrap/cache verification      | Every scanner start; security-tool maintainer                                        |
| Changed app tests omitted; `saveProjection.ts` misses save coverage | Shared ownership/impact mapping selects changed tests and save/session checks, escalating deletions and unknown paths                                | `agent-tools.test.ts`                                          | Focused iteration and impact reporting; harness maintainer                           |
| Old PASS survives HEAD/index/source/fixture changes                 | Before/after input fingerprints; frozen candidate; current fixture rehash and original record/log validation                                         | `agent-tools.test.ts`, `finish.test.ts` temporary repositories | Every run and finish, not a remembered checklist; harness maintainer                 |
| Ignored/untracked build inputs escape identity                      | Controlled input membership, unexpected ignored-input rejection and output-import guards                                                             | `agent-tools.test.ts`, `finish.test.ts`                        | Before/after each recorded command and completion                                    |
| Exit-zero formatter does nothing to new source                      | Include new eligible source; inspect ignores and generated exclusions; recheck actual bytes after writing                                            | `agent-tools.test.ts` false-writer and path-boundary tests     | `format` and focused formatting; formatter maintainer                                |
| A report or arbitrary successful command is called completion       | Fixed complete finish command set; missing, stale, foreign, interrupted or invalid records fail; one candidate-keyed result                          | `finish.test.ts`                                               | `agent:finish`; mission owner                                                        |

Compatibility wording points to hashed current save/decoder/generator contracts
instead of preserving an obsolete version list. Those hashes identify the
reviewed documents and source, not proof that prose and runtime necessarily
agree. Released fixtures, generators, storage keys and gameplay authority remain
outside this hardening task's change scope.

## Recovery lessons and remaining review boundaries

- The first real CodeQL extraction exposed a package-scope problem: its bundled
  CommonJS parser inherited the game's ESM declaration. A fixed, verified tool
  package boundary solves that without editing vendor archive bytes.
- Real analysis then found security warnings, rather than merely producing a
  successful upload. Descriptor-bound regular-file reads and correct Markdown
  escaping address concrete flagged mechanisms. The actionlint downloader's
  checksum boundary now has offline child-process regressions in
  `actionlint.test.ts`: failed downloads, wrong downloaded bytes, spawn errors,
  termination signals and corrupt cached archives must all fail before
  extraction/execution. The child imports the real bootstrap after replacing its
  subprocess boundary with inert results; it does not require executable
  temporary files or make network requests. The original PATH-script fixture
  returned `EACCES` in independent QA, so it did not exercise the intended exit
  and checksum branches there. That failure remains recorded, not reclassified
  as a passing checksum test. The production downloader was unchanged for these
  tests. Its earlier change from checksum-guarded fetch
  to curl still needs independent scrutiny: disappearance of the former taint
  warning is not proof of a stronger security boundary.
- An interrupted scanner left successful extraction but no terminal all-scanner
  result. Recovery verified archived project bytes and resumed only analysis of
  the finalized database. It did not invent an exit code, repeat finished
  extraction, or promote the incomplete original run to PASS.
- Independent QA also exceeded the unchanged five-second timeout in two finish
  tests. A parent-only stage probe ran the same completion operations below that
  limit, but cannot establish why the QA environment was slower. No timeout,
  assertion or production completion check was relaxed; the same independent
  environment still needs a diagnosed rerun. A later QA continuation failed
  before work because process identity could not be inspected. A launch receipt
  or a parent-only pass cannot stand in for that missing independent result.
- Parent-readable evidence was not initially readable in delegated sandboxes.
  Those blocked handoffs are not reviews. Future handoffs must first prove the
  receiving role's permitted path, goal operations and reporting route; do not
  change sandbox policy or weaken independent review to obtain a response.
- Repository-local checks are editable by the same writer. They detect drift,
  not malicious rewriting of both policy and evidence. Protected independent
  owner review and observed GitHub enforcement remain separate requirements.
  The sole authenticated account cannot independently approve its own changes.

## Security-review correction evidence

The independent security review returned four source-derived findings, not
executed reproductions or publication approval. Output exclusions were the
first reproduced boundary: 12 new rejection regressions failed against the
original implementation while five output/control cases passed. A shared
source/scanner exclusion and reference guard then passed all 38 agent-tool
checks. Further dedicated tests exposed 30 remaining compiler-alias and inline
HTML-module cases against that first guard (115 controls already passed).
Those failures are retained; the correction checks compiler input aliases and
inline modules through the same path policy. An actual repository fingerprint
then caught Vite's supported `%BASE_URL%` HTML token, which synthetic cases had
missed. The narrow token normalization retains output-root rejection and passed
147 policy cases, typechecking, formatting and actual input collection.

Fifteen new execution-receipt rejection tests failed on the unchanged security
validator, demonstrating the senior review's completeness and malformed-empty
findings gaps. The schema-3 correction binds exact commands/scopes, cwd/timing,
complete unique logs and report identities, and validates the real runner's
emitted receipts through inert scanner boundaries. A worker's separate archive
candidate was rejected during root diff inspection for a doubled binary path,
private execution still inside the mutable cache, and incomplete race/evidence
coverage despite its reported focused success. This is why self-report and
fixture-only success cannot substitute for checking actual integration paths.
The corrected archive lifecycle now snapshots verified bytes through no-follow
descriptors and executes only within a private callback. Parent integration
also caught CodeQL's old cache-root-relative binary being appended twice; the
fixture now models the real `codeql/codeql` archive layout. Default pins are
frozen, and fixture specs are explicitly injected rather than changing global
pins. Missing raw worker logs remain missing historical evidence, not invented
receipts; changed-candidate checks retain their actual logs.

The process helper preserves the root's real wait status while reaping ordinary
descendants. Schema-4 receipts require private-tool identity, exact invocations,
complete logs, no interruption and completed cleanup. Consumer cancellation
stops later scanners and leaves a failed result. Unknown or contradictory
supervisor status cannot substitute for root success. The outer gate group is
retained; SIGKILL cannot finalize evidence and is never represented as a
successful cleanup listener.

The next security rereview accepted the private archive and schema-4 receipt
corrections but found two remaining cases: compiler aliases resolved against
the wrong `baseUrl`, and forced cleanup that settled a promise while inherited
pipes could keep a standalone caller alive. Three new pipeline regressions
reproduced five command invocations instead of the required single one.
The terminal-cleanup consumer correction passes those three cases, preserves
the failure logs and records every later step as failed without invoking it.
Compiler resolution and standalone process containment remain separate scoped
corrections until their own tests and independent rereview are complete.
Parent integration reproduced six `baseUrl=src` exclusion failures before
applying the compiler correction. Real TypeScript resolution tests now cover
inherited aliases into every excluded root, with legitimate source and
symlink-rejection controls. The first integration run rejected `.agent` through
its older guard before the new alias check; its assertion now requires the
exact shared rejection code rather than one guard's wording. No rejection was
removed. A later rereview found wildcard alias substitution could still map
`hidden/.vite/input` through `paths: { "hidden/*": ["*"] }` after the literal
pattern had passed, and the next pass found prefix-only checks still allowed
`paths: { "hidden/*": ["di*"] }` to complete into `dist`. A later pass found
the alias phase still missed import-type nodes, import-equals declarations and
dynamic imports with options. The guard now checks actual substituted candidates
for module references extracted by the same parser used for literal checks,
including import-type/import-equals forms, traversal captures and
`node_modules/.vite`, before fingerprinting and scanner dispatch are refused.

Scanner review also rejected a test that covered only cooperative cleanup, then
caught an unbound reused-PID risk in fallback selection. The corrected helper
has an original-supervisor identity check and a pure synthetic ownership
selector test, without targeting unrelated real processes. The next rereview
found supervisor death still lost the owned descendant tree after reparenting,
and then that a scanner root could exit after spawning a long-lived child. The
supervisor was changed to stream root and descendant PID/start-time snapshots.
That sampling approach still missed an unsampled descendant after its recorded
ancestor exited, and separate ancestry/start-time reads could renew a reused
PID. Parent inert checks also reproduced the race between the last identity
read and a bare-PID signal, plus acceptance of a JSON suffix from an oversized
unfinished telemetry frame. These were implementation defects, not reasons to
weaken cleanup or evidence requirements.

The current correction adds a per-command inherited-group guardian/subreaper
and stable pidfd signaling with post-acquisition creation/ancestry checks in
Python. Node no longer signals bare PIDs: its emergency path only releases its
own pipes and records unknown cleanup. The frame parser discards oversized
unfinished lines through the next delimiter, while preserving valid batched
and fragmented frames. Inner-supervisor death remains failure even if adopted
descendants are contained. Missing pidfd support, guardian failure and hostile
breakaways are not successful cleanup guarantees.

Regression claims must prove the actual sequence, not marker names: telemetry
stopped before child creation, ancestor exited before supervisor death, and a
standalone failed security pipeline with no later scanner dispatch or test-side
rescue. Timeout and cancellation remain distinct cases. Development Python
bytecode artifacts are retained outside the integration set, not hidden by a
new source exclusion. Combined validation and independent security rereview
remain required before these corrections can clear release.

Real private-tool version checks also exposed a scratch-space assumption that
inert fixtures missed. Gitleaks succeeded, but CodeQL extraction failed because
the inherited temporary directory was a 1.6 GiB tmpfs. The failed private run
was cleaned. Only CodeQL was retried with adequate disk-backed scratch space;
the same version check and cleanup assertions then passed. No timeout, vendor
bytes, global configuration or cached success record was changed. Version-only
success is not a substitute for the final full source scan.

Neither focused success nor an integrated patch supersedes required senior
re-review, independent browser/CLI QA or the fresh committed completion gate.
Final execution and acceptance remain separately evidenced.

## Measured cost, not claimed speedup

Baseline measurements recorded a cold task-local dependency install of 10.31s,
a focused simulation-speed test of 1.27s, and complete baseline `verify` of
139.91s. The interrupted baseline browser attempt consumed 1155.94s and is not
a passing full-gate timing. Later focused control validation passed 203 tests
across five files, with Vitest reporting 16.21s; it is a different workload and
must not be presented as an equivalent-suite speedup.

Final comparable install/unit/architecture/browser/security timings belong in
the final ignored receipt. Record cache state, tool/runtime identity, network
and resource effects. CodeQL installation, full archive verification and analysis
are substantial costs: run focused parser/control tests during iteration and
fresh full scanning for completion/CI, not on each edit. Root-build reuse removes
one duplicate build by construction; realized wall-clock savings remain unproven
until comparable successful full gates exist.

## Portable repo-change discipline checklist

1. **Resolve current truth.** Retrieve the original authorized goal; retrieve or
   create a linked receiving-session goal and verify its ID and ACTIVE status.
   Stop BLOCKED if required goal operations are unavailable. Resolve the actual
   repository/HEAD, instructions and existing controls; treat old reports as leads.
2. **Establish authority and baseline.** Record owner, allowed paths, exact base,
   dirty/unrelated work, fixture hashes, toolchain and acceptance gates. Separate
   local edits/commits from remote writes and settings authority.
3. **Classify changes.** Use one ownership map. Include changed tests themselves,
   renames/deletions and cross-cutting configuration; escalate uncertain impact.
4. **Make a bounded cut.** Use one writer per worktree. Parallelize only ready,
   independent slices after proving worker-visible inputs and result delivery.
   A launch receipt is not evidence that a worker inspected or changed anything.
5. **Run selected checks.** Preserve command, time, exit, log and input identity.
   Diagnose repeated equivalent failures before retrying; preserve the trail.
   Check actual generated/formatted bytes, not just command exit status.
6. **Freeze the candidate.** Finish source/docs/configuration, normalize, inspect
   the diff, complete required review and commit the intended files. Preserve
   unrelated work and fixtures.
7. **Run the complete required gate.** Focused success does not replace complete
   browser/security/interface acceptance. Preserve explicit independent QA and
   security/privilege review; never self-approve an unresolved exception.
8. **Validate evidence freshness.** Rehash current source, outputs and fixtures;
   reject missing, interrupted, foreign, malformed or stale evidence. Refresh
   time-sensitive advisory data. Keep output reports outside source identity.
9. **Check remote enforcement separately.** Only with separate authority, inspect
   actual event/SHA/check/App/protection/artifact identities. Distinguish PR head,
   synthetic merge and main; do not infer enforcement from a local simulation.
10. **Report scope truthfully.** Name local, remote, settings and deployment
    results independently. Missing mandatory local acceptance remains incomplete;
    preserve the original goal, next safe action and resumption condition.
