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

## Risks
Integration failures may depend on timing or shared CI infrastructure. Preserve failure evidence and report actual validation limits.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [ ] 1.1 Investigate failed main jobs and implement minimal root-cause fixes with regression tests.

### Phase 2: Validate and review

- [ ] 2.1 Run the configured validation gate and full PR CI; repair demonstrated failures.
- [ ] 2.2 Dispatch one independent final review, resolve findings, and apply automerge only after green CI and approval.
