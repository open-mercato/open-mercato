# Checkpoint 3 — Steps 2.8..3.4

- **When:** 2026-10-28T06:18:37Z
- **Steps:** 2.8–2.12, 3.1–3.4 + 2.10-review-fix, 3.4-review-fix, 3.4-review-fix-2 (`b1d456ab7`..`749ae48c2`)

| Check | Result |
|---|---|
| `yarn typecheck` | pass |
| `npx jest src/modules/agent_orchestrator` | pass — 245 suites, 2691 tests |
| shared `src/lib/commands` + `src/security` | pass — 257 tests |
| core `src/__tests__`, `auth`, `audit_logs`, `workflows/lib` | 1 fail (`explicit-sort-comparators`) → fixed in **3.4-review-fix** → pass |
| Integration on a fresh ephemeral app (applies the new `audit_logs` migration): `TC-AGENT-ACC-*`, `TC-AGENT-INT-*`, `TC-AGENT-TRACE-*`, `TC-AUDIT*` | 26 passed, 5 skipped (need an LLM provider), 1 failed (`TC-AGENT-ACC-004` token route) → fixed in **3.4-review-fix-2** (re-run at the final gate) |

Findings:
- **Token route 500 (fixed):** a non-uuid `client_id` reached Postgres and returned 500 from the now-public route; malformed ids are rejected as `invalid_client` after the same dummy bcrypt compare.
- **Tool writes uncorrelated (fixed in 2.10-review-fix):** ambient `withAuditCorrelation` scope in shared; OpenCode/MCP tool writes stay uncorrelated until O4.3.
- **Sort comparators (fixed):** two new `.sort()` calls without comparators.
- Follow-ups (pre-existing, not fixed): core audit backfill `.where` not reassigned; `by-instigator` returns encrypted columns raw.

Artifacts: `checkpoint-3-artifacts/screenshot-trace-run-actions-card.png` — trace page Actions card listing the run's correlated actions (agentRunId + proposalId).
