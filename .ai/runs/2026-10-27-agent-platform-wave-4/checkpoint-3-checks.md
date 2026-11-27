# Checkpoint 3 — Steps 3.1..3.3 (Phase 3)

- **When:** 2026-10-27T17:56:10Z
- **Steps:** 3.1..3.3 (`c993656a0`..`1092be826`)
- **Areas:** agent_orchestrator trace page "Model calls" card (`components/trace/{LlmStepMetadataCard.tsx,llmStepRows.ts}`, `backend/traces/[id]/page.tsx`, `i18n/*`), ingest normalization (`lib/trace/{traceIngestionService,genAiAttributes}.ts`), integration spec `__integration__/TC-AGENT-TRACE-005-step-metadata.spec.ts`.

| Check | Result |
|---|---|
| `yarn typecheck` | pass |
| `npx jest src/modules/agent_orchestrator` | pass — 2104 tests; one suite (`integrity-reference-exists`, untouched since wave 3) hit a jest-worker SIGSEGV and passed alone (25/25) |
| `TC-AGENT-TRACE-005` on the ephemeral app (AO enabled) | 2 passed, 1 skipped (native-run case: no LLM provider) |

Integration command: `OM_ENABLE_ENTERPRISE_MODULES=true OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true JWT_SECRET=<ephemeral default> BASE_URL=… DATABASE_URL=… npx playwright test --config .ai/qa/tests/playwright.config.ts TC-AGENT-TRACE-005 --reporter=list,json`

Artifacts (`checkpoint-3-artifacts/`):
- `screenshot-trace-capture-settings.png` — settings page (deployment limits, policy form, per-agent overrides)
- `screenshot-trace-model-calls-card.png` — Model calls card (parameters vs provider default, micro cost, fidelity)
- `screenshot-trace-page.png` — full trace page with the card

Notes:
- Ingest normalization runs only on llm spans that carry at least one gen_ai/om key, so legacy-only spans and level `off` stay byte-identical.
- The settings cleanup leaves a tenant row equal to the default when the tenant had none (no DELETE route).
