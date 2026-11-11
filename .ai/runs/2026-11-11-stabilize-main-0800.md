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
Runner: GitHub Actions for the configured gate and full integration suite (test-only change; local worktree has no installed dependencies). Initial source diff passes git diff --check. Full corrected-head CI remains pending. Existing TC-WF-006 is the regression coverage: create through Studio, apply definitions Search, await successful filtered GET, then delete through row actions and verify absence. No timeout increase or assertion removal.

## Progress
PR: #9288

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnosis and repair

- [x] 1.1 Independently diagnose failing CI and implement minimal regression fixes. — 9f318d605a
- [ ] 1.2 Validate focused changes and publish incremental fixes.

### Phase 2: Verification and review

- [ ] 2.1 Run the configured gate and all 15 PR integration shards; resolve further failures.
- [ ] 2.2 Dispatch one final independent review and resolve actionable findings.
- [ ] 2.3 Publish verification evidence and apply automerge only after full green CI and review approval.
