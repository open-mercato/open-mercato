# Dev-session orphan recovery

## Goal
Ctrl+C must stop managed descendant processes. When a previous launcher exits but its processes survive, interactive startup must inspect the workspace owner, display the surviving processes and endpoint state, ask permission before stopping them, and resume after successful cleanup. Noninteractive startup and declined recovery remain non-destructive.

Source doc: .ai/specs/2026-07-17-hybrid-dev-runtime-and-starters.md
Related: PR #8612; observed orphaned MCP wrapper and CLI after Ctrl+C on macOS.

## Scope
Shared development shutdown utilities, session guard/recovery call sites, regression tests, and scaffolded template equivalents. Preserve active-session exclusion, acquisition serialization, database safety and public CLI defaults. Do not stop the user's current services or mutate their database during verification.

## Implementation Plan
1. Reproduce wrapper/descendant survival and failed escalation with controlled processes; cover recovery consent, declines, noninteractive calls and changed ownership.
2. Fix managed POSIX descendant cleanup and escalation; keep Windows taskkill behavior.
3. Add explicit interactive recovery before bootstrap work; verify ownership and surviving processes before signaling, retry normal acquisition after cleanup, and mirror standalone runtime behavior.
4. Verify template parity, regression suites and configured full validation commands; document the exact runner and any unrelated blockers.
5. Review/autofix the complete PR and record evidence and manual QA instructions.
6. Publish the final PR state and link the follow-up from #8612 without changing its unrelated work.

## Risks
A free port alone does not establish that a workspace is unused. Never kill an active runner or a PID whose identity changed. Consent must not hold the acquisition mutex. Signaling a wrapper must retain descendants for escalation even if the wrapper exits. Windows needs taskkill-compatible coverage. Validation must stay isolated from the primary dirty checkout.

## Progress

PR: #8837

### Phase 1: Diagnosis and implementation
- [x] 1.1 Reproduce orphaned process and recovery consent failures — 53b76c9a7
- [x] 1.2 Fix descendant shutdown and escalation — 53b76c9a7
- [x] 1.3 Implement interactive recovery and standalone parity — 53b76c9a7

### Phase 2: Verification and publication
- [x] 2.1 Run focused and full validation gates — b0829d339
- [x] 2.2 Complete review and autofix — b0829d339
- [x] 2.3 Publish results and link PR #8612 — #8837

## Verification evidence

Runner: local on Node 24.22.2; no compose app container was running. Focused shutdown/session/recovery tests: 41 passing, including real resistant grandchildren, unrelated-process survival and changed-owner races. Broader dev-runtime tests: 521 passing before the final cwd refinement; focused tests reran afterward. Actual TTY prompt accepted `y` and continued normal acquisition in a controlled fixture without signaling real processes. Template parity and lessons-catalog checks pass. Full configured gate is in progress.

## Review evidence

The independent code review found an inherited-locale parsing defect; a real `pl_PL.UTF-8` regression failed before the fix and passed after forcing `LC_ALL=C` for process inspection. Immutable member registration timestamps were added to reject PID reuse that predates a refreshed heartbeat. Re-review of b0829d339 found no remaining actionable code findings. Final focused suite: 44 passing. Final dev-runtime suite: 525 passing. The runtime patch applies cleanly to PR #8612's remote source without changing that PR or the primary checkout. Orphan recovery fails closed on hosts without verifiable POSIX process identity/cwd or a recorded loopback endpoint.

## Final validation gate

- PASS: `yarn build:packages` (23.1 seconds).
- PASS: `yarn generate` (13.4 seconds).
- PASS: `yarn build:packages` (8.8 seconds).
- PASS: `yarn i18n:check-sync` (1.1 seconds).
- PASS: `yarn i18n:check-usage` (188.9 seconds).
- PASS: `yarn typecheck` (14.3 seconds).
- PASS: `yarn test` (405.0 seconds).
- PASS: `yarn build:app` (107.7 seconds).

Post-autofix package rebuild, 44 focused tests, 525 dev-runtime tests, template sync, lessons validation and source diff checks also pass. Independent code re-review approves the code; formal GitHub approval is pending because the author cannot approve their own PR. Required GitHub checks remain merge gates; no CI-monitoring claim is retained.
