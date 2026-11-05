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

## Risks
Integration failures may depend on timing or shared CI infrastructure. Preserve failure evidence and report actual validation limits.

## Progress
PR: #8841

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [x] 1.1 Investigate failed main jobs and implement minimal root-cause fixes with regression tests. — 2d30583d3

### Phase 2: Validate and review

- [ ] 2.1 Run the configured validation gate and full PR CI; repair demonstrated failures.
- [ ] 2.2 Dispatch one independent final review, resolve findings, and apply automerge only after green CI and approval.
