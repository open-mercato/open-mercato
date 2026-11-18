# Stabilize main — 2026-11-15

## Goal
Verify the current main baseline with the full CI suite and fix demonstrated root causes on `stabilize/main-2026-11-15-1600`, targeting main.

## Scope
CI failures reproduced from main and the stabilization PR. Existing `FORCE_FULL_SUITE` already includes same-repository `stabilize/` branches and `ci-full`; preserve that tested behavior.

## Non-goals
No speculative production changes, test suppression, weakened checks, deployment, base-branch merge, or unrelated cleanup.

## Implementation Plan
### Phase 1: Baseline and diagnosis
1.1 Open draft PR from main and confirm all 15 integration shards, full typecheck and unit tests are selected.
1.2 Independently inspect main CI history and identify actionable failures.
### Phase 2: Stabilization
2.1 Fix demonstrated root causes with regression tests; run targeted checks and the configured validation gate.
2.2 Verify the exact PR head has green CI, including all 15 integration shards.
### Phase 3: Review and handoff
3.1 Dispatch one final independent cezar review, validate its evidence, and address actionable findings.
3.2 Publish verification evidence, mark the PR ready, and apply automerge only after all checks are green.

## Risks
The date-only branch and plan belong to the earlier completed run (merged PR #9558); this scheduled occurrence uses the 1600 suffix to preserve its history.
Main continues moving. Test this branch in its own PR concurrency group and inspect checks plus workflow runs for the exact head SHA. At triage, the latest main runs were pending/in progress; completed recent runs passed. Do not invent fixes when none are demonstrated. User authorizes CI workflow/label changes and branch publishing for this run. Local resource or service limits will be recorded explicitly.

## Validation evidence
Runner: local for docs-only validation (`git diff origin/main --check`, manual review); 40 existing CI orchestration tests passed. No markdown lint command is configured. Full application validation source: GitHub checks, avoiding a duplicate local install/build.

[Full PR CI 43727725703](https://github.com/open-mercato/open-mercato/actions/runs/43727725703) succeeded on head `c1537c359a1d03f1961bd872241aa95d33dc9ae1`: all 15 integration shards, coverage aggregation, full typecheck/unit/scripts/template parity, package/app builds, i18n checks, lint, Docker build, timezone and document collaboration checks passed. The unchanged-dependency audit is intentionally skipped for this docs-only PR.

Independent investigation c2245c28 made no changes. Its main run evidence was checked directly: [43725929826](https://github.com/open-mercato/open-mercato/actions/runs/43725929826) succeeded on `f76558d6553dc5cc3400c9e18d6ecdfb0dfa42e8`, all 15 shards. No current root-cause fix is justified. Historical retry-recovered TC-WF-006 and intermittently invisible TC-SALES-6194 UI assertions were observed, with no established current deterministic regression. Earlier Combobox and snapshot propagation repairs are already merged.

[Evidence-head CI 43730533442](https://github.com/open-mercato/open-mercato/actions/runs/43730533442) also succeeded at `9418fd67b4a9acb9a9a81e8d3036fb7f7995fcf1`, all 15 shards and coverage aggregation. Parent read both checks and all workflows for this exact SHA: no pending or failing signal. Independent final-review task `33ebac4f` approved this documentation diff with no findings and directly verified the configured CI gates. Parent validated its findings and evidence. The same task will audit this final record before settling; its final reviewed SHA and verdict will be posted on the PR.

Applied the requested `automerge` label after the evidence head was fully green. This final progress record necessarily creates another head: keep the PR draft until that head has completed full CI and the same review task has audited it. The PR's final verification/review comments are authoritative for the final SHA; no later evidence-only commit is required. No source code or workflow changed, no child branch was merged, and no base-branch merge is performed by this run.
Engine: om-auto-create-pr (steps: 6, --loop: no)

## Progress

PR: #9605

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Baseline and diagnosis

- [x] 1.1 Open draft PR and confirm full-suite selection — c1537c359a
- [x] 1.2 Independently inspect main CI history — c1537c359a (validated read-only investigation)

### Phase 2: Stabilization

- [x] 2.1 Fix demonstrated root causes and validate — c1537c359a (no current failure; no speculative changes)
- [x] 2.2 Verify green CI on the exact PR head — c1537c359a (run 43727725703; later heads require fresh CI)

### Phase 3: Review and handoff

- [x] 3.1 Obtain and validate final independent review — 9418fd67b4 (approve/no findings; final record audit retained in the same task)
- [x] 3.2 Publish evidence and apply automerge after green CI — 9418fd67b4 (all checks/workflows green; label applied while draft; final-head readiness remains gated above)
