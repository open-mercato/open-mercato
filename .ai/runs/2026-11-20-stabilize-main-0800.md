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

## Focused validation

Runner: local. The 13 source-expression compiler and scoped-resolution checks pass with locked Awilix 13.0.5 and isolated Awilix 13.0.7. Against the original six source files with 13.0.7, the same regression exits 1: six compiler cases fail, all seven other cases pass. Runtime expressions are transpiled before evaluation so existing TypeScript casts do not mask the baseline diagnostic. No production dependency or lockfile changed.

A fresh standalone app uses published snapshot `0.11.1-develop.8352.1.063474b385`, actual Awilix 13.0.7, and only the six corrected package source files overlaid after verifying each published baseline file byte-for-byte against this branch's base. Its production `yarn build` passed generation, compilation, TypeScript checking and page generation; this is a source-overlay build check, not a package publication or full standalone browser suite. An initial scaffold from a newer create-app dist-tag could not install its not-yet-visible core snapshot; the complete older snapshot avoids that registry timing issue.

The newest supported release line `release/v0.10.x` contains the faulty bindings too. Applied its existing backport label under the repository's high-priority bug-fix policy; no release branch is edited here.

## Full-suite and review outcome

- Reviewed head: `9ff40ad5f06350774593f2382da38b9a2e762950`. [Full CI run 44719529483, attempt 2](https://github.com/open-mercato/open-mercato/actions/runs/44719529483/attempts/2) passed all 15 integration shards, coverage merge, package builds, generation, app build, full typechecking, unit tests, root script regressions, i18n sync/usage, Redis, template parity, repository guards, Docker, timezone and multi-instance checks. All reported checks and exact-head workflows settled successfully or were intentionally skipped. Dependency audit was scoped out; it was not executed.
- Validation source: hosted GitHub checks. In configured order: first package build PASS; generation PASS; second package build PASS; i18n sync PASS; i18n usage PASS; typecheck PASS; unit tests PASS; app build PASS. The workflow builds the app in prepare before the test job. This table records configured-command coverage, not a separately executed ordered local gate. Local runner was used for the narrow compatibility tests and standalone build only.
- ONE final independent review task `df909d7b` examined the source at this exact head, checked compatibility/security/scope, reran all 13 regressions on both Awilix versions, reproduced the failing baseline, and verified the standalone overlays. The parent independently read its report, source diff and supporting logs. No child changes were authored or merged.
- The review's sole blocker F1 was validation: attempt 1 app typecheck hit a runner-reported OOM and skipped later gates. The failed-job retry passed full typecheck and every downstream gate on the unchanged reviewed source. No new source change was needed. The [authoritative review and resolution](https://github.com/open-mercato/open-mercato/pull/10073#issuecomment-7038168921) preserves the original finding and passing retry evidence. No implementation, security, compatibility or scope findings remain. GitHub refuses native self-review from the App author; evidence is recorded in the review comment without bypassing approval rules.

## Final tracking-head gate

This final tracking-only commit receives another complete suite. Keep the PR draft with `Status: in-progress` and withhold `automerge` until every applicable check and workflow on that exact head has settled green, including all 15 shards and coverage merge. The checklist records source validation and review completion; final metadata release remains gated here and its outcome is published on the PR without another source commit. If this head fails, reopen completion, investigate and verify again. Earlier-head results never prove the tracking head. This run does not merge into main or publish packages.

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
- [x] 2.2 Run the configured ordered validation gate and verify every applicable PR workflow, including 15 integration shards, on the exact head. — 9ff40ad5f0

### Phase 3: Review and finalize

- [x] 3.1 Dispatch ONE final independent review task, verify its evidence and resolve actionable findings. — 9ff40ad5f0
- [x] 3.2 Publish evidence, complete progress, promote the PR and apply automerge only after green final-head CI. — 9ff40ad5f0
