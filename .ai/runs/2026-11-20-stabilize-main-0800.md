# Main stabilization — scheduled follow-up, 2026-11-20

## Goal

Verify main through a full-suite draft PR, correct demonstrated CI root causes, and request automerge only after passing exact-head CI and independent review.

## Scope

Base: main `67ec897dd00773a9af6be2a131f9b90e43565af9`. Branch: `stabilize/main-2026-11-20-0800`. The original dated branch and tracking plan already shipped through merged PR #10037; preserve those artifacts and use the scheduled-occurrence suffix. Existing trusted stabilization branches and `ci-full` labels already force all 15 integration shards plus full units and typecheck. Verify and reuse this behavior.

Non-goals: merge into main, publish packages, change production, suppress checks, weaken assertions, change public contracts, or replace the existing full-suite selector.

## Implementation Plan

### Phase 1: Establish evidence

1.1 Open the full-suite draft PR and independently investigate current main CI failures. — 43798c42e5

### Phase 2: Correct and verify

2.1 Correct demonstrated root causes with regression coverage; preserve behavior where no defect is established.
2.2 Run the configured ordered validation gate and verify every applicable PR workflow, including 15 integration shards, on the exact head.

### Phase 3: Review and finalize

3.1 Dispatch ONE final independent review task, verify its evidence and resolve actionable findings.
3.2 Publish evidence, complete progress, promote the PR and apply automerge only after green final-head CI.

## Delegation

Use at most two cezar subtasks: one read-only main CI investigation with no repository edits, then one final review of the completed branch. Keep implementation and validation together because fixes depend on the same evolving CI evidence. No child changes are merged without review.

## Investigation evidence

The read-only investigation (child `09a3a872`) was independently checked against snapshot run [44711020020](https://github.com/open-mercato/open-mercato/actions/runs/44711020020/job/136210508883). Publishing succeeds; the standalone app fails typechecking at eleven `resolve.bind(container)` sites in bootstrap, business rules, workflow seeding and search workers. Awilix 13.0.6+ declares its closure-based resolver with `this: void`, rejecting those bindings and erasing the search resolver's generic result. The monorepo lock pins 13.0.5 while standalone's compatible dependency range can install newer patches. The exact installed standalone patch is not printed in failing logs.

Existing role-cancel and payment-edit failures already have merged fixes and pass in newer main logs; do not repeat those changes. Initial draft PR full run [44709996730](https://github.com/open-mercato/open-mercato/actions/runs/44709996730) passed all 15 shards. Correct the demonstrated standalone defect without dependency pinning, weaker typechecking, API changes or workflow changes. Unit coverage checks the actual resolver expressions for no-this/generic compatibility and verifies runtime scope, optional lookup and missing-token behavior. Test both locked 13.0.5 and isolated 13.0.7 installs, including a failing-baseline regression.

## Risks

Main can advance independently. Inspect both checks and workflow runs for each exact head; pending jobs and skipped gates are not proof of execution. Snapshot publishing failures may require distinguishing external registry propagation from repository defects. Do not publish packages to reproduce a failure. Hosted CI can provide the configured gate evidence when local prerequisites are unavailable; disclose any local limitations.

Engine: om-auto-create-pr (steps: 5, --loop: no)

## Progress
PR: #10073

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish evidence

- [x] 1.1 Open the full-suite draft PR and independently investigate current main CI failures. — 43798c42e5

### Phase 2: Correct and verify

- [x] 2.1 Correct demonstrated root causes with regression coverage; preserve behavior where no defect is established. — 47deb6e2d8
- [ ] 2.2 Run the configured ordered validation gate and verify every applicable PR workflow, including 15 integration shards, on the exact head.

### Phase 3: Review and finalize

- [ ] 3.1 Dispatch ONE final independent review task, verify its evidence and resolve actionable findings.
- [ ] 3.2 Publish evidence, complete progress, promote the PR and apply automerge only after green final-head CI.
