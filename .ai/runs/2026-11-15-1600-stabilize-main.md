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
Main continues moving. Test this branch in its own PR concurrency group and inspect checks plus workflow runs for the exact head SHA. Current main runs are pending/in progress; completed recent runs passed. Do not invent fixes when none are demonstrated. User authorizes CI workflow/label changes and branch publishing for this run. Local resource or service limits will be recorded explicitly.

Runner: to be selected once for the local gate.
Engine: om-auto-create-pr (steps: 6, --loop: no)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Baseline and diagnosis

- [ ] 1.1 Open draft PR and confirm full-suite selection
- [ ] 1.2 Independently inspect main CI history

### Phase 2: Stabilization

- [ ] 2.1 Fix demonstrated root causes and validate
- [ ] 2.2 Verify green CI on the exact PR head

### Phase 3: Review and handoff

- [ ] 3.1 Obtain and validate final independent review
- [ ] 3.2 Publish evidence and apply automerge after green CI
