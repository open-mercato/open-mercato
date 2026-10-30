# Checkpoint 4 — Steps 3.4..3.6 (Phase 3 close)

- **When:** 2026-10-27
- **Steps covered:** 3.4..3.6 (`d14cf1e1a`, `360793dca`, `c3be2cb24`)
- **Touched areas:** `agent_examples` (`ai-tools.ts` with `agent_examples.triage_ticket`, `requiredFeatures` on `support.ticket_triage`, template mirror), ai-assistant decoupling test + docs, AO AGENTS.md, integration specs (`TC-AI-MCP-AGENT-TOOL-012`, `TC-AGENT-ACC-001..003`, `TC-AO-MCP-DISPATCH-001`), `TC-AI-RUN-TRACE-016` fix
- **Runner:** local mode + ephemeral integration environment (`yarn test:integration:ephemeral:start` with `OM_ENABLE_ENTERPRISE_MODULES=true OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true`, app at `127.0.0.1:5001`)

## Checks

| Check | Result | Notes |
|---|---|---|
| ai-assistant jest | pass | 2156 tests |
| agent_orchestrator jest | pass | 1751 tests |
| `yarn lint`, `yarn typecheck` | pass | |
| `yarn agents:check-budget`, `yarn template:sync` | pass | |
| `yarn build:app --force` | pass | |
| Integration: new wave-3 specs | pass | 8 passed, 2 skipped (`TC-AI-MCP-AGENT-TOOL-012` "agent cannot run" case — no such tool exists deterministically; `TC-AO-MCP-DISPATCH-001` — needs a real LLM provider) |
| Integration: `TC-AI-RUN-TRACE-016` | fail → fixed (3.6) → pass | 4 passed, 1 skipped (provider). Failures: `$ref` resolver depth too shallow for the nullable `runId` added in 3.2; the "accepts every key" case sent `providerOptions`, refused over HTTP since wave 2 `fd4b204eb` (latent in #8011) |
| Integration: existing `TC-AI-MCP-*` | pass | ran with the first batch |

Artifacts: `checkpoint-4-artifacts/integration-wave3-specs.log`.

## Notes

- Agent Orchestrator **does** register in the ephemeral app when started with the enterprise flags above (the wave-2 handoff said it could not). AO validation specs run end to end; only model-dependent cases skip.
- The 3.4 commit was pushed by the user before its amend; local was reset to the pushed commit `d14cf1e1a` (identical code, the amend only flipped the PLAN row). The 3.4 row is flipped here. Executors now never amend; they write `pending` and the checkpoint fills SHAs.
