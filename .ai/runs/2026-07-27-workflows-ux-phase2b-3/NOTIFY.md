# NOTIFY — workflows-ux-phase2b-3

Append-only UTC log. Checkpoint events, blockers, and scope decisions only.

- 2026-07-27T21:00Z — Run started. Scope: Phase 2b + Phase 3a + Phase 3b of `.ai/specs/2026-07-26-workflows-ux-redesign.md`, implemented on a single branch `feat/workflows-ux-phase2b-3` off `feat/agent-orchestrator-mvp` (user directive: no further stacking). Phases 0/1/2a merged upstream as #4532/#4551/#4559.
- 2026-07-27T21:05Z — Two research subagents dispatched to produce BRIEFING-phase2b.md and BRIEFING-phase3.md before plan drafting.
- 2026-07-28T00:10Z — Checkpoint 1 recorded (steps 1.1-1.6). Workflows scope 8573 tests green.
- 2026-07-28T00:20Z — BLOCKER (resolved): executor for steps 1.7-1.9 was terminated mid-step by a Fable 5 credit-exhaustion API error. Steps 1.7/1.8 had committed; step 1.9's implementation was complete but uncommitted and untested. Recovered by the orchestrator directly: verified the eventPattern plumbing at both call sites, added the missing ledger + route test coverage, landed as 84ad36361. Subsequent executors run on Opus 5.
- 2026-07-28T01:05Z — DECISION: core<->enterprise seam for INVOKE_AGENT output contracts is an additive OPTIONAL method on the existing agentWorkflowBridge DI service, read duck-typed by core. No new DI key, no cross-package import, peer-absent degrades to unknown.
- 2026-07-28T01:05Z — FLAG: zodToJsonSchema + JsonSchema are now exported from @open-mercato/shared/lib/openapi (previously private). Additive, but a new shared contract surface — call out in the PR.
- 2026-07-28T01:10Z — Checkpoint 2 recorded. PHASE 2b COMPLETE (13/41 steps). Workflows scope 8629 tests green; 7 enterprise failures independently verified as pre-existing environment artifacts (untracked opencode mirrors).
