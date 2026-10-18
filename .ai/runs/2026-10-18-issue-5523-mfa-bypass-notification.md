# MFA bypass administrator notification

Goal: Deliver a scoped, deduplicated in-app warning to MFA administrators when emergency bypass is observed.

Source doc: .ai/specs/enterprise/2026-10-18-mfa-emergency-bypass-notification.md
Spec PR: https://github.com/open-mercato/open-mercato/pull/7618

Scope: Enterprise security notification/event, existing bypass hooks, translations, automated coverage, MFA spec changelog; optional `createBatch` deduplication options in the core notification service; shared nested-wildcard owning-module correction required by the live audience test.
Non-goals: MFA policy changes, public API/schema changes, new dependencies, unrelated worktree edits.

## Implementation Plan

### Phase 1: Delivery

1.1 Add type/translations/event/subscriber; durable daily deduplication and canonical scoped RBAC.
1.2 Connect login, enrollment and sudo detection without changing warn logs.

### Phase 2: Verification

2.1 Add regression/integration coverage and MFA spec changelog.
2.2 Validate, independently review, and publish evidence and limits.

## Risks

Independent review found a late queue-availability issue: awaiting a reconnecting enqueue could block bypass requests. Commit `ff1fc9c043` adds a two-second fail-open deadline with hanging/late-rejection regressions. All 105 affected security tests, enterprise typecheck/build, and template parity passed. Fresh native `TC-SEC-015` passed against the rebuilt, exact committed application and test source (11.4s test; 2.1m Playwright run); compiled output was independently checked for the deadline. Independent source review has no remaining actionable findings. Final-head CI remains required for formal review and draft promotion. The notification write transaction owns strict per-recipient deduplication; the subscriber holds no outer transaction. Live verification exposed and fixed nested wildcard owning-module resolution so `security.mfa.*` is honored with the module registry active.

Local runner: the complete ordered gate passed at production commit `3872e33641` in a clean temporary checkout using bundled Node24.19: package build, generation, second package build, translation sync/usage, typecheck, unit tests (48/48 tasks), and app production build. This isolated unrelated local tracker/WMS edits and a Homebrew sandbox-library failure; an isolated Expo worker crash passed on recheck and on the subsequent full gate.

The later `7d4346213c` delta changes only integration assertions and a stale test comment. Enterprise typecheck and template parity passed there. Native `TC-SEC-015` using its exact committed test bytes passed against the unchanged `3872e33641` production build: concurrent logins, exact/nested-wildcard manager delivery, ordinary/other-organization exclusions, desktop/mobile notification rendering, and dismissed-warning deduplication. Manual Chromium smoke also verified the warning,390px wrapping, and dismiss-to-empty state. Evidence is published on PR7619; fault-injection and other browser locales remain for human QA, with `needs-qa` retained.

Notification enqueue failures must not disable emergency access; worker-side failures retry. Concurrent broadcasts serialize by scope/day. Missing scope never triggers a global broadcast. Local runner selected: no compose app is running. Existing unrelated worktree changes must not be staged.

## Progress

PR: #7619

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Delivery

- [x] 1.1 Add type/translations/event/subscriber — 91b3e2cd79
- [x] 1.2 Connect existing bypass hooks — 91b3e2cd79

### Phase 2: Verification

- [x] 2.1 Add coverage and documentation — 46b092ec0a
- [x] 2.2 Validate and review — ff1fc9c043; final-head CI and maintainer review remain pending

## CI follow-up — 2026-10-19

The user explicitly requested fixing the failed CI/CD check. Shard14 failed in `TC-WF-006` because pointer traversal left the fixture row and a sibling workflow's hover menus open simultaneously. The global Delete locator then matched two items. This correction clicks the intended row's action trigger and waits for its expanded state and one unique Delete action before confirming removal. Existing UI creation/deletion and API cleanup assertions remain; no production behavior, timeout, retry, or skip changes are introduced. Runner: local managed ephemeral app/database, using bundled Node24.19 in an isolated checkout.

- [x] Post-review CI fix: validate and independently review the workflow action-menu correction, then publish it — 1388633bca

Fresh required CI results will be recorded in the PR review and CI-result comment after publication. The PR remains ready for review during validation; human QA and required checks continue to gate merge.

Local verification for `1388633bca`: core typecheck passed; the native `TC-WF-006` passed on its first attempt (5.0s test, 2.3m Playwright run) against an isolated production app built from unchanged application source. The committed test matches the runtime test SHA256 `b1eae31c20681571d7bfaab6b57bbb745eff456fd7e6c71e39599ccc52c0b74f`. Independent review found no actionable issue. Pre-commit translation sync and template parity passed. A repeat native run and fresh published-head CI are reported on the PR; no pending check is recorded as passed here.

### Coverage aggregation correction

Fresh CI at `8be3d90766` passed all 15 integration shards, unit/typecheck, lint, build preparation, mutation tests, and Documents multi-instance. The final coverage job was skipped: its implicit `success()` condition propagated the intentionally skipped dependency audit through the successful test jobs. The executed merge-ref workflow was verified against the committed workflow; there is no intended fork exemption for coverage aggregation.

The corrected condition uses `!cancelled()` and explicitly requires success from all four direct prerequisites while retaining the sharded-run condition. A regression reproduces the old audit-skip failure; focused coverage, audit, and workflow-cache tests now pass (23/23). Tests also deny coverage on failed, cancelled, or skipped direct prerequisites, workflow cancellation, and a non-sharded run. No production application source changes are needed.

- [x] Verify and independently review the coverage job condition; publish it with this checkpoint. Independent review found no actionable issue.

The new published-head CI result will be recorded on the PR. Previous-head passes do not substitute for that run. The PR stays ready, and human QA remains required.

### Coverage artifact path correction

Fresh CI at `4c8b5f9481` passed all 15 integration shards and scheduled the coverage job successfully. Its completed log nevertheless showed a no-files skip: the download step extracted reports into the workspace root, while the merge command reads `.ai/qa/test-results`. The correction explicitly downloads artifacts into the merge command's input directory.

A regression creates 15 shard summaries under the configured download destination and invokes the actual merge command. It fails on the old path and passes with the correction, asserting all 15 summaries contribute to the result. Coverage/audit/cache focused tests pass (24/24). Independent review verified all 15 real CI archive members at `coverage-shard-N/code/coverage-summary.json` and replayed their reports at the corrected destination: the actual merge command exited successfully, merging all 15 summaries (461457/743829 lines, 62.04%). Source review found no actionable issue. The final published-head CI job must actually merge all 15 reports before approval.

- [x] Verify the real CI artifact layout and merge, independently review, and publish the artifact path correction with this checkpoint.
