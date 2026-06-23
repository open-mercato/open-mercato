import type { EntityManager } from '@mikro-orm/postgresql'
import {
  AgentRun,
  AgentSpan,
  AgentToolCall,
  type AgentRunStatus,
  type AgentSpanKind,
  type AgentSpanStatus,
  type AgentToolCallStatus,
} from '../../data/entities'
import { traceIngestSchema, type TraceIngest, type TraceSpanIngest } from '../../data/validators'

export type IngestScope = { tenantId: string; organizationId: string }

export type IngestTraceResult = {
  runId: string
  created: boolean
  spansAppended: number
  toolCallsAppended: number
}

/**
 * Inline-summary size cap. Until the encrypted storage-s3 offload step lands
 * (separate PR1 follow-up), large request/response/attribute payloads are stored
 * capped on the row rather than offloaded by key. This mirrors how the shipped
 * MVP already persists full `input`/`output` jsonb on `agent_runs`.
 */
const SUMMARY_CHAR_LIMIT = 4000

function capSummary(value: unknown): unknown {
  if (value === undefined || value === null) return value ?? null
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    return { _unserializable: true }
  }
  if (serialized.length <= SUMMARY_CHAR_LIMIT) return value
  return { _truncated: true, preview: serialized.slice(0, SUMMARY_CHAR_LIMIT) }
}

/**
 * Upsert one agent run and append its spans/tool-calls. Idempotent on
 * `(runtime, externalRunId)` within the tenant: re-ingesting the same trace
 * updates run-level fields but appends each span/tool-call exactly once (spans
 * dedupe on `(agentRunId, externalSpanId)`; a span's tool-calls are written only
 * when that span is first created). Out-of-order spans are tolerated — parents
 * are linked by `externalSpanId` after all spans for the run are persisted.
 *
 * Tenant/org scope is supplied by the verified caller, never the payload.
 * Pure over the EntityManager (no command bus / request scope) so it is unit-
 * testable and reusable by the online eval path.
 */
export async function ingestTrace(
  em: EntityManager,
  scope: IngestScope,
  rawPayload: unknown,
): Promise<IngestTraceResult> {
  const payload: TraceIngest = traceIngestSchema.parse(rawPayload)
  const { tenantId, organizationId } = scope

  // 1. Upsert the run, then flush so its id is available and run-level scalar
  //    changes are committed before any subsequent find (avoids the MikroORM
  //    mutate→find→flush footgun).
  let run = await em.findOne(AgentRun, {
    tenantId,
    organizationId,
    runtime: payload.runtime,
    externalRunId: payload.externalRunId,
  })
  const created = !run
  if (!run) {
    run = em.create(AgentRun, {
      tenantId,
      organizationId,
      agentId: payload.agentId,
      runtime: payload.runtime,
      externalRunId: payload.externalRunId,
      status: (payload.status ?? 'running') as AgentRunStatus,
      input: payload.input ?? null,
    })
    em.persist(run)
  }
  applyRunFields(run, payload)
  await em.flush()

  // 2. Append new spans (dedupe by externalSpanId), flush to assign ids.
  const existingSpans = await em.find(AgentSpan, { agentRunId: run.id })
  const spansByExternal = new Map<string, AgentSpan>(existingSpans.map((s) => [s.externalSpanId, s]))
  const freshSpans: Array<{ span: AgentSpan; payloadSpan: TraceSpanIngest }> = []
  for (const spanPayload of payload.spans ?? []) {
    if (spansByExternal.has(spanPayload.externalSpanId)) continue
    const span = em.create(AgentSpan, {
      tenantId,
      organizationId,
      agentRunId: run.id,
      externalSpanId: spanPayload.externalSpanId,
      sequence: spanPayload.sequence,
      name: spanPayload.name,
      kind: spanPayload.kind as AgentSpanKind,
      startedAt: new Date(spanPayload.startedAt),
      endedAt: spanPayload.endedAt ? new Date(spanPayload.endedAt) : null,
      durationMs: spanPayload.durationMs ?? null,
      status: (spanPayload.status ?? 'ok') as AgentSpanStatus,
      attributes: capSummary(spanPayload.attributes),
    })
    em.persist(span)
    spansByExternal.set(spanPayload.externalSpanId, span)
    freshSpans.push({ span, payloadSpan: spanPayload })
  }
  await em.flush()

  // 3. Resolve parent links for every span in the payload (old + new) now that
  //    all are persisted, then append tool-calls for freshly-created spans only.
  for (const spanPayload of payload.spans ?? []) {
    if (!spanPayload.parentExternalSpanId) continue
    const span = spansByExternal.get(spanPayload.externalSpanId)
    const parent = spansByExternal.get(spanPayload.parentExternalSpanId)
    if (span && parent && span.parentSpanId !== parent.id) span.parentSpanId = parent.id
  }
  let toolCallsAppended = 0
  for (const { span, payloadSpan } of freshSpans) {
    for (const toolCall of payloadSpan.toolCalls ?? []) {
      em.persist(
        em.create(AgentToolCall, {
          tenantId,
          organizationId,
          spanId: span.id,
          agentRunId: run.id,
          toolName: toolCall.toolName,
          requestSummary: capSummary(toolCall.requestSummary),
          responseSummary: capSummary(toolCall.responseSummary),
          status: (toolCall.status ?? 'ok') as AgentToolCallStatus,
          latencyMs: toolCall.latencyMs ?? null,
          errorMessage: toolCall.errorMessage ?? null,
        }),
      )
      toolCallsAppended += 1
    }
  }
  await em.flush()

  return { runId: run.id, created, spansAppended: freshSpans.length, toolCallsAppended }
}

function applyRunFields(run: AgentRun, payload: TraceIngest): void {
  if (payload.status) run.status = payload.status as AgentRunStatus
  if (payload.agentVersion !== undefined) run.agentVersion = payload.agentVersion
  if (payload.model !== undefined) run.model = payload.model
  if (payload.processId !== undefined) run.processId = payload.processId ?? null
  if (payload.stepId !== undefined) run.stepId = payload.stepId ?? null
  if (payload.proposalId !== undefined) run.proposalId = payload.proposalId ?? null
  if (payload.confidence !== undefined) run.confidence = payload.confidence
  if (payload.inputTokens !== undefined) run.inputTokens = payload.inputTokens
  if (payload.outputTokens !== undefined) run.outputTokens = payload.outputTokens
  if (payload.costMinor !== undefined) run.costMinor = payload.costMinor
  if (payload.currency !== undefined) run.currency = payload.currency
  if (payload.latencyMs !== undefined) run.latencyMs = payload.latencyMs
  if (payload.contextRouting !== undefined) run.contextRouting = capSummary(payload.contextRouting)
  if (payload.output !== undefined) run.output = capSummary(payload.output)
  run.updatedAt = new Date()
}
