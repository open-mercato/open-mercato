# Stabilize main on 2026-11-11

## Goal
Verify main through a dedicated full-suite stabilization PR, fix evidenced failures, obtain independent review, and apply automerge after successful checks.

## Scope
Use branch `stabilize/main-2026-11-11` from `origin/main` at `592356afda0cb06e95fcf6d7c8365b1d39000633`. Inspect CI evidence and preserve the existing full-suite selection for same-repository stabilization branches and ci-full PRs. Correct contributor guidance that contradicts the current workflow.

## Non-goals
Product features, dependency upgrades, release automation, and merging the PR are outside this run.

## Implementation Plan

### Phase 1: Diagnose and prepare
1.1 Independently audit main CI and full-suite selection through a read-only cezar task.
1.2 Correct evidenced CI defects or stale stabilization instructions with focused verification.

### Phase 2: Validate and review
2.1 Run the configured validation gate and the stabilization PR full suite, resolving failures at their source.
2.2 Dispatch one final independent review task, validate its evidence, and address actionable findings.
2.3 Publish verification evidence, promote the completed PR, and apply automerge after green CI.

## Risks
Main already has a successful full-suite run, so further code fixes depend on new failure evidence. Local dependency availability and service requirements may limit local validation. Label changes do not schedule CI, so full-suite selection relies on the branch convention at PR creation. The final review is the second and final delegated task.

## Evidence
Claim run `94c2dc23-d4cb-45a8-8639-ea17dea5dd0a` holds `refs/om-locks/pr-9273` at `23c8f3b3f6105bcc4966d1bc0eecaf6329814c71`. Independent audit task `cc365c9f-0f0a-4ded-b872-d5e30613e604` is read-only.

Latest main CI https://github.com/open-mercato/open-mercato/actions/runs/42905776855 succeeded with all 15 integration shards. The existing workflow includes ci-full handling, while CONTRIBUTING.md incorrectly says the label has no effect. This small corrective run uses the existing stabilization behavior.

## Validation and review evidence

- Read-only audit `cc365c9f-0f0a-4ded-b872-d5e30613e604` independently verified main CI and scope. Parent checked the zero-file child diff and reran the 28 existing scope/concurrency tests successfully. Runner local. The temporary process-only YAML resolver used the cockpit's installed parser because the checkout has no dependencies.
- Full PR CI passed at `dde10703b8efe3eef7ce9cc569710f3bc1424d9a`, https://github.com/open-mercato/open-mercato/actions/runs/42925000086. All 15 integration shards and merge-coverage passed. Hosted package builds passed 42/42 tasks twice, generation and app build passed 1/1, full typecheck passed 42/42, units passed 51/51, and script tests passed 1,593 with three skips. Translation checks, template parity, Docker, lint, timezone, and multi-instance checks passed. Parent inspected the downloaded CI log. The documentation-only change uses the skill's documentation gate exemption locally, with full hosted validation evidence.
- Final independent review `5d69ea5a-7b3a-4895-95a9-7ccc2c46ac72` approved the complete diff at `dde10703b8efe3eef7ce9cc569710f3bc1424d9a` with no findings. Parent validated the zero-file child diff and inspected the published evidence, https://github.com/open-mercato/open-mercato/pull/9273#issuecomment-6783303608. GitHub rejected native self-approval by the author App with HTTP 422. This independent verdict is recorded as a comment, and an eligible native approval remains required by the main ruleset.
- Verification evidence was posted at https://github.com/open-mercato/open-mercato/pull/9273#issuecomment-6783351188. The PR was promoted to ready and received automerge after every reported PR check passed. This final administrative record then receives a fresh full CI run. Automerge is held during that run and restored after successful checks. Final readiness, labels, and owned-claim release are recorded in the PR timeline.
- Separate main snapshot run https://github.com/open-mercato/open-mercato/actions/runs/42905777033 is still running standalone integration at recording time. Its earlier watcher exited on an expired process credential with HTTP 401, and a fresh API read confirmed it remains in progress. Snapshot completion is monitored separately from the successful PR suite.
- Required checks were recovered from the active branch rules endpoint after the legacy protection endpoint returned 404. All eight required checks passed at the reviewed head. No child changes were merged, and both allowed delegated tasks are complete.

## Progress

PR: #9273

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and prepare

- [x] 1.1 Independently audit main CI and full-suite selection through a read-only cezar task — df5dd0012f
- [x] 1.2 Correct evidenced CI defects or stale stabilization instructions with focused verification — c09fcc62df

### Phase 2: Validate and review

- [x] 2.1 Run the configured validation gate and the stabilization PR full suite, resolving failures at their source — dde10703b8
- [x] 2.2 Dispatch one final independent review task, validate its evidence, and address actionable findings — dde10703b8
- [x] 2.3 Publish verification evidence, promote the completed PR, and apply automerge after green CI — dde10703b8
