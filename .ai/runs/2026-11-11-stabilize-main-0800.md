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

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnosis and repair

- [ ] 1.1 Independently diagnose failing CI and implement minimal regression fixes.
- [ ] 1.2 Validate focused changes and publish incremental fixes.

### Phase 2: Verification and review

- [ ] 2.1 Run the configured gate and all 15 PR integration shards; resolve further failures.
- [ ] 2.2 Dispatch one final independent review and resolve actionable findings.
- [ ] 2.3 Publish verification evidence and apply automerge only after full green CI and review approval.
