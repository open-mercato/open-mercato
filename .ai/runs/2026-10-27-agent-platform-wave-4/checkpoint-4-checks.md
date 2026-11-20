# Checkpoint 4 — Steps 4.1..4.5 (OTel exporter core)

- **When:** 2026-10-27T18:17:02Z
- **Steps:** 4.1..4.5 (`594eef24a`..`0107e7fdf`)
- **Areas:** agent_orchestrator `lib/trace/otel/{ids,otlpJson,loadRunExportBundle,mapAgentRunToOtlp,otelAttributes,exportSettings,otlpHttpClient,exportHealth}.ts`, `lib/trace/{redactStrings,runManifestView}.ts`, `components/RunManifestCard.tsx` (schema moved to lib, exports unchanged), `data/validators.ts`.

| Check | Result |
|---|---|
| `yarn typecheck` | pass |
| `npx jest src/modules/agent_orchestrator` | pass — 215 suites, 2235 tests |
| UI / integration | skipped — no UI or route in this window (pure libraries) |

Decisions:
- Deployment export counts as enabled only with the switch on, `http/json`, and a usable http(s) endpoint; the client never follows redirects (credential headers stay on the configured host).
- Workflow root span is emitted only by root runs (identical across siblings via deterministic ids); a parent run's span wins over the workflow span.
- Re-run link only when the original's trace id is known; otherwise `om.run.rerun_of`.
- Data gaps recorded for the spec: no effector spans are written today, no proposal option count (encrypted payload), no guardrail rule id column, no process re-run reader.
