# Stabilize main — 2026-11-08

## Goal
Verify main on an isolated stabilization PR, fixing demonstrated CI failures until its full suite is green.

## Scope
Base: main at `400508da51efca74b5a3bb165233b8509c6afba3`.
Branch: `stabilize/main-2026-11-08` (operator-requested name).
Main run [42418011830](https://github.com/open-mercato/open-mercato/actions/runs/42418011830) passed all 15 integration shards and all other executed jobs. CodeQL also passed. Snapshot release standalone tests are still running.
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

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Verification

- [ ] 1.1 Open the stabilization draft and verify its full-suite CI; repair only observed failures.

### Phase 2: Independent review and completion

- [ ] 2.1 Dispatch one final independent cezar review of the stabilization branch and validate its verdict.
- [ ] 2.2 Record green checks, promote the PR, and add automerge only after verification and review pass.
