# Stabilize main — 2026-11-08

## Goal
Verify main on an isolated stabilization PR, fixing demonstrated CI failures until its full suite is green.

## Scope
Base: main at `400508da51efca74b5a3bb165233b8509c6afba3`.
Branch: `stabilize/main-2026-11-08` (operator-requested name).
Main run [42418011830](https://github.com/open-mercato/open-mercato/actions/runs/42418011830) passed all 15 integration shards and all other executed jobs. CodeQL also passed. Snapshot release standalone tests and CodeQL also passed.
The existing `.github/workflows/ci.yml` already forces all shards for same-repository `stabilize/` branches or PRs carrying `ci-full`; no duplicate workflow change is needed.
Non-goals: unrelated fixes, production changes, releases, merging into main.

## Implementation Plan
### Phase 1: Verification
1.1 Open the stabilization draft and verify its full-suite CI; repair only observed failures.
### Phase 2: Independent review and completion
2.1 Dispatch one final independent cezar review of the stabilization branch and validate its verdict.
2.2 Record green checks, promote the PR, and add automerge only after verification and review pass.

## Risks
CI can reveal failures absent from the previously completed main run. Keep the PR draft and in progress until resolved. This is initially a docs-only verification run; manual diff review is its minimum local gate. Any subsequent code fixes require tests and the configured ordered validation gate.

## Verification evidence

Runner: GitHub Actions. [PR full-suite run 42423723298](https://github.com/open-mercato/open-mercato/actions/runs/42423723298) passed all 15 integration shards, merge-coverage, builds, unit/typecheck, lint, and all other executed checks at `3781c9ee5a4632b9212c3f5143580287696db9cd`. No code fixes were needed. Docs-only local gate: manual diff review and `git diff --check` passed.

Independent final review task `d6717f0b-1e30-454a-beb7-c7a6517c1b45` approved the exact diff with no findings; parent checked the report and repeated diff validation. [Review evidence](https://github.com/open-mercato/open-mercato/pull/9010#issuecomment-6714452147). No child changes were merged. Final bookkeeping changes only record these results. PR promotion and automerge labeling are external finalization actions, gated on green checks for the final commit.

## Progress
PR: #9010

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Verification

- [x] 1.1 Open the stabilization draft and verify its full-suite CI; repair only observed failures. — 3781c9ee5 (full suite passed; no repairs required)

### Phase 2: Independent review and completion

- [x] 2.1 Dispatch one final independent cezar review of the stabilization branch and validate its verdict. — 3781c9ee5 (independent verdict: approve)
- [x] 2.2 Record green checks, promote the PR, and add automerge only after verification and review pass.
