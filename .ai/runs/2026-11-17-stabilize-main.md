# Stabilize main — 2026-11-17

## Goal
Restore green CI on a stabilization PR branched from main, with the full 15-shard suite and an independent final review before requesting automerge.

## Scope
Diagnose the current main failures (run 43945783902 at 61fb2a0f4c): script tests and integration shard 8/15. Repair demonstrated root causes with regression coverage. Existing trusted `stabilize/` and `ci-full` handling already enables full coverage; preserve it.

## Non-goals
No product redesign, unrelated cleanup, production changes, base-branch merges, or weakening/skipping checks. Do not adopt active older stabilization PRs or their claims.

## Implementation Plan
### Phase 1: Root-cause repairs
1.1 Investigate and repair script-test failures with focused regression coverage.
1.2 Independently investigate integration shard 8/15 and repair demonstrated defects.
### Phase 2: Verification and handoff
2.1 Run the configured local gate and the PR full suite; repair any further failures.
2.2 Dispatch one final independent review, resolve its findings, and verify the final head.
2.3 Publish evidence, finish the plan, make ready, and apply automerge only with all checks green.

## Execution
- Engine: om-auto-create-pr (steps: 5, --loop: no)
- Branch: stabilize/main-2026-11-17 (operator-requested convention), based on origin/main.
- Reuse the invoking isolated linked worktree; do not remove it.
- Delegate at most one read-only integration investigation and one final review using cezar. Implementation and CI coordination stay together; no child changes are merged without review.
- Source context: .ai/specs/implemented/2026-04-10-ci-cd-performance.md; .github/workflows/ci.yml; CONTRIBUTING.md, Stabilization CI.

## Risks
CI may reveal additional failures beyond the baseline. Local dependencies and service availability must be established; document actual validation limits. Keep draft and withhold automerge until full exact-head checks pass. Existing older stabilization PRs have active claims; leave them untouched.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Root-cause repairs

- [ ] 1.1 Investigate and repair script-test failures with focused regression coverage.
- [ ] 1.2 Independently investigate integration shard 8/15 and repair demonstrated defects.

### Phase 2: Verification and handoff

- [ ] 2.1 Run the configured local gate and the PR full suite; repair any further failures.
- [ ] 2.2 Dispatch one final independent review, resolve its findings, and verify the final head.
- [ ] 2.3 Publish evidence, finish the plan, make ready, and apply automerge only with all checks green.
