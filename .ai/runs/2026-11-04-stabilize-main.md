# Stabilize main — 2026-11-04

## Goal
Verify main CI on a dedicated full-suite PR and fix demonstrated root causes.

## Scope
CI failures and their minimal regression fixes. The audit found a credential-save reload race and mobile overflow in the shared progress summary. Fix those with unit and deterministic browser regressions. Main at 159653827ac5226365c88d08de1d0d555baee51b already has two successful CI runs and ci-full label routing. Preserve existing behavior when no defect is demonstrated.

## Non-goals
No speculative fixes, production changes, dependency upgrades, or merge into main.

## Implementation Plan
### Phase 1: Diagnose
1.1 Audit main run jobs and historical failures independently; confirm full-suite routing.
### Phase 2: Verify
2.1 Run all 15 integration shards on this PR, resolve any failures, and record evidence.
### Phase 3: Review
3.1 Obtain an independent final review and add automerge only after green CI.

## Risks
CI infrastructure failures may require reruns. No application code changes are warranted if the current head remains green. Use GitHub full CI for build/typecheck/integration evidence and local focused unit tests for both fixes. The standalone snapshot fails the narrow-viewport test when a prior operation leaves a long progress summary; explicitly mock that state so PR CI exercises the same failure.

## Progress
PR: #8657

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose
- [x] 1.1 Audit main run jobs and historical failures independently; confirm full-suite routing. — 00e017dc58

### Phase 2: Verify
- [x] 2.1 Run all 15 integration shards on this PR, resolve any failures, and record evidence. — 90a041e911; full CI 41745346079 passed at f80b26320b.

### Phase 3: Review
- [x] 3.1 Obtain an independent final review and add automerge only after green CI. — f80b26320b approved by final review ea11c3ae; automerge is conditioned on a green final head before handoff.

## Diagnosis evidence

- Main CI 41711262609: all 15 shards passed, but TC-INT-011 passed only on retry. Saving remounts the credential form immediately and again after an unawaited GET, allowing edits to be discarded during reload. Keep the save pending through the single authoritative reload.
- Main Snapshot Release 41711262627, job 126199029582: TC-CRM-KANBAN-LONG-PIPELINE-001 fails at 551px scroll width in a 390px viewport. Screenshot shows an active bulk-operation summary overflowing the page. Constrain the shared progress summary and truncate its operation title while retaining its accessible name and expand action.
- Independent audit f7ab0b12 made no changes; no child branch needs merging.

## Verification

Full CI: https://github.com/open-mercato/open-mercato/actions/runs/41745346079 passed all 15 integration shards and the unit/build/typecheck gates. TC-INT-011 passed first attempt (5.0s), shard 10: 226 passed, zero flaky. The deterministic mobile regression passed first attempt (3.2s); its screenshot confirms the 390px page fits with a long active operation. Independent final review: https://github.com/open-mercato/open-mercato/pull/8657#issuecomment-6619215630 (approve, no findings). Local focused Jest startup was blocked by the shared installation signal-exit mismatch; GitHub unit checks passed.

Manual QA remains a merge gate: browser evidence does not grant qa-approved. The automerge label is requested by the operator after green CI; this run does not merge. The final bookkeeping commit must also have green PR checks before adding that label.
