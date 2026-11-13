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

- [Dedicated PR CI 43524930435](https://github.com/open-mercato/open-mercato/actions/runs/43524930435) at `4459de175233cd5b7b3c726761f8c5fd8247360c` passed all 24 applicable jobs, including every integration shard, package/app/Docker builds, unfiltered typecheck/unit tests, lint, timezone, collaboration, and coverage merge. Dependency audit was intentionally skipped by its manifest/lockfile scope filter. All other applicable PR checks passed. No source or workflow fix was necessary.
- Runner: local for 42/42 targeted workflow regression tests (full scope, concurrency, coverage fail-closed, cache isolation) and the 28/28 audit recheck. The documentation-only local gate is a manual Markdown and whitespace review; there is no configured Markdown linter. Broad validation is evidenced by the dedicated PR's full GitHub Actions suite.
- Effective main ruleset requires `scope`, `guard`, `prepare`, `lint`, `ds-lint`, `test`, `audit-scope`, and `documents-multi-instance`. This run additionally gates handoff on every applicable reported check and all 15 shards.
- Main Snapshot Release `43511764426` at the baseline SHA has published successfully; its standalone integration remains pending as of 2026-11-13T23:47Z. Older failed manual preview/deployment runs are not current-main CI regressions. Do not equate the green CI suite with all historical workflows being green.
- Completion-only documentation commits must receive fresh CI at the final pushed head. Live final review/check results will be linked in the PR body and outcome comment; do not treat the initial run as proof of a later head.

## Progress

PR: #9497

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish evidence and visibility

- [x] 1.1 Record the baseline and open the dedicated draft PR — 4459de1752
- [x] 1.2 Dispatch an independent read-only audit of main CI and full-suite selection — 4459de1752

### Phase 2: Stabilize and verify

- [x] 2.1 Fix only reproduced failures and run the complete PR CI suite — a4cd51c3b5
- [x] 2.2 Record verification evidence and complete the applicable validation gate — a4cd51c3b5

### Phase 3: Independent review and handoff

- [ ] 3.1 Dispatch exactly one final review using om-auto-review-pr / om-code-review
- [ ] 3.2 Once the current head is green and review approves, mark ready and apply automerge with evidence
