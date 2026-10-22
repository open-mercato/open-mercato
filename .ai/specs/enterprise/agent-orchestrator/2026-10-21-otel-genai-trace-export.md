# Agent Orchestrator — OpenTelemetry GenAI Trace Export

> **Status:** Draft · **Date:** 2026-10-21 · **Package:** `packages/enterprise/src/modules/agent_orchestrator`
> **Driven by:** a recurring operator question: "can agent traces go to our OpenTelemetry/OTLP backend with GenAI conventions?" Everything here is generic.
> **Supersedes:** the "optional default-OFF OTel GenAI exporter" paragraphs of `next/2026-06-20-agent-eval-harness-and-metrics.md` (§(c), Phase 5) and `next/gap-analysis/gap-05-metrics-observability.md` option (d). Those documents assumed "`telemetry-and-otel` does not exist"; it now does (`packages/telemetry`, spec `.ai/specs/2026-04-29-telemetry-and-otel.md`), which changes the design. The flag name `OM_AGENT_OTEL_EXPORT` they reserved is kept.
> **Depends on:** [`2026-10-21-agent-run-observability-full-fidelity.md`](./2026-10-21-agent-run-observability-full-fidelity.md) (per-step `gen_ai.*` attributes, run manifest, content artifacts, capture levels). Phase 1 here has **no hard dependency**: it works on today's spans with reduced attributes. Manifest-derived keys (identity, versions, `traceparent` link) appear once that spec's Phase 1 lands; per-step model params, provider and cost once its Phase 2 lands (recommended before relying on the export); Phase 2 here (content events) requires its Phase 3 (content artifacts).
> **Related specs (2026-10-21 set):** [`2026-10-21-agent-invocation-access-and-identity-binding.md`](./2026-10-21-agent-invocation-access-and-identity-binding.md) (identity fields read from the manifest), [`2026-10-21-output-integrity-guardrails.md`](./2026-10-21-output-integrity-guardrails.md) (new guardrail kinds exported as `om.guardrail.check` events), [`2026-10-21-eval-reports-and-reproducible-regression.md`](./2026-10-21-eval-reports-and-reproducible-regression.md) (eval results exported as events), [`../../2026-10-21-chat-run-tracing-and-citations.md`](../../2026-10-21-chat-run-tracing-and-citations.md) (OSS chat runs; out of scope here, Q7). Umbrella: [`../../2026-10-21-agent-platform-capabilities-roadmap.md`](../../2026-10-21-agent-platform-capabilities-roadmap.md).

## TLDR

**Key Points:**
- An **opt-in, fail-open** exporter that sends Agent Orchestrator runs, LLM steps, tool calls, dispositions, effector executions and eval results to any **OTLP** backend (collector, Jaeger, Tempo, Langfuse/Phoenix OTLP endpoints, Datadog/New Relic/SigNoz OTLP) using **OpenTelemetry GenAI semantic conventions** (`gen_ai.*`).
- It is a **replay exporter**: it reads the persisted, already-redacted AO trace after a run settles and emits spans with their recorded timestamps and **deterministic trace/span ids**. Runs, re-ingests and exports never block each other.

**Scope:**
- Phase 1 (minimum useful): export from persisted rows over **OTLP/HTTP JSON** with zero new npm dependencies, metadata only (no prompt/completion content), per-deployment endpoint, per-tenant opt-in, batching/retry, backfill CLI, local collector/Jaeger test setup.
- Phase 2: opt-in content events (prompts/completions/tool args) gated by the capture level of the observability spec plus a deployment allow-switch; OTLP/HTTP protobuf; per-tenant endpoints.
- Phase 3: live streaming of in-flight spans through the platform telemetry bridge (metadata only).

**Concerns:**
- The platform telemetry policy (`packages/telemetry/AGENTS.md`, telemetry spec S6) forbids prompt/completion content and request bodies in telemetry. Content export is therefore a **separate, explicitly allowed channel** that never rides the platform pipeline, and stays off unless both the deployment and the tenant allow it.
- GenAI semantic conventions are **experimental** and were moved out of `@opentelemetry/semantic-conventions` into the separate `semantic-conventions-genai` repository (the 1.43 constants in `node_modules` are marked `@deprecated` with that note). We pin a named convention version and own the key strings.

## Open Questions (autonomous defaults applied — confirm before implementation)

| # | Question | Default applied | Why |
|---|---|---|---|
| Q1 | Encode OTLP ourselves (HTTP/JSON, no deps) or add `@opentelemetry/*` imports to `@open-mercato/enterprise`? `packages/telemetry/AGENTS.md` says OTel packages "may only be imported by `provider/otlp-provider.ts` and `browser/BrowserTelemetry.tsx`… Adding a third runtime importer needs approval". | Phase 1 hand-encodes OTLP/HTTP **JSON** (a stable OTLP encoding). Protobuf/gRPC deferred and, if wanted, added inside `@open-mercato/telemetry` as an approved capability, not in enterprise. | Zero dependency/audit surface; respects the import rule; JSON is accepted by the OTel Collector, Jaeger v2, Tempo and most vendor OTLP endpoints. |
| Q2 | Content export (`gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`, tool args/results): allow at all? | Phase 2, off by default, requires `OM_AGENT_OTEL_EXPORT_CONTENT=allow` **and** tenant `content: 'full'` **and** the run's capture level `full`. | Content leaving the system is a data-transfer decision (GDPR processor chain); three independent locks. **Resolved 2026-10-22: approved as stated.** |
| Q3 | Per-tenant OTLP endpoints/credentials in Phase 1? | No: one deployment endpoint; tenants only opt in. Per-tenant endpoints in Phase 2 via the `integrations` credential store (encrypted), not module config. | Credentials need encrypted storage; module config is not the place. |
| Q4 | Export ledger (which runs were exported, last attempt, error) — needs a table, and AO migrations are squash-only. | No ledger in Phase 1: at-least-once delivery with deterministic ids + BullMQ job-id dedupe + structured logs/`reportError`. A ledger table is added at the next planned AO re-squash (listed in the roadmap's consolidated next-re-squash list, shared migration policy of all 2026-10-21 AO specs). | Avoids a destructive re-squash for a single table. |
| Q5 | A fresh-context scope review returned **SPLIT (mild)**: Phase 3 (live streaming) is a different capability — it changes `runAiAgentObject` in the OSS ai-assistant package, uses the platform telemetry pipeline instead of this exporter, and shares only the key constants (`genAiAttributes.ts`) and the optional `traceparent` link; it does not use the OTLP mapper or encoder. Split Phase 3 into its own spec? | Recommended: yes — move Phase 3 to a follow-up spec (likely OSS, owned with the chat-tracing spec, since it instruments ai-assistant). It stays here only as a sketch until the maintainer decides. | Phases 1–2 (replay export) are one cohesive capability; Phase 3 has a different package, pipeline and operator audience. |
| Q6 | Should dispositions/effector/eval results (not GenAI operations) be exported? | Yes, as `om.*`-named INTERNAL spans/events in the same trace. | Operators want the human decision and the command outcome on the same trace as the model call. |
| Q7 | Export chat/copilot runs persisted by the OSS chat-tracing spec (`ai_agent_runs` tables) too? | Not here. Those tables are OSS; their exporter belongs with the live-streaming follow-up or an OSS spec, reusing `genAiAttributes.ts`. | Keeps this exporter AO-only and enterprise-only. |

## Overview

AO already stores a complete, tenant-scoped trace tree per run: `agent_runs` (model, tokens, cost, latency, status, `workflow_instance_id`, `parent_run_id`, `rerun_of_run_id`), `agent_spans` (`llm`/`tool`/`system`, timings, deterministic `external_span_id`, jsonb `attributes`), `agent_tool_calls` (redacted summaries + encrypted offload keys), `agent_proposals` (disposition), the effector claim span `proposal-execution:<id>`, `agent_eval_results`. `POST /api/agent_orchestrator/trace/ingest` is **inbound only** (HMAC-verified webhook for runtime adapters). Nothing leaves the system.

Operators who run an observability stack want agent activity next to their HTTP/DB traces, with standard GenAI dashboards (token usage, latency, error rates per model/agent). The platform already has an opt-in OTLP pipeline (`@open-mercato/telemetry`: `TELEMETRY_BACKEND=otlp`, OTLP/HTTP exporter, `pg`/`undici` auto-instrumentation, a profile-gated `otel-collector` service in `starters/docker/compose.fullapp.yml` with `docker/otel-collector-config.yaml`). This spec adds the agent-specific layer on top, without changing that package's contracts.

> **Market Reference**: **OpenLLMetry (Traceloop)** and **OpenInference (Arize)** instrument LLM SDKs live and emit GenAI spans; **Langfuse** and **Phoenix** accept OTLP and render GenAI spans as generations. Adopted: GenAI span names/attributes (`chat {model}`, `execute_tool {tool}`, `invoke_agent {agent}`, `invoke_workflow`), content as opt-in, evaluation results as `gen_ai.evaluation.result` events. Rejected for Phase 1: live SDK monkey-patching (OpenLLMetry style) — AO already persists a normalized, redacted trace, and replaying it gives stable ids, survives restarts, covers OpenCode/external runtimes that cannot be instrumented in-process, and never couples model-call latency to an exporter.

## Problem Statement

1. No outbound path for agent traces exists; `/trace/ingest` is inbound only.
2. Platform telemetry cannot simply carry them: it emits live spans only (`TelemetryProvider.runInSpan`, delegation model; `SpanOptions` has no start time or explicit ids — `packages/telemetry/src/types.ts`), its sampling ratio defaults to 0.1 in production (`env.ts`), and its policy forbids content.
3. OpenCode and externally ingested runs never execute inside an OM process span, so live instrumentation would miss them entirely.
4. Earlier specs planned an exporter against a world without `@open-mercato/telemetry`; their assumptions are stale.

## Proposed Solution

### Shape

```
run settles (native: runs.complete → run.completed; OpenCode/external: trace.ingest → run.ingested)
  │ subscriber (persistent): if exporter enabled for tenant → enqueue {runId} delayed 30s, jobId otel:<runId>:<n>
  ▼
queue `agent-orchestrator-otel-export` (concurrency 2)
  │ worker: load run by id, re-resolve scope from the row (payload carries runId only)
  │ skip unless status terminal; load spans, tool calls, proposals, effector span, eval results, manifest
  │ map → OTLP JSON ResourceSpans (pure function, fixture-tested)
  │ POST {endpoint}/v1/traces  (gzip, timeout 10s, headers from env)
  │ 2xx → done · 429/502/503/504/network → retry w/ exponential backoff + Retry-After (max 5)
  │ 4xx other → drop + reportError(code 'agent_orchestrator.otel_export_rejected')
  ▼
OTLP backend (collector → Tempo/Jaeger/Langfuse/vendor)
```

- **Fail-open:** exporter errors never touch runs, proposals or ingest; they surface as `reportError` (telemetry error funnel, when enabled), a structured log, and a `System health` tile line (`lib/systemHealth.ts`) "OTel export: last success / last error".
- **At-least-once:** a re-export sends the same ids; collectors/backends either dedupe or show a duplicate span (documented). Late spans (an ingest that appends after export) trigger a new job `otel:<runId>:<spanCount>`; the backend sees the full set again.

### Deterministic ids

| OTel id | Derivation |
|---|---|
| `traceId` (16 bytes) | `sha256("om-agent-trace\0" + tenantId + "\0" + (workflowInstanceId ?? rootRunId))[0..16]` — every run of one process execution shares one trace; a standalone run (playground, headless, eval) is its own trace; nested runs (`parent_run_id`) use the root run's id. |
| `spanId` of the run span | `sha256("om-agent-run\0" + run.id)[0..8]` |
| `spanId` of an `agent_spans` row | `sha256("om-agent-span\0" + agentSpan.id)[0..8]` |
| `spanId` of the workflow root span | `sha256("om-agent-workflow\0" + workflowInstanceId)[0..8]` |
| `spanId` of a disposition span | `sha256("om-agent-disposition\0" + proposal.id)[0..8]` |

An all-zero id is replaced by flipping the last byte (OTLP rejects zero ids). The tenant id in the trace-id seed prevents two tenants' identical workflow ids from colliding.

### Links

- **Platform trace:** the observability spec's manifest stores `om.platform_trace.traceparent` (captured with `captureTelemetryTrace()` at run start). The run span gets an OTLP **link** to it, so a backend can jump from the agent trace to the HTTP/worker trace that caused it.
- **Re-runs:** `agent_runs.rerun_of_run_id` → link to the original run span; `process_instances.triggered_by.rerunOfExecutionId` (read with `readRerunOfExecutionId`) → link from the workflow root span to the original execution's root span.

### Mapping table (AO → OTel)

Convention pin: **OpenTelemetry GenAI semantic conventions as published with `@opentelemetry/semantic-conventions` 1.43 (incubating)**, keys owned as string constants in `lib/trace/genAiAttributes.ts` (shared with the observability spec). Exporter sets resource attribute `om.genai.semconv = "1.43"`.

| AO record | OTel span name | Kind | Parent | Key attributes |
|---|---|---|---|---|
| Process execution (`process_instances` / `workflow_instance_id`) | `invoke_workflow {processKey}` | INTERNAL | — (root) | `gen_ai.operation.name=invoke_workflow`, `gen_ai.workflow.name`, `om.process.execution_id`, `om.process.definition_id`, `om.process.status`, `om.subject.type` (no subject title — encrypted PII) |
| `agent_runs` row | `invoke_agent {agentId}` | INTERNAL | workflow span, or parent run's span (`parent_run_id`), or root | `om.entry_point`, `om.channel`, `om.correlation_id` and invoker kind from the manifest (identity owned by `2026-10-21-agent-invocation-access-and-identity-binding.md`), `gen_ai.operation.name=invoke_agent`, `gen_ai.agent.id`, `gen_ai.agent.name` (registry label), `gen_ai.agent.version` (`agent_version`), `gen_ai.request.model` (`model`), `gen_ai.usage.input_tokens`/`output_tokens` (run totals), `om.run.id`, `om.run.source` (`runtime|eval`), `om.run.runtime`, `om.run.result_kind`, `om.run.agent_type`, `om.run.confidence`, `om.cost.minor`, `om.cost.currency`, `om.workflow.step_id`, `om.invocation.id`; manifest keys when present (`om.agent.definition_hash`, `om.prompt.override.version`, `om.tools.sha256`, `om.knowledge.<key>`), invoker ids (`enduser.id` = invoker user id only when tenant `exportUserIds: true`, else omitted) |
| `agent_spans` kind `llm` | `chat {model}` | CLIENT | run span | `gen_ai.operation.name=chat`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.response.id`, `gen_ai.request.temperature`/`top_p`/`top_k`/`max_tokens`/`seed`/`stop_sequences`/`presence_penalty`/`frequency_penalty`, `gen_ai.usage.input_tokens`/`output_tokens`/`cache_read.input_tokens`/`reasoning.output_tokens`, `gen_ai.response.finish_reasons`, `gen_ai.output.type=json` (object-mode), `om.cost.micros`, `om.capture.fidelity`. Today's spans (before the observability spec) carry only `inputTokens`/`outputTokens`/`finishReason`; the mapper maps those legacy keys. |
| `agent_spans` kind `tool` + `agent_tool_calls` | `execute_tool {toolName}` | INTERNAL | the `llm` span that issued it (native: `parentExternalSpanId`), else run span | `gen_ai.operation.name=execute_tool`, `gen_ai.tool.name`, `gen_ai.tool.type=function`, `gen_ai.tool.call.id` (when recorded), `om.tool.status`, `om.tool.latency_ms`, `error.type` on error; `om.retrieval.*` / `om.knowledge.*` ids from the observability spec. Args/results only at content level `full` as `gen_ai.tool.call.arguments` / `gen_ai.tool.call.result` (Phase 2). |
| `agent_spans` name `run.manifest` (kind `system`) | not exported as a span | — | — | merged into the run span's attributes |
| Effector claim span `proposal-execution:<id>` | `om.proposal.execute` | INTERNAL | disposition span | `om.proposal.id`, `om.effector.ok`, `om.effector.command_ids` (array), `om.effector.state` |
| Other `system` spans | `om.{name}` | INTERNAL | run span | `om.span.name` |
| `agent_proposals` disposition | `om.proposal.disposition` | INTERNAL | run span | `om.proposal.id`, `om.proposal.disposition`, `om.proposal.disposition_by_kind` (`user|rule`), `om.proposal.auto_disposition_block`, `om.proposal.selected_option_id`, `om.proposal.option_count` — never `disposition_reason` (free text) |
| `agent_eval_results` | event `gen_ai.evaluation.result` on the run span | — | — | `gen_ai.evaluation.name` (assertion key), `gen_ai.evaluation.score.value`, `gen_ai.evaluation.score.label` (`pass|fail|warn`), never `evidence` (encrypted) |
| Guardrail checks | event `om.guardrail.check` on the run span | — | — | `om.guardrail.capability`, `om.guardrail.verdict`, `om.guardrail.kind` (incl. the integrity spec's kinds), `om.guardrail.rule_id` when present — never evidence beyond counts |
| Content (Phase 2) | event `gen_ai.client.inference.operation.details` on the `chat` span | — | — | `gen_ai.system_instructions`, `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.tool.definitions` (structured, from the decrypted `llm_request`/`llm_response` artifacts of the observability spec) |

- Span **status**: `ERROR` with `error.type` for `status = 'error'`; run `cancelled` → `ERROR` + `error.type = "cancelled"`; otherwise `UNSET`.
- Timestamps: `startTimeUnixNano`/`endTimeUnixNano` from `started_at`/`ended_at` (run: `created_at`/`completed_at`); a missing end uses start + `duration_ms`, else start.
- **Resource:** `service.name` = `OM_AGENT_OTEL_SERVICE_NAME` (default `open-mercato-agents`), `service.version` (app version), `deployment.environment.name` from `OTEL_RESOURCE_ATTRIBUTES` when set, `om.tenant.id`, `om.organization.id` (one OTLP request per run, so per-request resource scoping is exact). Instrumentation scope: `@open-mercato/enterprise/agent_orchestrator`, version = package version.
- **Metrics:** not in Phase 1. Backends derive token/latency metrics from spans; `gen_ai.client.token.usage` / `gen_ai.client.operation.duration` histograms can be added in Phase 3 through `recordHistogram` on the platform bridge (low-cardinality labels: model, provider, operation — never tenant ids).

### PII / redaction policy

| Data | Phase 1 | Phase 2 (content allowed) |
|---|---|---|
| Ids (run, span, tenant, org, proposal, workflow, tool call) | exported | exported |
| User ids (invoker, principal, on-behalf-of) | omitted unless tenant `exportUserIds: true` | same |
| Emails, names, subject titles, run input/output, proposal payload, disposition reason, eval evidence, tool request/response summaries | **never** | never (summaries are not content; content comes only from the dedicated artifacts) |
| System prompt, messages, tool definitions, completions, tool args/results | **never** | only with all three locks (Q2); passed through the observability spec's redaction (already applied at capture) and a second `redactPii` pass on string values; per-attribute cap 64 KiB, truncated with `om.truncated=true` |
| Any string attribute | secret-key masking + email/Bearer scrubbing (patterns mirrored from `packages/telemetry/src/facade/redact.ts`) | same |

### Configuration

| Env (deployment) | Default | Meaning |
|---|---|---|
| `OM_AGENT_OTEL_EXPORT` | `off` | Master switch (name reserved by the eval-harness spec). |
| `OM_AGENT_OTEL_EXPORT_ENDPOINT` | `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, else `OTEL_EXPORTER_OTLP_ENDPOINT` + `/v1/traces` | Target. Reusing the platform variables means one collector serves both pipelines. |
| `OM_AGENT_OTEL_EXPORT_HEADERS` | `OTEL_EXPORTER_OTLP_HEADERS` | `k=v,k2=v2` (W3C OTLP env format). Never logged, never exposed to the browser. |
| `OM_AGENT_OTEL_EXPORT_PROTOCOL` | `http/json` | Phase 2 adds `http/protobuf`. gRPC is not planned: run a collector for gRPC fan-out. |
| `OM_AGENT_OTEL_EXPORT_CONTENT` | `deny` | `allow` permits tenants to opt into content (Phase 2). |
| `OM_AGENT_OTEL_EXPORT_DELAY_MS` | `30000` | Settle delay after run completion. |
| `OM_AGENT_OTEL_SERVICE_NAME` | `open-mercato-agents` | Resource `service.name`. |
| `OM_AGENT_OTEL_EXPORT_SOURCES` | `runtime,eval` | Which `agent_runs.source` values export. |
| `OM_AGENT_OTEL_TRACE_URL_TEMPLATE` | unset | Trace-page deep link into the tracing backend, e.g. `https://grafana/explore?traceId={traceId}` (UI section); the link is hidden when unset. |

Per tenant (module config `agent_orchestrator/otel_export`, same store as `auto_approval_policy`):
```ts
const otelExportSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  content: z.enum(['none', 'full']).default('none'),
  exportUserIds: z.boolean().default(false),
  agentAllowlist: z.array(z.string().max(100)).max(200).optional(),   // absent = all agents
})
```
Effective export = deployment `on` ∧ tenant `enabled` ∧ (allowlist absent ∨ agent in allowlist).

### Design Decisions

| Decision | Rationale |
|---|---|
| Replay from persisted rows, not live instrumentation (Phase 1) | Covers native, OpenCode and external runtimes uniformly; data is already redacted/normalized; deterministic ids; no added latency on model calls; independent of the platform sampler. |
| Separate pipeline from `@open-mercato/telemetry` | That package's providers own live span creation (delegation model, no explicit timestamps/ids) and its policy forbids content. Reusing its env variables keeps one collector. |
| OTLP/HTTP JSON hand-encoded | No new dependency (Q1); the encoding is a few hundred lines with fixtures; protobuf is available later via the telemetry package. |
| One OTLP request per run | Natural batch (a run is 1–200 spans); per-request resource carries tenant/org; a poison run cannot block others. Runs with > 1000 spans are split into chunks of 512. |
| Events for eval results, spans for dispositions | Matches the convention's `gen_ai.evaluation.result` event; a disposition has duration and a parent, so it is a span. |

### Alternatives Considered

| Alternative | Why rejected |
|---|---|
| AI SDK 7 `Telemetry` integration (`experimental_telemetry.integrations` / `registerTelemetry`) emitting live spans | Native-only, live-only, sampled by the platform ratio, and content would have to be forced off per telemetry S6. Kept as Phase 3 for live metadata spans. |
| `@opentelemetry/sdk-trace-base` + `OTLPTraceExporter` inside enterprise | Violates the telemetry import rule without approval; needs `ReadableSpan` construction to fake historical spans. |
| Export straight from `ingestTrace` synchronously | Couples ingest latency and failure to the backend; violates fail-open. |
| Collector-side pull (Postgres receiver) | Exposes the DB to the collector and bypasses tenant opt-in and redaction. |

## User Stories / Use Cases

- **Platform operator** wants **AO traces in the company Tempo/Grafana with standard GenAI panels** so that **agent latency, token use and errors sit next to the rest of the system**.
- **Tenant admin** wants **to opt the tenant in (or keep it out)** so that **data leaves the platform only by decision**.
- **SRE** wants **to jump from a slow HTTP request trace to the agent run it triggered** so that **root cause spans both**.
- **Data protection officer** wants **content export to require explicit, layered consent** so that **prompts never reach a third-party backend by default**.
- **Engineer** wants **to backfill the last 7 days of runs into a fresh backend** so that **a new dashboard has history**.

## Architecture

- `lib/trace/otel/mapAgentRunToOtlp.ts` — pure: `(RunExportBundle, settings) → OtlpResourceSpans[]`.
- `lib/trace/otel/otlpJson.ts` — pure: OTLP/JSON encoder (ids as lowercase hex per the OTLP/JSON spec, `AnyValue` arrays/kvlists, nanosecond timestamps as strings).
- `lib/trace/otel/otlpHttpClient.ts` — POST with gzip, timeout, retry classification, `Retry-After`; uses Node `fetch`/`undici` (server-side only; the `undici` auto-instrumentation of the platform will create a client span for the export call when telemetry is on — the exporter sets header `x-om-otel-export: 1` and the call is excluded from its own export by construction, since only AO rows are exported).
- `lib/trace/otel/exportSettings.ts` — env + module-config resolution, cached per tenant (tag-invalidated on update).
- `lib/trace/otel/loadRunExportBundle.ts` — reads run + spans + tool calls (`findWithDecryption` not needed: only non-encrypted columns are exported; content artifacts via `getArtifact` in Phase 2) + proposals + eval results + guardrail checks + process instance, all scoped by the run's tenant/org.
- `subscribers/otel-export-enqueue.ts` — on `agent_orchestrator.run.completed` and `agent_orchestrator.run.ingested` (persistent subscribers), enqueue when effective export is on.
- `workers/otel-export.ts` — the queue worker (`AGENT_ORCHESTRATOR_OTEL_EXPORT_QUEUE = 'agent-orchestrator-otel-export'` in `lib/queue.ts`); payload `{ runId }` only, scope re-resolved from the row (same anti-forgery rule as `ProcessExecutionJobPayload`).
- CLI `agent-orchestrator otel:export --run <id> | --since <iso> [--until <iso>] [--tenant <id>] [--dry-run]` — backfill/re-export; `--dry-run` prints the OTLP JSON.

### Commands & Events
- No new domain commands (export writes no domain state). Settings update: command `agent_orchestrator.otelExportSettings.update` (undoable; snapshot before/after).
- No new events. Consumes `agent_orchestrator.run.completed`, `agent_orchestrator.run.ingested`.

## Data Models

No entities, no columns (AO migrations are squash-only: `__tests__/helpers/squashMigration.ts` asserts exactly one migration file, and a re-squash forces existing databases to drop and re-initialise the module's tables — verified in `Migration20260906141535_agent_orchestrator.ts`). New persisted state is the module-config record `agent_orchestrator/otel_export` above. Export-attempt history lives in logs + `reportError` until the ledger table lands at the next planned re-squash (Q4):

```ts
// planned for the next re-squash, NOT in this change
AgentTraceExport { id, tenantId, organizationId, agentRunId, attempt, status: 'ok'|'failed'|'dropped',
                   spanCount, httpStatus?, errorCode?, exportedAt }
```

## API Contracts

### `GET | PUT /api/agent_orchestrator/otel-export/settings` (NEW)
- `GET` — `agent_orchestrator.trace.view`; `PUT` — `agent_orchestrator.agents.manage` (and `agent_orchestrator.trace.view_content` from the observability spec when setting `content: 'full'`).
- Body: `otelExportSettingsSchema`. Response: `{ settings, deployment: { enabled, endpointConfigured, protocol, contentAllowed }, health: { lastSuccessAt, lastErrorAt, lastErrorCode } }` — endpoint URL and headers are never returned.
- `PUT` with `content: 'full'` while `OM_AGENT_OTEL_EXPORT_CONTENT != allow` → `422 { error: 'content_export_not_allowed' }`.
- Exports `openApi`.

### `POST /api/agent_orchestrator/otel-export/test` (NEW)
- `agent_orchestrator.agents.manage`. Sends one synthetic span (`om.export.test`) for the caller's tenant; returns `{ ok, httpStatus, latencyMs }`. Rate-limited (1 per 10 s per tenant) via the module's existing rate-limiter service pattern.

### `POST /api/agent_orchestrator/trace/ingest` (existing)
- Unchanged. Remains inbound only.

## Internationalization (i18n)
Keys `agent_orchestrator.settings.otelExport.*` (title, enabled, content, contentNotAllowed, exportUserIds, agentAllowlist, testConnection, lastSuccess, lastError, deploymentDisabled) and `agent_orchestrator.health.otelExport.*`.

## UI/UX
- **Settings → OTel export** (`backend/settings/otel-export/`, sibling of `auto-approval`, `web-search`): `CrudForm` over the tenant settings (optimistic lock via the config record's `updatedAt`); a read-only deployment block (enabled, endpoint configured yes/no, protocol, content allowed); "Send test span" button (`useGuardedMutation`); last success/error via `StatusBadge`.
- **System health tile:** one line for exporter status when enabled.
- **Trace page:** when export is on, an icon link "Open in tracing backend" built from `OM_AGENT_OTEL_TRACE_URL_TEMPLATE` (e.g. `https://grafana/explore?traceId={traceId}`), showing the deterministic trace id (copyable).
- DS rules: semantic tokens, shared primitives, `aria-label` on icon buttons.

## Dependency Review

| Item | Phase 1 | Notes |
|---|---|---|
| New npm dependencies | **None** | OTLP/JSON encoder in-house; HTTP via Node `fetch`. `npm audit` delta: none. |
| `@opentelemetry/semantic-conventions` | Not imported | 1.43 present transitively (optional dep of `@open-mercato/telemetry`); its `gen_ai.*` constants are deprecated in favour of the `semantic-conventions-genai` repo, so we own the strings. |
| Phase 2 protobuf | `@opentelemetry/otlp-transformer` / `exporter-trace-otlp-proto` `^0.220.0` are already optional deps of `@open-mercato/telemetry` (verified in `packages/telemetry/package.json`, installed 0.220.0); usage would be added **inside** that package behind a new approved API (`exportSpanRecords`), loaded via dynamic `import()`. Run `npm audit`/`yarn npm audit` at that time. |
| ESM | `@open-mercato/enterprise` is `"type": "module"`; the encoder is plain TS, no CJS interop. OTel 2.x/0.220 ship dual ESM/CJS if Phase 2 uses them via the telemetry package. |
| Docker images (tests/docs only) | `otel/opentelemetry-collector:0.159.0` (already pinned in `starters/docker/compose.fullapp.yml`), `jaegertracing/jaeger:<pinned 2.x>` (choose a tag ≥ 2 weeks old at implementation; Jaeger v2 accepts OTLP/HTTP on 4318 and serves `GET /api/traces/{traceId}`). |

## Is Phase 1 realistic?

**Yes, for Phase 1, in about 4–6 engineering days**, because the hard parts already exist: a persisted span tree with parent links, deterministic span ids, timings, token usage, run-level cost, and a queue/worker/subscriber pattern to copy (`workers/metric-rollup.ts`, `process-execution-starter.ts`). The end-to-end story "run an agent → open Jaeger → see `invoke_workflow` → `invoke_agent` → `chat` → `execute_tool` with tokens and timings, plus the human disposition span" is achievable without new dependencies.

Caveats to state to adopters:
- With today's spans, `chat` spans carry tokens + finish reason only; **model params, per-step cost, provider and versions appear once the observability spec's Phase 2 lands** (strongly recommended before relying on the export).
- **Prompt/completion content in the external backend is Phase 2** and gated by three locks; until then, content is shown in the OM trace UI (observability spec), and the OTel backend shows metadata. This is the defensible default in regulated settings.
- Export is **near-real-time (≈30 s after completion)**, not streaming; live in-flight spans are Phase 3.
- GenAI conventions are experimental; dashboards built on them may need key updates when the convention moves.

## Implementation Plan

### Phase 1: Replay export, metadata only
1. `lib/trace/genAiAttributes.ts` (shared with the observability spec; if that spec lands first, reuse).
2. `otlpJson.ts` encoder + golden-fixture unit tests (validated against the OTLP/JSON protobuf mapping: hex ids, string nanos, `AnyValue`).
3. `mapAgentRunToOtlp.ts` + fixtures: standalone run, workflow execution with two runs, nested delegation, error run, toolless run (synthetic `llm` span), OpenCode run (tool spans only), disposition + effector, eval results.
4. Deterministic id helpers + tests (stability, tenant separation, non-zero).
5. Settings (env + module config), settings API + command + page; test-span endpoint.
6. Queue, subscriber, worker with retry classification; `reportError` codes `agent_orchestrator.otel_export_failed|otel_export_rejected`; system-health line.
7. CLI `otel:export` (backfill, dry-run).
8. Docs: `apps/docs/docs/framework/ai-assistant/` (or the AO docs section) "Exporting agent traces to OpenTelemetry"; `.env.example` + template sync.
9. Tests (below).

### Phase 2: Content events, protobuf, per-tenant endpoints
1. Content event from decrypted `llm_request`/`llm_response` artifacts when all three locks hold; tool args/results attributes.
2. Protobuf via an approved `@open-mercato/telemetry` capability (separate PR in that package).
3. Per-tenant endpoint + headers through `integrations` credentials (encrypted); settings UI picks a configured integration.
4. Export ledger table at the next planned re-squash (if scheduled).

### Phase 3: Live streaming (metadata) — candidate for a separate spec (Q5)
1. In `runAiAgentObject` (ai-assistant) and the AO runners, wrap the run and each model/tool call in `withTelemetrySpan` (`@open-mercato/shared/lib/telemetry/runtime`) with `gen_ai.*` metadata attributes only — content forced off per telemetry S6. Spans then appear live inside the request/worker trace under the platform sampler.
2. Correlate: the live run span carries `om.run.id`; the replay export links to the live trace via the manifest `traceparent`. Operators choose `OM_AGENT_OTEL_EXPORT_MODE = replay | live | both` (default `replay`) to avoid double counting in dashboards.
3. Optional `gen_ai.client.token.usage` / `gen_ai.client.operation.duration` histograms via `recordHistogram`.

### File Manifest
| File | Action | Purpose |
|---|---|---|
| `…/agent_orchestrator/lib/trace/genAiAttributes.ts` | Create (or reuse) | Pinned key constants |
| `…/agent_orchestrator/lib/trace/otel/{otlpJson,mapAgentRunToOtlp,otlpHttpClient,exportSettings,loadRunExportBundle,ids}.ts` | Create | Exporter core |
| `…/agent_orchestrator/lib/queue.ts` | Modify | Queue name + payload type |
| `…/agent_orchestrator/subscribers/otel-export-enqueue.ts` | Create | Trigger |
| `…/agent_orchestrator/workers/otel-export.ts` | Create | Worker |
| `…/agent_orchestrator/commands/otelExport.ts` | Create | Settings command |
| `…/agent_orchestrator/api/otel-export/{settings,test}/route.ts` | Create | APIs |
| `…/agent_orchestrator/backend/settings/otel-export/*` | Create | Settings page |
| `…/agent_orchestrator/cli.ts` | Modify | `otel:export` |
| `…/agent_orchestrator/lib/systemHealth.ts` | Modify | Exporter status |
| `docker/otel-collector-config.jaeger.yaml`, `starters/docker/compose.agent-otel.yml` | Create | Local collector → Jaeger profile for QA |

### Testing Strategy
- **Unit (Jest):** encoder golden files; mapper fixtures per scenario above; id determinism; redaction (emails, Bearer, secret keys never present; disposition reason/evidence/subject title absent); settings resolution (deployment off wins; content lock matrix); retry classification (429 with `Retry-After`, 503, 400 drop, timeout).
- **Integration, CI (Playwright, self-contained):** `TC-AGENT-OTEL-001` — a fake OTLP receiver (tiny Node HTTP server started by the test fixture on a free port; the app under test is started with `OM_AGENT_OTEL_EXPORT=on`, `OM_AGENT_OTEL_EXPORT_ENDPOINT=http://127.0.0.1:<port>/v1/traces`, `OM_AGENT_OTEL_EXPORT_DELAY_MS=0`) captures requests. The test enables export for its tenant via the settings API, runs a scripted agent (`OM_AI_PROVIDER=scripted`) through `POST /agents/:id/run`, polls the receiver, asserts: one `invoke_agent` span with the expected deterministic trace id, child `chat` spans with `gen_ai.usage.*`, no content keys, tenant resource attributes; then disables export in `finally`. `TC-AGENT-OTEL-002` — tenant opted out → no request; `content: 'full'` rejected with 422 when deployment denies content. `TC-AGENT-OTEL-003` — backfill CLI `--dry-run` output parses as OTLP JSON.
- **Manual / QA (documented, not in CI):** `docker compose -f starters/docker/compose.agent-otel.yml --profile agent-otel up` → collector (OTLP/HTTP 4318, `batch`, exporters `debug` + `otlp` → Jaeger) and Jaeger v2 UI on 16686; set the env, run an agent process, open the trace by id from the trace page link; verify the tree `invoke_workflow → invoke_agent → chat → execute_tool` + `om.proposal.disposition → om.proposal.execute`.
- **Tenant isolation:** worker refuses to export a run whose tenant has export disabled even if a job exists (settings re-checked in the worker).

## Migration & Backward Compatibility

- No DDL (squash-only constraint honoured). No changes to existing routes, events, types, or DI names.
- Additive contract surfaces: new API routes (`/otel-export/settings`, `/otel-export/test`), new CLI command `otel:export` (BC category 13, additive), new queue name, new env vars, new module-config key. No new ACL features (reuses `trace.view`, `agents.manage`, and the observability spec's `trace.view_content`).
- Platform telemetry contracts untouched in Phases 1–2; Phase 3 uses only the existing `withTelemetrySpan` bridge.
- `next/2026-06-20-agent-eval-harness-and-metrics.md` and `gap-05` are superseded on the exporter point only; add a pointer line to both when this spec is accepted.

## Risks & Impact Review

### Data Integrity Failures
- Export is read-only over AO tables; a crash mid-export leaves nothing inconsistent. Partial delivery (backend accepted some chunks) is repaired by re-export with identical ids.

### Cascading Failures & Side Effects
- Backend down → retries with backoff, then drop + error report; queue depth bounded by `removeOnComplete/removeOnFail` and a per-tenant concurrency of 1 job at a time (jobs keyed by run). Runs/ingest unaffected.
- Event storm (bulk eval suite of 1000 runs) → 1000 delayed jobs; concurrency 2 and chunking keep the backend load bounded; eval export can be excluded via `OM_AGENT_OTEL_EXPORT_SOURCES=runtime`.

### Tenant & Data Isolation Risks
- One OTLP request per run carries exactly one tenant's resource; the worker re-resolves scope from the row; settings checked per job. Shared endpoint across tenants is a deployment decision (documented): tenants on one backend are separated by `om.tenant.id` resource attribute, so backend-side access control is the operator's responsibility; per-tenant endpoints (Phase 2) remove the sharing.

### Migration & Deployment Risks
- Off by default; enabling is env + tenant setting; disabling stops new jobs immediately (subscriber + worker both check).

### Operational Risks
- Volume: ~9M spans/yr scale (trace spec estimate) at full opt-in; OTLP/JSON is ~2× protobuf size; gzip mitigates. Phase 2 protobuf for heavy users.

#### Content leaks to an external backend
- **Scenario**: prompts with customer PII exported to a shared vendor backend.
- **Severity**: Critical
- **Affected area**: all tenants on that deployment
- **Mitigation**: content absent in Phase 1; Phase 2 requires deployment `allow` + tenant `full` + run captured at `full`; second redaction pass; per-attribute caps.
- **Residual risk**: free-text PII that evades pattern redaction when all three locks are deliberately opened — an informed, recorded (undoable command + action log) decision.

#### Semantic-convention churn
- **Scenario**: GenAI keys renamed (e.g. `gen_ai.system` → `gen_ai.provider.name` already happened).
- **Severity**: Medium
- **Affected area**: external dashboards
- **Mitigation**: keys centralised in `genAiAttributes.ts`, resource `om.genai.semconv` version, changelog entry per bump; optional dual-emit of the previous key for one minor (mirrors the BC deprecation protocol).
- **Residual risk**: dashboards need occasional updates.

#### Duplicate spans in backends without dedupe
- **Scenario**: re-export or retry after partial success.
- **Severity**: Low
- **Affected area**: dashboards counting spans
- **Mitigation**: deterministic ids (Tempo/Jaeger collapse identical span ids in trace view); BullMQ job-id dedupe; ledger at next re-squash.
- **Residual risk**: duplicate counts in some metrics pipelines; documented.

#### Exporter call appears in platform telemetry
- **Scenario**: `undici` auto-instrumentation records the OTLP POST as a client span in the platform pipeline (possibly to the same collector).
- **Severity**: Low
- **Mitigation**: expected and harmless; it is a real outbound call; header `x-om-otel-export: 1` lets operators filter it.
- **Residual risk**: none material.

## Final Compliance Report — 2026-10-21

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md`
- `packages/telemetry/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`
- `.ai/specs/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Never expose cross-tenant data | Compliant | One tenant per request; scope from row |
| root AGENTS.md | Ask before adding production dependencies | Compliant | None added in Phase 1; Phase 2 deps gated by Q1 |
| root AGENTS.md | Zod validation; no hard-coded strings; DS rules | Compliant | Settings schema; i18n keys; UI section |
| root AGENTS.md | Optimistic locking for user-editable settings | Compliant | Module-config `updatedAt` |
| root AGENTS.md / telemetry | Report every recorded error with a stable `code` | Compliant | `agent_orchestrator.otel_export_failed|rejected` |
| telemetry AGENTS.md | Never emit PII/record content/request bodies via telemetry | Compliant | Separate channel; Phase 1 has no content; Phase 2 behind three locks and outside the platform pipeline |
| telemetry AGENTS.md | OTel packages only in `otlp-provider.ts`/`BrowserTelemetry.tsx` | Compliant | Hand-encoded OTLP JSON; protobuf only inside telemetry after approval |
| telemetry AGENTS.md | Metric labels low-cardinality | Compliant | Phase 3 labels: model/provider/operation only |
| AO AGENTS.md | Squash-only migrations | Compliant | No DDL; ledger deferred |
| AO AGENTS.md | Flow/trace summaries redacted; secrets never leave | Compliant | Summaries not exported; redaction pass |
| BACKWARD_COMPATIBILITY.md | Additive-only | Compliant | New routes/CLI/env only |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Settings schema = API body |
| API contracts match UI/UX section | Pass | Settings page + test button |
| Risks cover all write operations | Pass | Only write is settings update (command) |
| Commands defined for all mutations | Pass | `otelExportSettings.update` |
| Cache strategy covers all read APIs | Pass | Settings cached per tenant, invalidated by the command |

### Non-Compliant Items
None.

### Verdict
- **Fully compliant**: Approved — ready for implementation after Q1–Q6 are confirmed.

## Changelog
### 2026-10-21
- Initial specification. Supersedes the exporter paragraphs of `next/2026-06-20-agent-eval-harness-and-metrics.md` and `next/gap-analysis/gap-05-metrics-observability.md`, whose premise "no telemetry package exists" is no longer true (`packages/telemetry`, OTLP/HTTP provider, compose `telemetry` profile with `otel-collector`). Verified: `/trace/ingest` is inbound only; telemetry facade has no explicit-timestamp/explicit-id span API; GenAI keys in `@opentelemetry/semantic-conventions` 1.43 are deprecated in favour of the `semantic-conventions-genai` repository; AO migrations are squash-only.
- Review 2026-10-21: fresh-context scope check returned SPLIT (mild) for Phase 3; Q5 reworded and Q7 added. Aligned with the sibling identity-binding and OSS chat-tracing specs (identity fields read from the manifest; chat runs out of scope).
- 2026-10-21 — cross-spec consistency pass: dependency statement made precise (Phase 1 has no hard dependency; manifest keys need observability Phase 1, per-step params/cost its Phase 2, content events its Phase 3); run span also maps `om.channel` / `om.correlation_id` (shared correlation vocabulary); guardrail events carry kind + rule id for the integrity spec's kinds; settings command renamed `agent_orchestrator.otelExportSettings.update` (AO command ids are camelCase, e.g. `evalRuns.start`); `OM_AGENT_OTEL_TRACE_URL_TEMPLATE` (used by the UI section) added to the configuration table; ledger table referenced in the roadmap's consolidated next-re-squash list; linked sibling specs and the roadmap.

### 2026-10-22
- Q2 resolved: Phase 2 content export is approved with the three locks: deployment `OM_AGENT_OTEL_EXPORT_CONTENT=allow`, tenant `content: 'full'`, and run capture level `full`.
