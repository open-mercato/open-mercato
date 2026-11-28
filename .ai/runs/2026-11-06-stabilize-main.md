# Stabilize main CI

## Goal
Restore green full-suite CI through root-cause fixes on stabilize/main-2026-11-06.

## Scope
Investigate current main failures, preserve full-suite selection, and fix demonstrated regressions with focused regression coverage.

## Non-goals
No feature work, test suppression, base-branch merges, or unrelated cleanup.

## Implementation Plan
### Phase 1: Diagnose and repair
1.1 Investigate failed main jobs and implement minimal root-cause fixes with regression tests.
### Phase 2: Validate and review
2.1 Run the configured validation gate and full PR CI; repair demonstrated failures.
2.2 Dispatch one independent final review, resolve findings, and apply automerge only after green CI and approval.

## Evidence
Main run 42118262316 failed TC-ADMIN-001 and TC-CRM-5117: Close resolved to both alert-dismiss and button slots. Both locators now intersect the shared button slot. The workflow fixture explicitly resets FORCE_FULL_SUITE and tests opt-in full scope. Focused workflow tests: 37 passed with FORCE_FULL_SUITE=true. Chromium reproduced the duplicate accessible name and confirmed the corrected locator uniquely clicks the action. Local build:packages passed (42 tasks). Runner: local.

Completion evidence: GitHub Actions run [42126906097](https://github.com/open-mercato/open-mercato/actions/runs/42126906097) passed on 916106a128ed54044f3754c357bf765bba5168a6, including all 15 integration shards and all eight required checks. Integration results: 3365 passed, 99 skipped, two passed on retry (TC-PROM-083 and TC-SALES-001). Independent final review c71bf068-1816-450e-9f25-11830ab1e53b approved the complete code diff with no findings. Runner: GitHub Actions; prior local gate evidence was incomplete. The final documentation commit requires its own green checks before applying automerge.

## Risks
Integration failures may depend on timing or shared CI infrastructure. Preserve failure evidence and report actual validation limits.

## Progress
PR: #8841

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [x] 1.1 Investigate failed main jobs and implement minimal root-cause fixes with regression tests. — 2d30583d3

### Phase 2: Validate and review

- [x] 2.1 Run the configured validation gate and full PR CI; repair demonstrated failures.
- [x] 2.2 Dispatch one independent final review, resolve findings, and apply automerge only after green CI and approval.
