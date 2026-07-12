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
import { ARTIFACT_REFS, type ArtifactEncryptionRef, type ArtifactOffloader } from './artifactStore'
import { computeCostMinor } from '../runtime/modelPricing'

export type IngestScope = { tenantId: string; organizationId: string }

export type IngestTraceOptions = {
  /**
   * When supplied, payloads exceeding the inline cap are offloaded to encrypted
   * storage and the returned key is stamped on the row's artifact-key column
   * (F1). Absent (unit tests, storage-less callers) → capped inline only,
   * exactly as before. Injected rather than resolved here so `ingestTrace` stays
   * pure over the EntityManager.
   */
  offloadArtifact?: ArtifactOffloader
}

export type IngestTraceResult = {
  runId: string
  created: boolean
  spansAppended: number
  toolCallsAppended: number
}

/**
 * Inline-summary size cap. Payloads at or below this serialized length are
 * stored verbatim on the row; larger ones are truncated to a redacted preview
 * and (when an offloader is supplied — F1) offloaded in full to encrypted
 * storage with the key stamped on the row's artifact-key column. Attribute /
 * context payloads with no artifact-key column stay capped inline only.
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
 * Cap a keyed payload inline, offloading the full value to encrypted storage
 * when it exceeds the cap and an offloader is available. Returns the inline
 * summary to persist plus the artifact key (or null when not offloaded).
 */
async function offloadOrCap(
  value: unknown,
  ref: ArtifactEncryptionRef,
  offload: ArtifactOffloader | undefined,
): Promise<{ summary: unknown; key: string | null }> {
  if (value === undefined || value === null) return { summary: value ?? null, key: null }
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    return { summary: { _unserializable: true }, key: null }
  }
  if (serialized.length <= SUMMARY_CHAR_LIMIT) return { summary: value, key: null }
  const key = offload ? await offload(ref, value) : null
  return {
    summary: { _truncated: true, offloaded: key != null, preview: serialized.slice(0, SUMMARY_CHAR_LIMIT) },
    key,
  }
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
  options: IngestTraceOptions = {},
): Promise<IngestTraceResult> {
  const payload: TraceIngest = traceIngestSchema.parse(rawPayload)
  const { tenantId, organizationId } = scope
  const offload = options.offloadArtifact

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
      // `agent_runs.input` is NOT NULL (the MVP runtime always supplies it). A
      // trace ingested from an external runtime may omit it, so fall back to an
      // empty object rather than inserting null and tripping a not-null violation.
      input: payload.input ?? {},
    })
    em.persist(run)
  }
  applyRunFields(run, payload)
  // Estimated cost, null-only (data-honesty spec §3.2): when the envelope (or a
  // prior ingest) supplied tokens + a model but no cost — the OpenCode/external
  // path — compute the estimate from the static pricing table. Never overwrite
  // a non-null cost (the native runner stamps it at completion).
  if (run.costMinor == null && run.model && (run.inputTokens != null || run.outputTokens != null)) {
    const cost = computeCostMinor(run.model, run.inputTokens, run.outputTokens)
    if (cost) {
      run.costMinor = cost.costMinor
      run.currency = cost.currency
    }
  }
  if (payload.output !== undefined) {
    const { summary, key } = await offloadOrCap(payload.output, ARTIFACT_REFS.runOutput, offload)
    run.output = summary
    run.outputArtifactKey = key
  }
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
  // Forensic completion timestamp, null-only: the ingest envelope carries no
  // run-level end time, so derive it from the newest span end. Set only when
  // the run is terminal and `completed_at` is still null — never overwrite the
  // command-stamped value (it is the flag-proof "Finished" fact).
  if (!run.completedAt && run.status !== 'running') {
    let newestEnd: Date | null = null
    for (const span of spansByExternal.values()) {
      if (span.endedAt && (!newestEnd || span.endedAt > newestEnd)) newestEnd = span.endedAt
    }
    if (newestEnd) run.completedAt = newestEnd
  }

  let toolCallsAppended = 0
  for (const { span, payloadSpan } of freshSpans) {
    for (const toolCall of payloadSpan.toolCalls ?? []) {
      const request = await offloadOrCap(toolCall.requestSummary, ARTIFACT_REFS.toolRequest, offload)
      const response = await offloadOrCap(toolCall.responseSummary, ARTIFACT_REFS.toolResponse, offload)
      em.persist(
        em.create(AgentToolCall, {
          tenantId,
          organizationId,
          spanId: span.id,
          agentRunId: run.id,
          toolName: toolCall.toolName,
          requestSummary: request.summary,
          requestArtifactKey: request.key,
          responseSummary: response.summary,
          responseArtifactKey: response.key,
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
  // `output` is handled asynchronously in `ingestTrace` (offload path); see below.
  run.updatedAt = new Date()
}
