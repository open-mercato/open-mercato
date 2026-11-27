# AI Agent Runs — Live GenAI Spans Through the Platform Telemetry Bridge

> **Status:** Draft (not implemented). Open questions use autonomous defaults — confirm before implementation.
> **Split from:** Phase 3 ("Live streaming (metadata)") of [`enterprise/agent-orchestrator/2026-10-21-otel-genai-trace-export.md`](enterprise/agent-orchestrator/2026-10-21-otel-genai-trace-export.md), as decided in OTEL-Q5 (live streaming is a different capability: a different package, pipeline and audience) and OTEL-Q7 (OSS chat runs belong to an OSS follow-up, not the AO exporter).
> **Related:** [`2026-04-29-telemetry-and-otel.md`](2026-04-29-telemetry-and-otel.md) (platform telemetry; S6 names AI instrumentation as an ai-assistant follow-up), [`2026-10-21-chat-run-tracing-and-citations.md`](2026-10-21-chat-run-tracing-and-citations.md) (§6 model-call contract and observer, persisted chat runs), [`enterprise/agent-orchestrator/2026-10-21-agent-run-observability-full-fidelity.md`](enterprise/agent-orchestrator/2026-10-21-agent-run-observability-full-fidelity.md) (manifest `om.platform_trace.traceparent`). Umbrella: [`2026-10-21-agent-platform-capabilities-roadmap.md`](2026-10-21-agent-platform-capabilities-roadmap.md).
> **Scope:** OSS (`@open-mercato/ai-assistant`, `@open-mercato/shared`). The Agent Orchestrator delta (export mode, replay ↔ live links) is specified in the AO OTel spec's Phase 3 section, not here.

## TLDR

- When platform telemetry is on (`TELEMETRY_BACKEND=otlp`), AI agent runs emit **live, metadata-only spans** inside the request or worker trace that caused them: one `invoke_agent {agentId}` span per run and one `execute_tool {toolName}` span per tool call, with OpenTelemetry GenAI attributes (`gen_ai.*`).
- Spans go through the existing bridge `withTelemetrySpan` / `captureTelemetryTrace` (`@open-mercato/shared/lib/telemetry/runtime`). ai-assistant imports no `@opentelemetry/*` package and no `@open-mercato/telemetry` module.
- **No content, ever:** no prompts, completions, tool arguments or results (telemetry policy, S6). Content stays on the separate, three-lock AO export channel.
- Opt-in per deployment with `OM_AI_TELEMETRY_SPANS` (default `off`). Off, or telemetry off: zero overhead beyond one registry lookup.
- Phase 2 adds per-model-call `chat {model}` spans (needs a small additive manual-span capability on the telemetry runtime — Ask First) and low-cardinality GenAI histograms.

## Overview

The platform already exports HTTP, database and worker spans over OTLP. AI agent runs are invisible in those traces: a 20-second request that spent 19 seconds in two model calls and a tool shows one opaque server span. The AO replay exporter (OTel P1–P2) fills this gap for AO runs **after** completion, as separate traces. Operators debugging latency want the agent work **inside** the live trace, sampled together with the request, for every agent — chat, `run-object`, AO native runs — not only AO.

> **Market reference:** OpenLLMetry and OpenInference instrument LLM SDK calls live. The Vercel AI SDK has `experimental_telemetry` that emits `ai.*` spans through the global OTel tracer. Adopted: live spans with GenAI names and attributes, content off by default. Rejected as the primary mechanism: SDK monkey-patching (fragile across AI SDK majors) and turning on `experimental_telemetry` everywhere (see Alternatives).

## Problem Statement

1. `runAiAgentText` / `runAiAgentObject` (`packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts`) create no telemetry span; no call site passes `experimental_telemetry` (telemetry spec, "AI SDK call instrumentation").
2. The GenAI key constants live in enterprise (`packages/enterprise/src/modules/agent_orchestrator/lib/trace/genAiAttributes.ts`). OSS code cannot import them.
3. The telemetry facade only has callback spans (`withSpan(name, fn, options)`); there is no start/end API with which to open a span in `onModelCallStart` and close it in `onModelCallEnd` (§6 observer in `lib/agent-call-contract.ts`). Per-model-call spans therefore need either a wrapping point or a facade addition.
4. `runAiAgentText` returns a streaming `Response`. A span that wraps only the function returns before the stream finishes, so its duration would be wrong.

## Proposed Solution

### Scope

- **In:** live run and tool spans for every ai-assistant agent run (chat, `run-object`, programmatic `runAiAgentObject`, and therefore AO native runs, which execute through `runAiAgentObject`); GenAI key constants moved to shared; per-model-call spans and histograms in Phase 2.
- **Non-goals:** content of any kind; OpenCode and externally ingested AO runs (they never run inside an OM process span — they stay replay-only); replacing the AO replay exporter; a new exporter or OTLP client; exporting persisted `ai_agent_runs` rows after the fact (OTEL-Q7 — possible later reuse of the AO mapper, not here); browser-side spans.

### Shared GenAI key constants (Phase 1)

- New `packages/shared/src/lib/ai/gen-ai-attributes.ts` holding the key strings, operation names and semconv pin (`GEN_AI_SEMCONV_VERSION = '1.43'`), moved verbatim from the AO file.
- AO `lib/trace/genAiAttributes.ts` keeps its exports by re-exporting the shared constants (no import-path change for AO callers; AO-only `OM_LLM_ATTRIBUTES`, zod schemas and capture enums stay in enterprise).

### Span shape

| Span | Name | Kind | Attributes (all optional when unknown) |
|---|---|---|---|
| Run | `invoke_agent {agentId}` | internal | `gen_ai.operation.name=invoke_agent`, `gen_ai.agent.id`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.output.type` (`text`/`json`), `gen_ai.usage.input_tokens`/`output_tokens` (summed), `om.agent.step_count`, `om.agent.channel` (`chat`/`run_object`/`programmatic`), `om.run.id` (the persisted `ai_agent_runs` id when recorded), `om.agent_run.id` (AO run id when supplied by the caller) |
| Tool | `execute_tool {toolName}` | internal | `gen_ai.operation.name=execute_tool`, `gen_ai.tool.name`, `gen_ai.tool.call.id`, `om.tool.is_mutation`, `om.tool.outcome` (`ok`/`error`/`denied`/`pending_approval`) |
| Model call (Phase 2) | `chat {model}` | client | `gen_ai.operation.name=chat`, request params from §6 `callSettings` (temperature, top_p, top_k, max_tokens, seed — never `providerOptions`), `gen_ai.response.finish_reasons`, `gen_ai.response.id`, usage incl. cache-read and reasoning tokens |

- Tenant and organization ids go on span attributes (`om.tenant_id`, `om.organization_id`), never on metric labels.
- Span names follow GenAI conventions (`{operation} {target}`), an approved exception to the facade's `module.entity.action` naming rule because backends render GenAI spans by that shape — confirm (Q2).
- All string attributes pass the facade redaction already applied at the provider boundary; ids are not content.

### Where spans are opened

- **Run span:** `runAiAgentObject` wraps its body in `withTelemetrySpan`. `runAiAgentText` opens the span around a promise that settles in the stream's `onFinish` / `onError` / abort, so the span covers the whole stream; the `Response` is returned immediately and the span stays open until the stream ends.
- **Tool span:** `adaptToolToAiSdk` (`lib/agent-tools.ts`) wraps the handler execution. Mutation tools that stop at `prepareMutation` record `pending_approval`; nothing else changes on the approval path.
- **Model-call span (Phase 2):** opened in `onModelCallStart` and closed in `onModelCallEnd` through a new optional `startSpan(name, options) → { setAttributes, end(error?) }` on `TelemetryRuntime`, exposed as `startTelemetrySpan` in shared runtime and degrading to a no-op handle. Additive to the telemetry contract, Ask First with the telemetry owners (Q1).

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `OM_AI_TELEMETRY_SPANS` | `off` | `on` emits the spans above when a telemetry backend is active. Parsed with `parseBooleanWithDefault`. |

Sampling follows the platform sampler (`TELEMETRY_SAMPLING_RATIO`): live spans are as complete as the trace they live in. The AO replay export remains the complete, unsampled record for AO runs.

### Alternatives considered

| Alternative | Why not (now) |
|---|---|
| AI SDK `experimental_telemetry` with `recordInputs: false` / `recordOutputs: false` at the model-factory chokepoint (telemetry spec S6) | Emits `ai.*` span names and attributes owned by the SDK, which drift across majors; needs the global OTel tracer, which only the OTLP provider installs; one more surface to keep content-free. Kept as Q3 (optional sub-flag) once Phase 1 exists. |
| Reuse the AO OTLP mapper/encoder for OSS chat runs | Replay of persisted rows, not live; enterprise code. OTEL-Q7 leaves an OSS replay exporter to a later spec if wanted. |
| Wrap each step via `prepareStep` | Runs before the call but has no end hook; it cannot time the call. |

## Architecture

```
request / worker span (platform telemetry, sampled)
  └─ invoke_agent {agentId}          ← ai-assistant runAiAgentText/Object
       ├─ chat {model}               ← Phase 2, observer start/end
       ├─ execute_tool {toolName}    ← adaptToolToAiSdk
       └─ chat {model}
AO native run: the AO runner already captures captureTelemetryTrace() into the manifest
(om.platform_trace.traceparent); the replay export links to this live trace.
```

- Packages: ai-assistant (instrumentation), shared (constants; Phase 2 `startTelemetrySpan`), telemetry (Phase 2 runtime implementation of `startSpan` in the OTLP provider and the noop provider). No new dependency.
- Fail-open: a throwing span call never fails a run; the facade already degrades to running `fn` untraced.

## Data Models

None. No tables, columns or migrations.

## API Contracts

No HTTP routes change. Contract additions (all additive):

- `@open-mercato/shared/lib/ai/gen-ai-attributes` — new export path.
- Phase 2: optional `TelemetryRuntime.startSpan` and `startTelemetrySpan` in `@open-mercato/shared/lib/telemetry/runtime`.
- Env var `OM_AI_TELEMETRY_SPANS` (mirrored into `apps/mercato/.env.example` and the create-app template).

## Implementation Plan

### Phase 1 — Run and tool spans

1. Move the GenAI key constants to `packages/shared/src/lib/ai/gen-ai-attributes.ts`; AO file re-exports them. Unit test that both paths expose identical values.
2. `lib/agent-telemetry.ts` in ai-assistant: `isAiTelemetrySpansEnabled()`, attribute builders (pure, unit-tested; no content keys by construction — a test asserts the allowed key set).
3. Run span in `runAiAgentObject` and stream-scoped run span in `runAiAgentText` (abort and error paths tested).
4. Tool span in `adaptToolToAiSdk` with the outcome mapping.
5. Docs: `apps/docs/docs/framework/ai-assistant/` "Live agent spans" page + a cross-link from the AO trace-export page; `.env.example` + `yarn template:sync`.

### Phase 2 — Model-call spans and metrics

1. Telemetry: optional `startSpan` on `TelemetryRuntime`, implemented by the OTLP provider (Ask First, telemetry owners), `startTelemetrySpan` helper in shared.
2. Observer-driven `chat {model}` spans; synthesized and caller-managed calls (`synthesized` / `callerManaged` flags) get `om.fidelity`.
3. Histograms `gen_ai.client.operation.duration` (s) and `gen_ai.client.token.usage` (`{token}`) with labels `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.token.type` only; added to the telemetry metric catalog (`packages/telemetry/README.md`) — adding a built-in metric is Ask First.

## Open Questions (autonomous defaults applied)

- **Q1** — Add an optional manual `startSpan` to the telemetry runtime for model-call spans? *Default: yes in Phase 2, behind telemetry-owner approval; Phase 1 does not need it.*
- **Q2** — Use GenAI span names (`invoke_agent {agentId}`) instead of the facade rule `module.entity.action`? *Default: yes; backends' GenAI views depend on it. Record the exception in `packages/telemetry/AGENTS.md`.*
- **Q3** — Offer AI SDK `experimental_telemetry` (content forced off) as an extra sub-flag? *Default: no for now; revisit after Phase 1.*
- **Q4** — Default of `OM_AI_TELEMETRY_SPANS`? *Default: `off` for one minor release, then consider `on` when a telemetry backend is configured.*

## Risks & Impact Review

| Scenario | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Content leaks into a span attribute (a prompt pasted into an id-like field) | High | Telemetry policy | Attribute builders accept a fixed key set (test-enforced); values are ids, model names, counts and enums only; provider-boundary redaction stays on | Low |
| Stream span never ends (client disconnect without abort signal) | Medium | Span accuracy | End on `onFinish`, `onError` and request abort; a safety timeout equal to the route's max duration ends the span with `om.span.truncated=true` | Low |
| Double counting in dashboards for AO native runs (live span plus AO replay export into the same backend) | Medium | Operations | AO `OM_AGENT_OTEL_EXPORT_MODE` (AO spec, Phase 3); replay runs carry a link to the live trace; docs explain filtering by `service.name` | Low |
| Overhead when telemetry is off | Low | Performance | Flag check first; facade returns `fn(NOOP_SPAN)` with no allocation | Negligible |
| Cardinality blow-up from model ids in metric labels (Phase 2) | Medium | Metrics backend | Model id is bounded by configured providers; tenant/user ids never labels | Low |
| Span name drift as GenAI conventions evolve | Low | Compatibility | Semconv pin shared with the AO exporter (`GEN_AI_SEMCONV_VERSION`) | Low |

## Integration Test Coverage

Spans are asserted against an in-memory telemetry runtime registered with `registerTelemetryRuntime` (unit/integration hybrid; no collector needed):

- `TC-AI-LIVE-SPANS-001` — `POST /api/ai_assistant/ai/run-object` with a scripted model: one `invoke_agent` span with model, provider, usage and `om.agent.channel=run_object`; no `gen_ai.input.messages` / `gen_ai.output.messages` / tool argument keys.
- `TC-AI-LIVE-SPANS-002` — chat turn (`POST /api/ai_assistant/ai/chat`) with a tool call: run span covers the stream; one `execute_tool` child span with `om.tool.outcome=ok`.
- `TC-AI-LIVE-SPANS-003` — mutation tool in `approval` mode: tool span `pending_approval`; `/tools/execute` mutation refusal produces no tool span.
- `TC-AI-LIVE-SPANS-004` — `OM_AI_TELEMETRY_SPANS=off` (or no backend): no spans recorded.
- Phase 2: `TC-AI-LIVE-SPANS-005` — one `chat {model}` span per step with request params and no `providerOptions`; histograms recorded with the allowed labels only.
- AO (in the AO spec): a native AO run's replay export carries a link to the live trace id.

## Final Compliance Report — 2026-11-13

- `packages/telemetry/AGENTS.md`: spans through `withTelemetrySpan` only; no OTel imports outside the provider; no PII/content; low-cardinality labels; new metrics and the `startSpan` contract are Ask First (Q1, Phase 2). Compliant by design; Q2 records the naming exception.
- `packages/ai-assistant/AGENTS.md`: instrumentation at the runtime and tool-adapter chokepoints; no change to tool or agent contracts.
- `BACKWARD_COMPATIBILITY.md`: additive only (new shared export path, optional runtime member, new env var); AO import path kept by re-export.
- Root `AGENTS.md`: OSS never imports enterprise (constants move to shared); env var mirrored to the template.

## Changelog

### 2026-11-13
- Initial specification, split out of the AO OTel trace-export spec's Phase 3 per OTEL-Q5 / OTEL-Q7. Verified against code: no ai-assistant call site emits spans or enables `experimental_telemetry`; GenAI keys live only in AO `lib/trace/genAiAttributes.ts`; the telemetry facade offers callback spans only (`withTelemetrySpan`), so per-model-call spans need an additive `startSpan` (Phase 2, Ask First); the AO manifest already records `om.platform_trace.traceparent` via `captureTelemetryTrace()` (`lib/trace/runManifestEntry.ts`).
