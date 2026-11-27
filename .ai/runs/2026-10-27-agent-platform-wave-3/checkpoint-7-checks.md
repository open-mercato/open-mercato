# Checkpoint 7 — Steps 5.4..5.6 (Phase 5 close)

- **When:** 2026-10-27
- **Steps covered:** 5.4..5.6 (`4c9cc2ecc`, `a9d897dd7`, `eb96121a3`)
- **Touched areas:** `agent_examples` (`support.policy_check` with integrity rules, static policy catalogue + `agent_examples.support_policy` resolver in a new `di.ts`, `agent_examples.get_support_policy` tool, template mirror), AO integration specs `TC-AGENT-INT-001..004`, AO `guardrail-checks` / `context-bundles` list routes (entity id fix) + route entity-id guard test
- **Runner:** local mode + ephemeral integration environment (AO enabled, rebuilt with `OM_INTEGRATION_BUILD_CACHE_TTL_SECONDS=0`)

## Checks

| Check | Result | Notes |
|---|---|---|
| agent_orchestrator jest | pass | 1996 tests |
| `apps/mercato` jest `agent_examples` | pass | 4 tests |
| Integration (first run) | fail | `TC-AGENT-INT-001` ×2 and `TC-AGENT-INT-002` "requires trace.view": `GET /api/agent_orchestrator/guardrail-checks` returned 500 `DATABASE_ERROR` for every query — Postgres: `relation "guardrail_checks" does not exist`. Root cause: the route's `ENTITY_TYPE` `agent_orchestrator:guardrail_check` names no registered entity (registered: `agent_guardrail_check`), so the query engine derived a non-existent table. Same defect in `context-bundles` (`context_bundle`). Pre-existing on `main`. |
| Fix forward | 5.6 | registered entity ids + `crud-route-entity-ids.test.ts` guard (verified to fail on the old id) |
| Integration (after 5.6, rebuilt app) | pass | 21 passed, 4 skipped: `TC-AGENT-INT-*`, `TC-AGENT-ACC-*`, `TC-AI-MCP-AGENT-TOOL-012`, `TC-AO-MCP-DISPATCH-001`, `TC-AI-RUN-TRACE-016`, `TC-AGENT-PERF-*`. Skips: model-dependent (`TC-AGENT-INT-004`, `TC-AO-MCP-DISPATCH-001`, the real-run case of `TC-AI-RUN-TRACE-016`) and the no-unrunnable-tool case of `TC-AI-MCP-AGENT-TOOL-012`. `context-bundles` list → 200. |
| `yarn i18n:check-sync` / `i18n:check-usage` | pass | |
| `yarn typecheck`, `yarn lint`, `yarn template:sync` | pass | |
| `yarn build:app --force` | pass | |

Artifacts: `checkpoint-7-artifacts/integration-specs.log`.

## Notes

- The second ephemeral start reused build artifacts younger than `OM_INTEGRATION_BUILD_CACHE_TTL_SECONDS` (600 s) and served stale code; restart with `OM_INTEGRATION_BUILD_CACHE_TTL_SECONDS=0` after a source change.
