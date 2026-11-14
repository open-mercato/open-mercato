import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { APP_VERSION } from '@open-mercato/shared/lib/version'
import type { EnqueueOptions } from '@open-mercato/queue'
import type { OtelExportJobPayload } from '../../queue'
import type { OtelExportSettings } from '../../../data/validators'
import {
  isExportEnabledFor,
  readOtelExportSettings,
  resolveContentExportMode,
  resolveOtelExportDeployment,
  type OtelContentExportMode,
  type OtelExportContainer,
  type OtelExportDeploymentConfig,
  type OtelExportProtocol,
} from './exportSettings'
import {
  isOtelExportDestinationError,
  resolveOtelExportDestination,
  type OtelExportDestination,
  type OtelExportDestinationResult,
  type OtelExportDestinationScope,
} from './exportDestination'
import { recordOtelExportHealth } from './exportHealth'
import type { RunExportBundle } from './loadRunExportBundle'
import { loadRunExportContent, type RunExportContent } from './loadRunExportContent'
import { mapAgentRunToOtlp } from './mapAgentRunToOtlp'
import { encodeOtlpTraceRequest, type OtlpResourceSpansInput } from './otlpJson'
import type { OtlpExportResult, PostOtlpTracesInput } from './otlpHttpClient'
import { encodeOtlpRequestBody, type OtlpRequestBody } from './otlpRequestBody'

const logger = createLogger('agent_orchestrator').child({ component: 'otel-export-job' })

export const OTEL_EXPORT_MAX_ATTEMPTS = 5
export const OTEL_EXPORT_BACKOFF_BASE_MS = 5_000
export const OTEL_EXPORT_BACKOFF_MAX_MS = 5 * 60 * 1000
export const OTEL_EXPORT_RETRY_AFTER_MAX_MS = OTEL_EXPORT_BACKOFF_MAX_MS * 12
export const OTEL_EXPORT_MAX_REQUEST_BYTES = 4 * 1024 * 1024

export const OTEL_EXPORT_ERROR_CODES = {
  failed: 'agent_orchestrator.otel_export_failed',
  rejected: 'agent_orchestrator.otel_export_rejected',
  unexpected: 'agent_orchestrator.otel_export_unexpected_failure',
  enqueueFailed: 'agent_orchestrator.otel_export_enqueue_failed',
} as const

type EnvLike = Record<string, string | undefined>

type EnqueueOtelExport = (payload: OtelExportJobPayload, options?: EnqueueOptions) => Promise<unknown>

/** Exponential backoff for a failed attempt (0-based): 5 s, 10 s, 20 s, … capped at 5 min. */
export function otelExportBackoffMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(attempt, 20))
  return Math.min(OTEL_EXPORT_BACKOFF_MAX_MS, OTEL_EXPORT_BACKOFF_BASE_MS * 2 ** exponent)
}

/** Delay before the next attempt: the backend's Retry-After (capped at 1 h) or the backoff, whichever is longer. */
export function otelExportRetryDelayMs(attempt: number, retryAfterMs: number | null | undefined): number {
  const requested = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs) : 0
  return Math.max(Math.min(requested, OTEL_EXPORT_RETRY_AFTER_MAX_MS), otelExportBackoffMs(attempt))
}

/**
 * `deployment.environment.name` (or the legacy `deployment.environment`) from
 * the W3C `OTEL_RESOURCE_ATTRIBUTES` list; `null` when absent.
 */
export function readDeploymentEnvironment(env: EnvLike = process.env): string | null {
  const raw = env.OTEL_RESOURCE_ATTRIBUTES
  if (typeof raw !== 'string') return null
  let legacy: string | null = null
  for (const pair of raw.split(',')) {
    const separator = pair.indexOf('=')
    if (separator <= 0) continue
    const key = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()
    if (value === '') continue
    if (key === 'deployment.environment.name') return value
    if (key === 'deployment.environment') legacy = value
  }
  return legacy
}

function withSpans(chunk: OtlpResourceSpansInput, spans: OtlpResourceSpansInput['scopeSpans'][number]['spans']): OtlpResourceSpansInput {
  const [scopeSpans] = chunk.scopeSpans
  return { resource: chunk.resource, scopeSpans: [{ ...scopeSpans, spans }] }
}

function splitChunkByBytes<TBody extends { byteLength: number }>(
  chunk: OtlpResourceSpansInput,
  maxBytes: number,
  encode: (chunk: OtlpResourceSpansInput) => TBody,
  bodies: TBody[],
): void {
  const body = encode(chunk)
  const spans = chunk.scopeSpans.length === 1 ? chunk.scopeSpans[0].spans : null
  if (body.byteLength <= maxBytes || !spans || spans.length <= 1) {
    bodies.push(body)
    return
  }
  const middle = Math.ceil(spans.length / 2)
  splitChunkByBytes(withSpans(chunk, spans.slice(0, middle)), maxBytes, encode, bodies)
  splitChunkByBytes(withSpans(chunk, spans.slice(middle)), maxBytes, encode, bodies)
}

/**
 * OTLP request bodies for the mapped chunks in the wire protocol (OTLP/JSON
 * text or OTLP/protobuf bytes), each at most `maxBytes` uncompressed: a chunk
 * over the limit is halved by spans until it fits (a single span is sent as
 * is), on top of the span-count chunking of the mapper.
 */
export function encodeOtlpRequests(
  chunks: readonly OtlpResourceSpansInput[],
  protocol: OtelExportProtocol,
  maxBytes: number = OTEL_EXPORT_MAX_REQUEST_BYTES,
): OtlpRequestBody[] {
  const bodies: OtlpRequestBody[] = []
  for (const chunk of chunks) splitChunkByBytes(chunk, maxBytes, (entry) => encodeOtlpRequestBody(entry, protocol), bodies)
  return bodies
}

/** OTLP/JSON request bodies for the mapped chunks; see {@link encodeOtlpRequests}. */
export function encodeOtlpRequestBodies(
  chunks: readonly OtlpResourceSpansInput[],
  maxBytes: number = OTEL_EXPORT_MAX_REQUEST_BYTES,
): string[] {
  const bodies: Array<{ body: string; byteLength: number }> = []
  const encode = (chunk: OtlpResourceSpansInput) => {
    const body = JSON.stringify(encodeOtlpTraceRequest(chunk))
    return { body, byteLength: Buffer.byteLength(body, 'utf8') }
  }
  for (const chunk of chunks) splitChunkByBytes(chunk, maxBytes, encode, bodies)
  return bodies.map((entry) => entry.body)
}

function reportExportError(error: unknown, code: string, attributes: Record<string, string | number | undefined>): void {
  getTelemetryRuntime()?.reportError(error, { module: 'agent_orchestrator', code, attributes })
}

function readRunEventPayload(payload: unknown): { runId: string; tenantId: string; agentId: string | null } | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id === '') return null
  if (typeof record.tenantId !== 'string' || record.tenantId === '') return null
  return {
    runId: record.id,
    tenantId: record.tenantId,
    agentId: typeof record.agentId === 'string' ? record.agentId : null,
  }
}

export type EnqueueOtelExportForRunEventDeps = {
  enqueue: EnqueueOtelExport
  env?: EnvLike
}

async function readRunEventGate(
  payload: unknown,
  container: OtelExportContainer,
  env: EnvLike,
): Promise<{ runId: string; tenantId: string; delayMs: number } | null> {
  try {
    const deployment = resolveOtelExportDeployment(env)
    if (!deployment.enabled) return null
    const event = readRunEventPayload(payload)
    if (!event) return null
    const { settings } = await readOtelExportSettings(container, event.tenantId)
    if (!settings.enabled) return null
    if (event.agentId && settings.agentAllowlist && !settings.agentAllowlist.includes(event.agentId)) return null
    return { runId: event.runId, tenantId: event.tenantId, delayMs: deployment.delayMs }
  } catch (error) {
    logger.warn('otel export subscriber gate failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    reportExportError(error, OTEL_EXPORT_ERROR_CODES.enqueueFailed, {})
    return null
  }
}

async function enqueueBestEffort(
  job: OtelExportJobPayload,
  delayMs: number,
  tenantId: string,
  enqueue: EnqueueOtelExport,
): Promise<boolean> {
  try {
    await enqueue(job, { delayMs })
    return true
  } catch (error) {
    logger.warn('otel export enqueue failed', {
      runId: job.runId,
      error: error instanceof Error ? error.message : String(error),
    })
    reportExportError(error, OTEL_EXPORT_ERROR_CODES.enqueueFailed, { runId: job.runId, tenantId })
    return false
  }
}

/**
 * Subscriber gate for `run.completed` / `run.ingested`: deployment switch
 * (env only) → tenant settings (+ agent allowlist when the event names the
 * agent) → enqueue `{ runId, attempt: 0 }` delayed by the deployment delay.
 * The run source is only on the row, so the worker re-checks the full gate.
 * Best-effort: a failed enqueue is reported, never rethrown, so the event's
 * other persistent subscribers are not re-run; every other failure is swallowed.
 */
export async function enqueueOtelExportForRunEvent(
  payload: unknown,
  container: OtelExportContainer,
  deps: EnqueueOtelExportForRunEventDeps,
): Promise<boolean> {
  const gate = await readRunEventGate(payload, container, deps.env ?? process.env)
  if (!gate) return false
  return enqueueBestEffort({ runId: gate.runId, attempt: 0 }, gate.delayMs, gate.tenantId, deps.enqueue)
}

export type FinishedProcessScope = {
  tenantId: string
  organizationId: string
  workflowInstanceId: string
}

export type ExportableTopLevelRunFilter = FinishedProcessScope & {
  sources: string[]
  agentAllowlist: string[] | null
}

export type EnqueueOtelExportForFinishedProcessDeps = EnqueueOtelExportForRunEventDeps & {
  findLatestTopLevelRunId: (filter: ExportableTopLevelRunFilter) => Promise<string | null>
}

function readFinishedProcessScope(payload: unknown): FinishedProcessScope | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const { tenantId, organizationId, workflowInstanceId } = record
  if (typeof tenantId !== 'string' || tenantId === '') return null
  if (typeof organizationId !== 'string' || organizationId === '') return null
  if (typeof workflowInstanceId !== 'string' || workflowInstanceId === '') return null
  return { tenantId, organizationId, workflowInstanceId }
}

/**
 * Re-export trigger for a process that reached a terminal status. The
 * `invoke_workflow` root is only emitted once the process is terminal, and a
 * process can finish after its last run was exported, so this enqueues ONE
 * top-level run of the execution (the latest exportable one, tenant and
 * organization scoped) whose re-export now carries the root. Ids are
 * deterministic, so the repeated run spans merge. No exportable run → no-op.
 * Best-effort like {@link enqueueOtelExportForRunEvent}; the worker re-checks the gate.
 */
export async function enqueueOtelExportForFinishedProcess(
  payload: unknown,
  container: OtelExportContainer,
  deps: EnqueueOtelExportForFinishedProcessDeps,
): Promise<boolean> {
  let target: { runId: string; tenantId: string; delayMs: number } | null = null
  try {
    const deployment = resolveOtelExportDeployment(deps.env ?? process.env)
    if (!deployment.enabled) return false
    const scope = readFinishedProcessScope(payload)
    if (!scope) return false
    const { settings } = await readOtelExportSettings(container, scope.tenantId)
    if (!settings.enabled) return false
    const runId = await deps.findLatestTopLevelRunId({
      ...scope,
      sources: deployment.sources,
      agentAllowlist: settings.agentAllowlist ?? null,
    })
    if (!runId) return false
    target = { runId, tenantId: scope.tenantId, delayMs: deployment.delayMs }
  } catch (error) {
    logger.warn('otel export finished-process gate failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    reportExportError(error, OTEL_EXPORT_ERROR_CODES.enqueueFailed, {})
    return false
  }
  return enqueueBestEffort({ runId: target.runId, attempt: 0 }, target.delayMs, target.tenantId, deps.enqueue)
}

export type OtelExportJobOutcome =
  | 'disabled'
  | 'invalid_payload'
  | 'missing_run'
  | 'not_enabled'
  | 'exported'
  | 'retry_scheduled'
  | 'failed'
  | 'rejected'
  | 'destination_unavailable'
  | 'error'

export type LoadOtelExportContent = (bundle: RunExportBundle, mode: OtelContentExportMode) => Promise<RunExportContent>

export type ResolveOtelExportJobDestination = (input: {
  deployment: OtelExportDeploymentConfig
  settings: OtelExportSettings
  scope: OtelExportDestinationScope
}) => Promise<OtelExportDestinationResult>

export type ProcessOtelExportJobDeps = {
  container: AwilixContainer
  loadBundle: (runId: string) => Promise<RunExportBundle | null>
  post: (input: PostOtlpTracesInput) => Promise<OtlpExportResult>
  enqueue: EnqueueOtelExport
  loadContent?: LoadOtelExportContent
  resolveDestination?: ResolveOtelExportJobDestination
  env?: EnvLike
}

function readJobPayload(payload: unknown): OtelExportJobPayload | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (typeof record.runId !== 'string' || record.runId === '') return null
  const attempt =
    typeof record.attempt === 'number' && Number.isSafeInteger(record.attempt) && record.attempt >= 0
      ? record.attempt
      : 0
  return { runId: record.runId, attempt }
}

async function postAllChunks(
  bundle: RunExportBundle,
  content: RunExportContent | null,
  deployment: OtelExportDeploymentConfig,
  destination: OtelExportDestination,
  exportUserIds: boolean,
  env: EnvLike,
  post: ProcessOtelExportJobDeps['post'],
): Promise<OtlpExportResult | null> {
  const chunks = mapAgentRunToOtlp({ ...bundle, content: content ?? undefined }, {
    exportUserIds,
    serviceName: deployment.serviceName,
    serviceVersion: APP_VERSION,
    environment: readDeploymentEnvironment(env),
    scopeVersion: APP_VERSION,
  })
  for (const request of encodeOtlpRequests(chunks, destination.protocol)) {
    const result = await post({
      endpoint: destination.endpoint,
      headers: destination.headers,
      body: request.body,
      contentType: request.contentType,
      ...(destination.pinnedAddresses !== undefined ? { pinnedAddresses: destination.pinnedAddresses } : {}),
    })
    if (result.outcome !== 'ok') return result
  }
  return null
}

async function handleUnexpectedJobFailure(
  error: unknown,
  job: OtelExportJobPayload,
  tenantId: string | null,
  deps: ProcessOtelExportJobDeps,
): Promise<OtelExportJobOutcome> {
  const attributes = { runId: job.runId, tenantId: tenantId ?? undefined, attempt: job.attempt }
  logger.warn('otel export job failed unexpectedly', {
    ...attributes,
    error: error instanceof Error ? error.message : String(error),
  })
  if (job.attempt + 1 < OTEL_EXPORT_MAX_ATTEMPTS) {
    try {
      await deps.enqueue({ runId: job.runId, attempt: job.attempt + 1 }, { delayMs: otelExportBackoffMs(job.attempt) })
      return 'retry_scheduled'
    } catch (enqueueError) {
      reportExportError(enqueueError, OTEL_EXPORT_ERROR_CODES.enqueueFailed, attributes)
    }
  }
  reportExportError(error, OTEL_EXPORT_ERROR_CODES.unexpected, attributes)
  if (job.attempt + 1 >= OTEL_EXPORT_MAX_ATTEMPTS) {
    reportExportError(new Error('[internal] otel export failed'), OTEL_EXPORT_ERROR_CODES.failed, attributes)
  }
  if (tenantId) {
    try {
      await recordOtelExportHealth(deps.container, tenantId, { outcome: 'error', errorCode: 'unexpected' })
    } catch (healthError) {
      logger.warn('could not record the otel export health', {
        runId: job.runId,
        error: healthError instanceof Error ? healthError.message : String(healthError),
      })
    }
  }
  return 'error'
}

/**
 * One OTel export job. Only `runId` is trusted from the payload: the run row
 * gives the tenant, agent and source, and the tenant settings are re-read here
 * so a revoked opt-in stops queued jobs. The destination is resolved per run
 * for the run's organization ({@link resolveOtelExportDestination}): the
 * deployment endpoint or the organization's vetted, pinned integration
 * endpoint; an unavailable destination is recorded as the tenant's export
 * health and reported, never retried, and never falls back to the deployment
 * endpoint. Content (prompts, completions, tool
 * arguments/results) is loaded and attached only when all three locks hold for
 * this job — deployment allow-switch, tenant `content: 'full'` and the run's
 * captured level `full` — and each request body, encoded in the destination's
 * protocol (`http/json` or `http/protobuf`), stays within
 * {@link OTEL_EXPORT_MAX_REQUEST_BYTES} uncompressed. Expected failures never throw (the
 * queue's own retry would duplicate the backoff): `retry` and unexpected
 * failures (loader, settings, DB, queue) re-enqueue with `attempt + 1`
 * (Retry-After honored up to 1 h, max 5 attempts), `drop` is reported.
 */
export async function processOtelExportJob(
  payload: unknown,
  deps: ProcessOtelExportJobDeps,
): Promise<OtelExportJobOutcome> {
  const env = deps.env ?? process.env
  const deployment = resolveOtelExportDeployment(env)
  if (!deployment.enabled) return 'disabled'
  const job = readJobPayload(payload)
  if (!job) return 'invalid_payload'

  let tenantId: string | null = null
  try {
    const bundle = await deps.loadBundle(job.runId)
    if (!bundle) return 'missing_run'
    tenantId = bundle.run.tenantId
    const { settings } = await readOtelExportSettings(deps.container, tenantId)
    const enabled = isExportEnabledFor({
      deployment,
      tenant: settings,
      agentId: bundle.run.agentId,
      runSource: bundle.run.source,
    })
    if (!enabled) return 'not_enabled'

    const resolveDestination: ResolveOtelExportJobDestination =
      deps.resolveDestination ??
      ((input) => resolveOtelExportDestination(deps.container, input.deployment, input.settings, input.scope, { env }))
    const destination = await resolveDestination({
      deployment,
      settings,
      scope: { tenantId, organizationId: bundle.run.organizationId },
    })
    if (isOtelExportDestinationError(destination)) {
      const attributes = { tenantId, runId: job.runId, attempt: job.attempt, errorCode: destination.error }
      logger.warn('otel export destination unavailable', attributes)
      reportExportError(new Error('[internal] otel export destination unavailable'), OTEL_EXPORT_ERROR_CODES.rejected, attributes)
      await recordOtelExportHealth(deps.container, tenantId, { outcome: 'error', errorCode: destination.error })
      return 'destination_unavailable'
    }

    const mode = resolveContentExportMode({ deployment, tenant: settings, runCapture: bundle.manifest?.['om.capture'] })
    const loadContent: LoadOtelExportContent =
      deps.loadContent ?? ((target, contentMode) => loadRunExportContent(deps.container, target, { mode: contentMode }))
    const content = mode === 'full' ? await loadContent(bundle, mode) : null
    const failure = await postAllChunks(bundle, content, deployment, destination, settings.exportUserIds, env, deps.post)
    if (!failure) {
      await recordOtelExportHealth(deps.container, tenantId, { outcome: 'success' })
      return 'exported'
    }

    const errorCode = failure.errorCode ?? (failure.httpStatus ? `http_${failure.httpStatus}` : 'unknown')
    const attributes = { tenantId, runId: job.runId, attempt: job.attempt, httpStatus: failure.httpStatus ?? undefined, errorCode }
    if (failure.outcome === 'retry' && job.attempt + 1 < OTEL_EXPORT_MAX_ATTEMPTS) {
      const delayMs = otelExportRetryDelayMs(job.attempt, failure.retryAfterMs)
      await deps.enqueue({ runId: job.runId, attempt: job.attempt + 1 }, { delayMs })
      return 'retry_scheduled'
    }
    const code = failure.outcome === 'retry' ? OTEL_EXPORT_ERROR_CODES.failed : OTEL_EXPORT_ERROR_CODES.rejected
    logger.warn('otel export gave up', attributes)
    reportExportError(new Error(`[internal] otel export ${failure.outcome === 'retry' ? 'failed' : 'rejected'}`), code, attributes)
    await recordOtelExportHealth(deps.container, tenantId, { outcome: 'error', errorCode })
    return failure.outcome === 'retry' ? 'failed' : 'rejected'
  } catch (error) {
    return handleUnexpectedJobFailure(error, job, tenantId, deps)
  }
}
