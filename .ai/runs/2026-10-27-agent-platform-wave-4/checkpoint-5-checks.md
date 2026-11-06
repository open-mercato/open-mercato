# Checkpoint 5 — Steps 4.6..4.11-review-fix (OTel delivery, surfaces, cache fix)

- **When:** 2026-10-27T19:43:17Z
- **Steps:** 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.11-review-fix (`f5ce9ad8d`..`4c0445581`)
- **Areas:** agent_orchestrator queue/subscribers/worker (`lib/trace/otel/exportJob.ts`, `workers/otel-export.ts`, `subscribers/otel-export-run-*.ts`), APIs `api/otel-export/{settings,test}`, command `commands/otelExport.ts`, settings page `backend/settings/otel-export`, system health `otelExport` indicator, `GET /runs/:id` `otel` field + trace link, CLI `otel:export`, `starters/docker/compose.agent-otel.yml` + `docker/otel-collector-config.jaeger.yaml`, integration specs `TC-AGENT-OTEL-001/002`; core `configs/lib/module-config-service.ts`.

| Check | Result |
|---|---|
| `yarn build:packages` | pass |
| `yarn typecheck` | pass |
| `npx jest src/modules/agent_orchestrator` | pass — 222 suites, 2341 tests |
| core `configs` + `module-decoupling` + `feature-policy-authorization-coverage` | pass — 13 suites, 101 tests |
| `docker compose -f starters/docker/compose.agent-otel.yml --profile agent-otel config -q` | pass (Step 4.10); `jaegertracing/jaeger:2.11.0` manifest exists |
| Integration on a rebuilt ephemeral app (AO on, `OM_AGENT_OTEL_EXPORT=on`, endpoint = fake receiver on 127.0.0.1:4319): `TC-AGENT-OTEL-001`, `TC-AGENT-OTEL-002`, `TC-AGENT-TRACE-005` | 5 passed, 1 skipped (native-run case: no LLM provider) |

Artifacts (`checkpoint-5-artifacts/`):
- `screenshot-otel-export-settings.png` — OTel export settings (deployment block without endpoint/credentials, tenant settings, health, test span)
- `screenshot-otel-trace-link.png` — trace page header with the deterministic trace id and "Open in tracing backend"

Findings and decisions:
- **Fixed (4.11-review-fix, approved by the user):** module-config cache entries were scoped by the caller's cache tenant, so persistent subscribers / workers (`tenant:global:`) read stale settings for up to 60 s after a route (`tenant:<id>:`) wrote them — affected OTel export opt-in/out, the trace capture policy and the auto-approval policy. Cache scope now follows the row; cache key version `v3`. TC-AGENT-OTEL-002 passes without TTL waits.
- The rate-limit 429 of the test-span route is covered by unit tests only: the ephemeral app disables rate limiting (`OM_INTEGRATION_TEST`).
- `TC-AGENT-OTEL-003` (CLI dry-run) is a unit test through the real `cli.ts` command — no integration spec shells out to the CLI.
