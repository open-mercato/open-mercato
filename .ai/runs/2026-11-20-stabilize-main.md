# Stabilize main — 2026-11-20

## Goal

Fix demonstrated CI root causes on `stabilize/main-2026-11-20`, obtain a green full-suite PR into main, and apply `automerge` after independent review.

## Scope

Start from main at `6e47339a32d8bd41c7622c82f921ea2dbd47d998`. Inspect main and PR CI logs; make focused corrections with regression coverage. Existing trusted `stabilize/*` and `ci-full` selection already force full typecheck, unit tests and 15 integration shards. Reuse it.

Non-goals: merge into main, suppress tests, weaken assertions, change public contracts or production dependencies, change release behavior, or implement the draft phased-integration design.

## Implementation Plan

### Phase 1: Establish evidence

1.1 Inspect main failures and establish the full-suite draft PR.

### Phase 2: Correct and validate

2.1 Fix reproducible root causes with focused regression tests and incremental commits.
2.2 Run the configured validation gate and obtain passing full-suite CI on the PR head.

### Phase 3: Review and hand off

3.1 Dispatch one independent final review task and address actionable findings.
3.2 Publish verification evidence, complete tracking, promote the PR and apply automerge only after green CI.

## Risks

- Main changes concurrently; use a PR-specific concurrency group and the exact head SHA for evidence.
- Main's latest run is still active. The last completed failing run is `44492039926`, integration shard 12/15; verify whether its cause persists before editing.
- Local dependencies are not installed in this linked worktree. Record environment blockers and exact command outcomes; CI remains the full-suite completion gate.
- Any fix beyond a narrowly related corrective scope needs separate authorization; do not change unrelated modules speculatively.

Engine: om-auto-create-pr (steps: 5, --loop: no)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish evidence

- [ ] 1.1 Inspect main failures and establish the full-suite draft PR.

### Phase 2: Correct and validate

- [ ] 2.1 Fix reproducible root causes with focused regression tests and incremental commits.
- [ ] 2.2 Run the configured validation gate and obtain passing full-suite CI on the PR head.

### Phase 3: Review and hand off

- [ ] 3.1 Dispatch one independent final review task and address actionable findings.
- [ ] 3.2 Publish verification evidence, complete tracking, promote the PR and apply automerge only after green CI.
