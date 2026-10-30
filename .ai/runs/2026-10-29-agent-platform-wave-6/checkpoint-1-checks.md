# Checkpoint 1 — Steps 1.1..3.2

- **When:** 2026-10-30T10:40:53Z
- **Steps:** 1.1–1.5 (OTel content export), 2.1–2.2 (OTLP protobuf), 3.1–3.2 (OTLP export integration, tenant endpoint vetting + pinning) — `d6c2d09b0`..`a318ca824` + 1.1-review-fix (`cf8fc9019`).

| Check | Result |
|---|---|
| `yarn build:packages` → `yarn generate` → `yarn build:packages` | pass |
| `yarn i18n:check-sync`, `yarn i18n:check-usage` | pass |
| `yarn typecheck` | pass |
| time-bombs, pagination-capped, agents budget, dep-versions | pass |
| DS lint on changed `.tsx` | pass |
| enterprise `jest` (all) | pass — 340 suites, 3729 tests |
| core `jest src/__tests__ src/modules/integrations` | pass — 685 passed, 185 skipped |
| cli `jest src/lib/generators` (incl. module-facts size guard) | pass — 1473 tests |
| `yarn build:app` | pass |
| Integration, fresh ephemeral app with the full OTel env (`OM_AGENT_OTEL_EXPORT=on`, endpoint = fake receiver, `DELAY_MS=0`, `OM_AGENT_OTEL_TRACE_URL_TEMPLATE`, `CONTENT=allow`, `TENANT_ENDPOINTS=allow`, `PRIVATE_HOSTS=127.0.0.1`): every `TC-AGENT-*` spec | 95 passed, 13 skipped, 0 failed |

Findings:
- `TC-AGENT-OTEL-001` assumed the deployment always denies content (phase-1 behaviour); with `CONTENT=allow` an admin may now opt in → spec made environment-aware (**1.1-review-fix**).
- First integration attempts omitted `OM_AGENT_OTEL_EXPORT_DELAY_MS=0` and `OM_AGENT_OTEL_TRACE_URL_TEMPLATE` (both documented in TC-AGENT-OTEL-002's header), which made OTEL-002 time out; environment, not code. HANDOFF and executor rules now list the full env.
- Skips are environment-only (LLM provider or storage).

Artifacts: none kept.
