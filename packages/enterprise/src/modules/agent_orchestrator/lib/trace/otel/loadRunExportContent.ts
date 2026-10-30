import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { AgentSpan } from '../../../data/entities'
import { ARTIFACT_REFS, readArtifact, type ArtifactEncryptionRef, type ArtifactScope } from '../artifactStore'
import { readTraceCapturePolicy } from '../capturePolicy'
import { isTraceContentKeyExpired, recordTraceContentAccess } from '../contentArtifactAccess'
import { OM_LLM_ATTRIBUTES } from '../genAiAttributes'
import type { OtelContentExportMode } from './exportSettings'
import { indexToolCallContent, type ToolCallContent } from './genAiContent'
import type { RunExportBundle, RunExportSpan } from './loadRunExportBundle'
import type { OtelContentExportStatus } from './otelAttributes'

const logger = createLogger('agent_orchestrator').child({ component: 'otel-export-content' })

export const OTEL_CONTENT_RUN_MAX_BYTES = 4 * 1024 * 1024
export const OTEL_CONTENT_READ_CONCURRENCY = 4
export const OTEL_CONTENT_ACCESS_KINDS = {
  llmRequest: 'otel_export:llm_request',
  llmResponse: 'otel_export:llm_response',
} as const

export type LlmSpanExportContent = {
  request?: unknown
  response?: unknown
  status: OtelContentExportStatus
}

export type RunExportContent = {
  bySpanId: Map<string, LlmSpanExportContent>
  toolCalls: Map<string, ToolCallContent>
}

export type RunExportContentContainer = { resolve<T = unknown>(name: string): T }

export type LoadRunExportContentOptions = {
  mode: OtelContentExportMode
  retentionDays?: number
  now?: Date
  maxBytes?: number
}

type ContentSide = 'request' | 'response'

type ReadTask = {
  spanId: string
  side: ContentSide
  key: string
  ref: ArtifactEncryptionRef
  accessKind: string
}

type ReadOutcome =
  | { status: 'ok'; value: unknown }
  | { status: Exclude<OtelContentExportStatus, 'exported' | 'not_captured'> }

const FAILURE_PRECEDENCE: ReadonlyArray<OtelContentExportStatus> = ['unavailable', 'over_budget', 'expired']

function emptyContent(): RunExportContent {
  return { bySpanId: new Map(), toolCalls: new Map() }
}

function readKey(attributes: Record<string, unknown> | null, name: string): string | null {
  const value = attributes?.[name]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

type OwnedContentKeys = { requestKey: string | null; responseKey: string | null }

function toAttributeRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

async function loadOwnedContentKeys(
  container: RunExportContentContainer,
  scope: ArtifactScope,
  runId: string,
): Promise<Map<string, OwnedContentKeys>> {
  const em = container.resolve<EntityManager>('em').fork()
  const rows = await findWithDecryption(em, AgentSpan, { agentRunId: runId, ...scope, kind: 'llm' }, undefined, scope)
  const owned = new Map<string, OwnedContentKeys>()
  for (const row of rows) {
    const attributes = toAttributeRecord(row.attributes)
    owned.set(row.id, {
      requestKey: readKey(attributes, OM_LLM_ATTRIBUTES.contentRequestKey),
      responseKey: readKey(attributes, OM_LLM_ATTRIBUTES.contentResponseKey),
    })
  }
  return owned
}

function ownedKey(spanKey: string | null, owned: string | null | undefined): string | null {
  return spanKey !== null && spanKey === owned ? spanKey : null
}

function collectReadTasks(
  spans: ReadonlyArray<RunExportSpan>,
  owned: ReadonlyMap<string, OwnedContentKeys>,
): ReadTask[] {
  const tasks: ReadTask[] = []
  for (const span of spans) {
    const ownedKeys = owned.get(span.id)
    if (!ownedKeys) continue
    const requestKey = ownedKey(readKey(span.attributes, OM_LLM_ATTRIBUTES.contentRequestKey), ownedKeys.requestKey)
    const responseKey = ownedKey(readKey(span.attributes, OM_LLM_ATTRIBUTES.contentResponseKey), ownedKeys.responseKey)
    if (requestKey) {
      tasks.push({
        spanId: span.id,
        side: 'request',
        key: requestKey,
        ref: ARTIFACT_REFS.llmRequest,
        accessKind: OTEL_CONTENT_ACCESS_KINDS.llmRequest,
      })
    }
    if (responseKey) {
      tasks.push({
        spanId: span.id,
        side: 'response',
        key: responseKey,
        ref: ARTIFACT_REFS.llmResponse,
        accessKind: OTEL_CONTENT_ACCESS_KINDS.llmResponse,
      })
    }
  }
  return tasks
}

function measureBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null) ?? 'null', 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

async function runPool<T, R>(items: ReadonlyArray<T>, limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(lanes)
  return results
}

async function resolveRetentionDays(
  container: RunExportContentContainer,
  tenantId: string,
  override: number | undefined,
): Promise<number> {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) return override
  const { policy } = await readTraceCapturePolicy(container as Parameters<typeof readTraceCapturePolicy>[0], tenantId)
  return policy.retentionDays
}

function summarizeStatus(outcomes: ReadonlyArray<ReadOutcome>): OtelContentExportStatus {
  if (outcomes.length === 0) return 'not_captured'
  for (const status of FAILURE_PRECEDENCE) {
    if (outcomes.some((outcome) => outcome.status === status)) return status
  }
  return 'exported'
}

/**
 * Loads the decrypted LLM request/response content artifacts of one run for
 * the OTel export. Reads happen only when the resolved content mode is `full`
 * and only for an `om.content.request.key` / `.response.key` that a stored
 * `llm` span row of this run references (the artifact route's ownership rule),
 * in the run's tenant/org storage scope. A key past the tenant's
 * retention window is `expired` without a read; a missing object is `expired`;
 * a storage failure is `unavailable`; content past the per-run byte budget is
 * `over_budget`. Every successful read is access-logged as an `otel_export:*`
 * read with no actor. Never throws.
 */
export async function loadRunExportContent(
  container: RunExportContentContainer,
  bundle: Pick<RunExportBundle, 'run' | 'spans'>,
  options: LoadRunExportContentOptions,
): Promise<RunExportContent> {
  if (options.mode !== 'full') return emptyContent()
  const { run } = bundle
  const scope: ArtifactScope = { tenantId: run.tenantId, organizationId: run.organizationId }
  const llmSpans = bundle.spans.filter((span) => span.kind === 'llm')
  try {
    const hasKeys = llmSpans.some(
      (span) =>
        readKey(span.attributes, OM_LLM_ATTRIBUTES.contentRequestKey) !== null ||
        readKey(span.attributes, OM_LLM_ATTRIBUTES.contentResponseKey) !== null,
    )
    const owned = hasKeys ? await loadOwnedContentKeys(container, scope, run.id) : new Map<string, OwnedContentKeys>()
    const tasks = collectReadTasks(llmSpans, owned)
    const retentionDays = tasks.length > 0 ? await resolveRetentionDays(container, run.tenantId, options.retentionDays) : 0
    const now = options.now ?? new Date()
    const maxBytes = options.maxBytes ?? OTEL_CONTENT_RUN_MAX_BYTES
    let consumedBytes = 0

    const outcomes = await runPool(tasks, OTEL_CONTENT_READ_CONCURRENCY, async (task): Promise<ReadOutcome> => {
      if (isTraceContentKeyExpired(task.key, retentionDays, now)) return { status: 'expired' }
      if (consumedBytes >= maxBytes) return { status: 'over_budget' }
      const result = await readArtifact(container, scope, task.ref, task.key)
      if (result.status === 'missing') return { status: 'expired' }
      if (result.status === 'unavailable') return { status: 'unavailable' }
      await recordTraceContentAccess(container, {
        ...scope,
        actorUserId: null,
        apiKeyId: null,
        runId: run.id,
        kind: task.accessKind,
        key: task.key,
      })
      const size = measureBytes(result.value)
      if (consumedBytes + size > maxBytes) return { status: 'over_budget' }
      consumedBytes += size
      return { status: 'ok', value: result.value }
    })

    const outcomesBySpan = new Map<string, ReadOutcome[]>()
    const content = emptyContent()
    const requests: unknown[] = []
    const responses: unknown[] = []
    tasks.forEach((task, index) => {
      const outcome = outcomes[index]
      const spanOutcomes = outcomesBySpan.get(task.spanId) ?? []
      spanOutcomes.push(outcome)
      outcomesBySpan.set(task.spanId, spanOutcomes)
      const entry = content.bySpanId.get(task.spanId) ?? { status: 'not_captured' }
      if (outcome.status === 'ok') {
        entry[task.side] = outcome.value
        if (task.side === 'request') requests.push(outcome.value)
        else responses.push(outcome.value)
      }
      content.bySpanId.set(task.spanId, entry)
    })
    for (const span of llmSpans) {
      const entry = content.bySpanId.get(span.id) ?? { status: 'not_captured' }
      entry.status = summarizeStatus(outcomesBySpan.get(span.id) ?? [])
      content.bySpanId.set(span.id, entry)
    }
    content.toolCalls = indexToolCallContent(requests, responses)
    return content
  } catch (error) {
    logger.warn('otel export content load failed; exporting without content', { runId: run.id, err: error })
    getTelemetryRuntime()?.reportError(error, {
      module: 'agent_orchestrator',
      code: 'agent_orchestrator.otel_export_content_failed',
      attributes: { runId: run.id },
    })
    const fallback = emptyContent()
    for (const span of llmSpans) fallback.bySpanId.set(span.id, { status: 'unavailable' })
    return fallback
  }
}
