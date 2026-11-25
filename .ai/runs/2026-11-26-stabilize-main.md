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

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and verify

- [ ] 1.1 Independently audit main CI and confirm full-suite routing
- [ ] 1.2 Run the full suite on the stabilization PR and fix only reproduced failures

### Phase 2: Review and finish

- [ ] 2.1 Dispatch the one final independent review task
- [ ] 2.2 Publish verification evidence and conditionally apply automerge
