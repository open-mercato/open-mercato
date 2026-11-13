# Stabilize main — 2026-11-14

## Goal

Verify main on a dedicated stabilization PR, fix demonstrated CI failures, and request automerge only after the full suite and an independent final review pass.

## Scope

Base: `main` at `7588d72a33a11e4ae0cbbad3716e1f4943988b1e`.
Branch: `stabilize/main-2026-11-14` (operator-requested override of the skill's default branch prefix).
Claim run: `ecea348d-09ac-4028-aa7a-c7b9f06c5121`.

The latest main CI run already passes all 15 integration shards, build, lint, unit/type checks, timezone checks, collaboration checks and coverage merge: https://github.com/open-mercato/open-mercato/actions/runs/43511764170.
The workflow already forces full scope for trusted `stabilize/*` PRs or PRs carrying `ci-full`; the PR ref has its own concurrency group. Preserve these safeguards.

Non-goals: speculative fixes, changes to public contracts, production operations, database migrations, merging into main, and unrelated existing PRs.

## Implementation Plan

### Phase 1: Establish evidence and visibility

1.1 Record the baseline and open the dedicated draft PR.
1.2 Dispatch an independent read-only audit of main CI and full-suite selection.

### Phase 2: Stabilize and verify

2.1 Fix only reproduced failures and run the complete PR CI suite. If no failures exist, retain an evidence-only change.
2.2 Record verification evidence and complete the applicable validation gate.

### Phase 3: Independent review and handoff

3.1 Dispatch exactly one final review using `om-auto-review-pr` / `om-code-review`, address actionable findings, and wait for its verdict.
3.2 Once the current head is green and review approves, mark ready and apply `automerge` with evidence.

## Risks

- Main may advance during verification; PR CI tests this branch's merge ref without main pushes cancelling it.
- No defect is currently demonstrated. Do not invent code changes to make the PR nonempty.
- Label-only events intentionally do not schedule CI, avoiding skipped required-check replacement. The full-suite flag is read on supported PR events; stabilization branches force full scope independently.
- Final review and all applicable current-head checks must succeed before automerge is requested.

## Validation

Runner: GitHub Actions for the full suite. For evidence-only changes the local gate is a manual diff review; configured commands contain no docs linter. Targeted workflow regression tests will run locally if dependencies are available. If code changes become necessary, run the configured ordered validation gate or document a concrete environment blocker.

## Evidence

- Independent read-only audit `ea30054c-3fc8-4c18-9c4d-f4aa11bfdf00` confirmed no demonstrated CI or scope/concurrency defect. The parent re-read its evidence, verified the branch contains no child edits, and re-ran the two audit-named workflow tests (28/28 passed). No child branch was merged.

## Progress

PR: #9497

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish evidence and visibility

- [x] 1.1 Record the baseline and open the dedicated draft PR — 4459de1752
- [x] 1.2 Dispatch an independent read-only audit of main CI and full-suite selection — 4459de1752

### Phase 2: Stabilize and verify

- [ ] 2.1 Fix only reproduced failures and run the complete PR CI suite
- [ ] 2.2 Record verification evidence and complete the applicable validation gate

### Phase 3: Independent review and handoff

- [ ] 3.1 Dispatch exactly one final review using om-auto-review-pr / om-code-review
- [ ] 3.2 Once the current head is green and review approves, mark ready and apply automerge with evidence
