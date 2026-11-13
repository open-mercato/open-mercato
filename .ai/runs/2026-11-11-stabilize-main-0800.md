# Stabilize main — 2026-11-11 08:00

## Goal
Fix the root causes of main CI failures and deliver a full-suite-green stabilization PR.

## Scope
Diagnose main run 42942775430 at f4decc8a57579cdd84a758bcddb3c1739fdc6ebe, repair demonstrated regressions with tests, and verify every applicable PR check including all 15 integration shards. The existing same-repository ci-full/stabilize branch override already selects full scope; preserve it.

## Non-goals
No unrelated features, contract changes, test suppression, production changes, base-branch merges, or changes to the occupied earlier stabilization PR #9273.

## Implementation Plan
### Phase 1: Diagnosis and repair
1.1 Independently diagnose failing CI and implement minimal regression fixes.
1.2 Validate focused changes and publish incremental fixes.
### Phase 2: Verification and review
2.1 Run the configured gate and all 15 PR integration shards; resolve further failures.
2.2 Dispatch one final independent review and resolve actionable findings.
2.3 Publish verification evidence and apply automerge only after full green CI and review approval.

## Risks
The requested stabilize/main-2026-11-11 slot is occupied by #9273 with a human assignee. This independent scheduled occurrence uses a timestamped slot and never mutates that PR or branch. Existing ci-full support needs no workflow edit. CI may expose additional failures; fix them on this branch. Dependency-free local worktree may require hosted validation; record exact commands and evidence. Never claim pending checks passed.

## Delegation
First child: read-only failure diagnosis, no source edits. Parent: tightly coupled implementation, PR lifecycle and full CI validation. Second and final child: independent final review using om-auto-review-pr/om-code-review. No child changes may be merged without review.

## Diagnosis evidence
Main run 42942775430: all jobs passed or intentionally skipped except shard 14 (233 passed, 1 failed, 2 skipped). TC-WF-006 retries fill the sidebar Search navigation input, then wait at line 95 for a definitions search response it cannot issue. Downloaded retry trace confirms POST 201, unfiltered list GET 200, and no definitions search request. The original attempt has no retained trace; its precise final action remains unproven. The definitions page exposes Search through Filters, whose overlay applies on its Apply buttons and has no Enter submission handler. Read-only child db3e014c confirmed this, made zero tracked changes, and its complete branch diff was independently verified empty. Parent verified source controls and changed only this integration test; no child commits were merged.

## Validation
Runner: GitHub Actions for the configured gate and full integration suite (test-only change; local worktree has no installed dependencies). Source diff passes git diff --check. Full corrected-head CI [42979427400](https://github.com/open-mercato/open-mercato/actions/runs/42979427400) passed at 17a1b3075f642ad58f7061ab1d64fae9c304e718, including all 15 shards and merged coverage. FORCE_FULL_SUITE=true. Build/generate/rebuild/app tasks: 42/1/42/1; full typecheck 42 tasks; full units 51 tasks; i18n checks passed (usage advisory); scripts 1,597 passed / 3 skipped; hosted create-app parity 1,156 passed / 99 skipped. Required scope/guard/prepare/lint/ds-lint/test/audit-scope/documents-multi-instance all passed. Lint, Docker, timezone and multi-instance checks passed. TC-WF-006 completed in 4.2 seconds without retry; shard 14 reports 234 passed / 2 skipped. Existing TC-WF-006 is the regression coverage: create through Studio, apply definitions Search, await successful filtered GET, then delete through row actions and verify absence. No timeout increase or assertion removal.

## Final independent review and handoff
[Reviewer fd97edfa approved](https://github.com/open-mercato/open-mercato/pull/9288#issuecomment-6790634902) the exact green source head 17a1b3075f with zero findings. Parent read the complete review, checked current source-head green status and independently verified both delegated branches have zero changes from their fork base f4decc8a57; no child commits were merged. The author App's native APPROVE was rejected with HTTP 422, so an eligible native approving review remains required by main rules. No product, public contract, database, dependency or timeout changes. User-requested automerge was applied only after complete green source-head checks and independent approval. This final administrative commit records completed steps; its fresh full CI will be followed to completion before draft promotion. The separate main snapshot workflow 42942775379 remains pending and is not claimed successful. Parent owns final tracker-only evidence refresh, draft promotion and claim release; no further source edits are planned.

## Progress
PR: #9288

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnosis and repair

- [x] 1.1 Independently diagnose failing CI and implement minimal regression fixes. — 9f318d605a
- [x] 1.2 Validate focused changes and publish incremental fixes. — 17a1b3075f

### Phase 2: Verification and review

- [x] 2.1 Run the configured gate and all 15 PR integration shards; resolve further failures. — 17a1b3075f
- [x] 2.2 Dispatch one final independent review and resolve actionable findings. — 17a1b3075f
- [x] 2.3 Publish verification evidence and apply automerge only after full green CI and review approval. — 17a1b3075f
