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

### Phase 1: Diagnosis and implementation
- [ ] 1.1 Reproduce orphaned process and recovery consent failures
- [ ] 1.2 Fix descendant shutdown and escalation
- [ ] 1.3 Implement interactive recovery and standalone parity

### Phase 2: Verification and publication
- [ ] 2.1 Run focused and full validation gates
- [ ] 2.2 Complete review and autofix
- [ ] 2.3 Publish results and link PR #8612
