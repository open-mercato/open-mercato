# Stabilize main — 2026-11-17

## Goal
Restore green CI on a stabilization PR branched from main, with the full 15-shard suite and an independent final review before requesting automerge.

## Scope
Diagnose main failures from run 43945783902 at 61fb2a0f4c and latest run 44085283375 at 7228410734: script tests and integration shard 8/15. Resume the stopped persisted chain on the same branch and PR; synchronize already-reviewed upstream main changes without rewriting history. Repair demonstrated root causes with regression coverage. Existing trusted `stabilize/` and `ci-full` handling already enables full coverage; preserve it.

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

## Validation evidence
- Runner: local (no Compose app container running).
- Reproduced the exact catalog failure before the fix; all 5 catalog regressions and `yarn lessons:check` equivalent pass after correcting 186 to 187, then 188 after synchronizing the newly added upstream lesson. Catalog and full-suite selection regressions: 30/30 passed on 2026-11-17.

## Resume evidence
- The previous owner execution 7ed9f417 and child e3eef2d3 are confirmed failed/stopped. Retain persisted claim run f3238c56-d85f-4432-aa90-d69d08715725, comment 6932135961 and lock f24407bf1054730a9be86db70ab61873e4056b15.
- Independent artifact diagnosis found cold app bootstrap consumed the encryption tests’ scenario budget before assertions. The inherited worker fixture gives bootstrap a bounded startup budget while preserving per-test containers, original assertions and scenario budgets. Full CI run [44110082420](https://github.com/open-mercato/open-mercato/actions/runs/44110082420) on 6ffd13709a passed all 15 integration shards, full typechecking and unit tests, build, lint, security checks and merge coverage. The saved sales regression hardening still requires validation on the final head.
- PR run 43976766879 exposed a sales recipient test failure. Read-only child d73121ae inspected both retry traces and proved the failed Save sent the original customer ID and email. Focused Chromium probes of the compiled full detail page pass with the selected-summary precondition. Parent strengthens the existing regression with that precondition and request/response assertions; product behavior remains unchanged.
- On 2026-11-18 the original cockpit execution resumed after successor 0a41f616 ended. Its own diagnosis child e3eef2d3 could not start because disk space was exhausted at that time; 270 GB is now free. The existing artifact diagnosis above supplies the evidence without a replacement investigation task. One final review task remains reserved.

## Risks
CI may reveal additional failures beyond the baseline. Local dependencies and service availability must be established; document actual validation limits. Keep draft and withhold automerge until full exact-head checks pass. Existing older stabilization PRs have active claims; leave them untouched.

## Progress
PR: #9729

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Root-cause repairs

- [x] 1.1 Investigate and repair script-test failures with focused regression coverage. — 52b52b13bf
- [x] 1.2 Independently investigate integration shard 8/15 and repair demonstrated defects. — b3227db79f

### Phase 2: Verification and handoff

- [ ] 2.1 Run the configured local gate and the PR full suite; repair any further failures.
- [ ] 2.2 Dispatch one final independent review, resolve its findings, and verify the final head.
- [ ] 2.3 Publish evidence, finish the plan, make ready, and apply automerge only with all checks green.
