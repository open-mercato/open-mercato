# Stabilize main — scheduled 2026-11-16 08:00

## Goal

Repair demonstrated main CI root causes and verify a dedicated draft PR with all 15 integration shards before requesting automerge.

## Scope

Base: main `883077fe355515c3008a05d3c768001c115da392`. Branch: `stabilize/main-2026-11-16-0800`. Target: main.

The unsuffixed branch belongs to merged PR #9635; preserve it and use the scheduled-time suffix. Main run 43810352873 failed only shard 13: both TC-WC-040 replacement-order undo cases timed out waiting for pending_approval. Existing ci-full and trusted stabilize/ full-suite selection already satisfy the requested workflow behavior.

Non-goals: speculative fixes, disabling tests or security guards, unrelated features, taking over existing PRs, merging into main.

## Implementation Plan

### Phase 1: Diagnose and repair

1.1 Independently audit exact-head CI inventory and full-suite coverage (read-only cezar task).
1.2 Trace replacement-order approval failures and implement the smallest safe repair with regression coverage.

### Phase 2: Verify and review

2.1 Run the configured validation gate and all 15 PR integration shards, fixing demonstrated failures.
2.2 Dispatch one final independent cezar review after implementation and address its verdict.
2.3 Record exact-head green evidence, promote the draft, and add automerge.

## Execution decisions

The operator's stabilize branch naming, waiting for green CI, and final cezar review override skill defaults. Reuse this isolated linked worktree. At most two children: a disjoint read-only CI coverage audit and one final review. Root-cause implementation stays in the parent because the affected paths are coupled. No unreviewed child changes will be merged. Final tracker updates avoid another evidence-only push that invalidates green evidence.

## Validation

Configured sequence: yarn build:packages; yarn generate; yarn build:packages; yarn i18n:check-sync; yarn i18n:check-usage; yarn typecheck; yarn test; yarn build:app. Targeted regressions accompany code fixes. Exact-head PR workflows and checks must finish successfully; intentional scope skips are reported. Preserve QA and native approval gates.

## Independent audit

Read-only cezar task eda194a3 independently confirmed main run 43810352873: 14 integration shards passed, only shard 13 failed its two undo cases, and other applicable CI checks passed. Exact-head workflow inventory had no other failure, while snapshot standalone integration was still running. The 25 full-suite selector tests passed independently and were rerun by the parent. Existing trusted stabilize/ and ci-full scope selects all 15 shards and unfiltered typecheck/tests; PR ref concurrency is isolated from main. The child made no edits or commits; its scoped diff is empty and no child branch was merged.

## Root cause and repair

The security fix deliberately removed event payload userId/actorUserId as execution authority. The stock code approval workflow declares no grant, so UPDATE_ENTITY correctly refuses its event-triggered write. TC-WC-040 depended on that removed authority. Each undo case now creates a unique persisted copy of the stock definition with only sales.orders.manage, through the existing grant-authorized API. It retains event-driven execution and actual audited status mutation. Cleanup cancels its instances and deletes its definition with the current version header. Production authorization and stock definitions remain unchanged. Integration-only changes do not need implementation-mirroring unit tests; the existing workflow identity/definition-grant unit suites and both affected integration cases provide the relevant regression evidence.

Runner: local (no running Compose app found). yarn install --immutable succeeded; 25 ci-full selection tests and TypeScript transpilation passed. Git hooks passed with TMPDIR=/tmp because the cockpit default temporary socket path exceeds the Unix socket path limit. Full executable validation is pending.

## Final independent review and correction

[Final cezar review](https://github.com/open-mercato/open-mercato/pull/9657#pullrequestreview-5916454454), child d94abaf7, reviewed dee39c34a0 and found one High/Major cleanup race: async EMIT_EVENT can park a run in WAITING_FOR_ACTIVITIES while cancel accepts only RUNNING/PAUSED. The reviewer made no edits; no child branch was merged. The author confirmed the endpoint contract and addressed the finding in 2a7b702d76: drain events/activities through the shared bounded integration helper, refresh each owned instance, poll transient cancellation races, cancel before deleting target orders, and attempt versioned definition deletion in finally. The existing focused cleanup lesson and index record the correction. Native self-request-changes was rejected by GitHub; the independent verdict is a transparent COMMENT and does not satisfy a native approval gate. Both allowed subtask dispatches are used; follow-up verification remains in the authoring review/autofix chain.

Local commands 1–6 passed. The first unit run hit the cockpit temporary-socket limit; loose Turbo environment passthrough and TMPDIR=/tmp resolved it. The second run passed all Jest suites, including 2,807 core suites/28,535 core tests, then create-app ZIP validation reported missing system unzip. A Debian unzip package was downloaded and extracted under /tmp solely for local validation (no repository dependency or system install); test/app validation is rerunning with that tool on PATH. No tests were skipped to address either environment issue.

## Hosted fixture scheduling evidence

Run 43825646616 at 279e877453 completed: all 14 other shards and every other applicable job passed, but shard 13 timed out in the teardown poll (one failed case and one flaky case). The retry trace proves the order status mutation succeeded and the owned instance stayed WAITING_FOR_ACTIVITIES on emit_approval_requested after queue drains. This is a new fixture scheduling dependency, distinct from the original missing execution grant. The copied fixture now dispatches EMIT_EVENT notifications inline while preserving all stock steps/transitions, event emission, domain trigger, explicit principal, real order command and original audit/undo assertions. Notification queue scheduling is outside these undo assertions; queue-specific workflow tests remain unchanged. Production workflow configuration is unchanged. The correction stays in this integration spec and its focused lesson. Full current-head CI must pass before completion.

## Completion evidence and finalization gate

[Full CI 43830389012](https://github.com/open-mercato/open-mercato/actions/runs/43830389012) succeeded at `49ef1fcd6e0e41ab7ee418b6138c15ae8200a638`: all 15 integration shards, coverage merge and every applicable job passed (24 successes; dependency audit intentionally scope-skipped). Shard 13 passed all 251 tests with no retries/flaky cases; the two corrected cases including teardown passed in 4.0s and 3.5s. The exact-head workflow/check inventory was independently read and contained no unfinished or failed entry. Required-context lookup was unavailable (404), so every reported check is conservatively treated as required.

All eight configured local validation commands passed in order; documented local host prerequisites were supplied without repository workarounds. Additional selector, syntax, lessons and pre-commit checks passed. The final independent review was dispatched and its single High finding was addressed; author autofix follow-up and exact-head runtime evidence resolve it. No new independent/native approval is claimed, and native approval requirements are preserved. Both allowed subtasks made no source edits and no child branch was merged.

This final commit changes only progress/evidence bookkeeping. The recorded implementation checklist is closed; **PR Status remains in-progress, the PR remains draft, and automerge remains withheld until this final commit's exact-head workflows/checks are green**. Then the driving run must refresh the PR body and outcome comment, mark ready, add automerge, and release its owned claim. Those tracker actions and final CI results belong on the PR, avoiding another evidence-only push. A prior green SHA never certifies this later head. No merge into main is performed.

## Risks

The latest change isolated event-triggered workflow identity; repairs must preserve trusted tenant/organization scope and fail-closed authentication. CI may expose further regressions. Local dependencies are initially absent. Existing active stabilization PRs remain separately owned.

## Progress

PR: #9657

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [x] 1.1 Independently audit exact-head CI inventory and full-suite coverage. — 789b93a9ae (independent audit eda194a3; no child diff)
- [x] 1.2 Trace replacement-order approval failures and implement the smallest safe repair with regression coverage. — 1fa897a46e

### Phase 2: Verify and review

- [x] 2.1 Run the configured validation gate and all 15 PR integration shards, fixing demonstrated failures. — 49ef1fcd6e
- [x] 2.2 Dispatch one final independent cezar review after implementation and address its verdict. — 2a7b702d76 (High cleanup finding corrected; 3b732a45fd isolates notification scheduling; exact-head runtime verification passed)
- [x] 2.3 Record exact-head green evidence, promote the draft, and add automerge. (Tracker promotion is gated by the finalization gate below.)
