# Stabilize main — 2026-11-26

## Goal

Verify main with the full CI suite on an isolated stabilization PR, fix demonstrated root causes, and add `automerge` only after green checks and independent review.

## Scope

- Base: `main` at `dd5134f2518e724bdde9ca55190bb4d41187cedb`.
- Branch: `stabilize/main-2026-11-26` (operator-requested naming overrides the skill default).
- Existing `FORCE_FULL_SUITE` handles same-repository `stabilize/` branches and the `ci-full` label; retain it unless verification identifies a defect.
- Latest main CI run `45709877361` succeeded, including all 15 integration shards. Investigate independently and validate a fresh PR run before deciding whether code fixes are needed.
- Claim run: `904827a1-8066-4e57-a8a3-0c77818792c2`.

## Non-goals

No speculative fixes, test weakening, architecture changes, production dependencies, database migrations, release changes, base-branch merges, or unrelated cleanup.

## Implementation Plan

### Phase 1: Diagnose and verify

1.1 Independently audit main CI and confirm full-suite routing. Delegate read-only CI diagnosis to one task; retain all coupled fixes and PR operations in the parent.

1.2 Run the full suite on the stabilization PR and fix only reproduced failures. Include regression tests for code changes; use the docs-only gate if no defects are demonstrated.

### Phase 2: Review and finish

2.1 Dispatch the one final independent review task after implementation and validation, resolve actionable findings, and record its verdict. At most two child tasks total.

2.2 Publish verification evidence, complete the tracking plan, and apply `automerge` only when the exact PR head is green and approved. Promote the completed draft to ready; never merge main.

## Risks

- Fresh integration runs may reveal intermittent failures despite the successful main run. Diagnose logs before choosing a fix or rerun.
- Label changes do not schedule CI; the branch prefix forces full validation from the initial opened event.
- A verification-only PR may contain only this tracked plan if no code defect exists; do not invent changes to justify a fix.
- Main may advance while the isolated PR run continues. Evidence must identify the tested head and base.
- Local dependencies are absent at preflight. Select the runner using repository probes before validation; remote CI remains required evidence.

## Verification evidence

- Runner: local for focused CI regression tests; hosted GitHub Actions for the full suite. No compose app container was running during the prescribed probes.
- Local gate: `node --test scripts/__tests__/ci-full-label.test.mjs scripts/__tests__/ci-concurrency.test.mjs scripts/__tests__/ci-merge-coverage.test.mjs` passed 45/45; `git diff --check origin/main...HEAD` passed. No configured markdown-specific lint command was found. The docs-only gate applies because only this plan changed.
- Main run [45709877361](https://github.com/open-mercato/open-mercato/actions/runs/45709877361) passed at `dd5134f2518e724bdde9ca55190bb4d41187cedb`, including all 15 integration shards.
- PR run [45721358546](https://github.com/open-mercato/open-mercato/actions/runs/45721358546) passed at `f101ee1df09b1565734fb36135b09b208dffd8e4`, including full typechecking/unit tests, all 15 integration shards, app/Docker builds, timezone/multi-instance checks, and coverage aggregation. Other exact-head workflows and CodeQL also passed; audit, mutation execution, and backport skips match their scope conditions.
- No demonstrated root cause needs a code change. Existing full-suite selection and PR-specific concurrency are covered by the passing local checks.
- Diagnosis child `fc5cd5e0-31ae-4f8f-8ec7-3e209afea324` failed before model startup: the cockpit rejected restricted Codex tool grants. It produced no independent evidence. The parent completed the audit; the second and final task performed the independent review below.
- Branch-protection required-checks lookup returned HTTP 404. Completion therefore requires every reported check and exact-head workflow to settle successfully or with an expected scope skip.
- Final review task `9fe3f59c-f7fd-4665-b032-942a19e5640b` [APPROVED](https://github.com/open-mercato/open-mercato/pull/10726#pullrequestreview-6067402997) `bf2748fb327c9277817f3343aee756bd692f2aab` with no actionable findings. GitHub rejected an author-bot approval vote, so the explicit independent verdict is a COMMENT review; it does not satisfy a required approving vote. No child changes were merged.
- Reviewed-head run [45729153362](https://github.com/open-mercato/open-mercato/actions/runs/45729153362) passed all 15 integration shards and merged coverage. The parent independently verified 35 reported checks and four exact-head workflows, all settled successfully or with expected skips, and reran the 45 focused tests successfully.
- The reviewer disclosed transient local fixture-shell Yarn-resolution failures before an unchanged 45/45 retry; the parent also obtained 45/45 without changes. No assertions were weakened. The transient cause remains unconfirmed and did not fail hosted CI.
- `automerge` was applied only after the reviewed head was green, then withheld while this completion-metadata update is tested. The final exact-head CI result, label restoration, ready promotion and claim release are recorded on the PR; this document makes no claim about future checks. No source, workflow, dependency or database changes were needed.

## Progress
PR: #10726

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and verify

- [x] 1.1 Independently audit main CI and confirm full-suite routing — f101ee1df0 (parent audit completed; final independent review verified the evidence)
- [x] 1.2 Run the full suite on the stabilization PR and fix only reproduced failures — f101ee1df0 (run 45721358546 passed; no fixes required)

### Phase 2: Review and finish

- [x] 2.1 Dispatch the one final independent review task — bf2748fb32 (task 9fe3f59c approved; parent verified its report, unchanged branch and tests)
- [x] 2.2 Publish verification evidence and conditionally apply automerge — bf2748fb32 (reviewed-head evidence published; conditional label applied only after green and withheld during final bookkeeping validation)
