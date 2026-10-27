import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { APP_VERSION } from '@open-mercato/shared/lib/version'
import type { EnqueueOptions } from '@open-mercato/queue'
import type { OtelExportJobPayload } from '../../queue'
import {
  isExportEnabledFor,
  readOtelExportSettings,
  resolveOtelExportDeployment,
  type OtelExportContainer,
} from './exportSettings'
import { recordOtelExportHealth } from './exportHealth'
import type { RunExportBundle } from './loadRunExportBundle'
import { mapAgentRunToOtlp } from './mapAgentRunToOtlp'
import { encodeOtlpTraceRequest } from './otlpJson'
import type { OtlpExportResult, PostOtlpTracesInput } from './otlpHttpClient'

const logger = createLogger('agent_orchestrator').child({ component: 'otel-export-job' })

export const OTEL_EXPORT_MAX_ATTEMPTS = 5
export const OTEL_EXPORT_BACKOFF_BASE_MS = 5_000
export const OTEL_EXPORT_BACKOFF_MAX_MS = 5 * 60 * 1000

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

/**
 * Subscriber gate for `run.completed` / `run.ingested`: deployment switch
 * (env only) → tenant settings (+ agent allowlist when the event names the
 * agent) → enqueue `{ runId, attempt: 0 }` delayed by the deployment delay.
 * The run source is only on the row, so the worker re-checks the full gate.
 * Never throws.
 */
export async function enqueueOtelExportForRunEvent(
  payload: unknown,
  container: OtelExportContainer,
  deps: EnqueueOtelExportForRunEventDeps,
): Promise<boolean> {
  try {
    const deployment = resolveOtelExportDeployment(deps.env ?? process.env)
    if (!deployment.enabled) return false
    const event = readRunEventPayload(payload)
    if (!event) return false
    const { settings } = await readOtelExportSettings(container, event.tenantId)
    if (!settings.enabled) return false
    if (event.agentId && settings.agentAllowlist && !settings.agentAllowlist.includes(event.agentId)) return false
    await deps.enqueue({ runId: event.runId, attempt: 0 }, { delayMs: deployment.delayMs })
    return true
  } catch (error) {
    logger.warn('otel export enqueue failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    reportExportError(error, OTEL_EXPORT_ERROR_CODES.enqueueFailed, {})
    return false
  }
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
  | 'error'

export type ProcessOtelExportJobDeps = {
  container: AwilixContainer
  loadBundle: (runId: string) => Promise<RunExportBundle | null>
  post: (input: PostOtlpTracesInput) => Promise<OtlpExportResult>
  enqueue: EnqueueOtelExport
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
  deployment: ReturnType<typeof resolveOtelExportDeployment>,
  exportUserIds: boolean,
  env: EnvLike,
  post: ProcessOtelExportJobDeps['post'],
): Promise<OtlpExportResult | null> {
  const endpoint = deployment.endpoint
  if (!endpoint) return null
  const chunks = mapAgentRunToOtlp(bundle, {
    exportUserIds,
    serviceName: deployment.serviceName,
    serviceVersion: APP_VERSION,
    environment: readDeploymentEnvironment(env),
    scopeVersion: APP_VERSION,
  })
  for (const chunk of chunks) {
    const body = JSON.stringify(encodeOtlpTraceRequest(chunk))
    const result = await post({ endpoint, headers: deployment.headers, body })
    if (result.outcome !== 'ok') return result
  }
  return null
}

/**
 * One OTel export job. Only `runId` is trusted from the payload: the run row
 * gives the tenant, agent and source, and the tenant settings are re-read here
 * so a revoked opt-in stops queued jobs. Expected failures never throw (the
 * queue's own retry would duplicate the backoff): `retry` re-enqueues with
 * `attempt + 1` (Retry-After honored, max 5 attempts), `drop` is reported.
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

    const failure = await postAllChunks(bundle, deployment, settings.exportUserIds, env, deps.post)
    if (!failure) {
      await recordOtelExportHealth(deps.container, tenantId, { outcome: 'success' })
      return 'exported'
    }

    const errorCode = failure.errorCode ?? (failure.httpStatus ? `http_${failure.httpStatus}` : 'unknown')
    const attributes = { tenantId, runId: job.runId, attempt: job.attempt, httpStatus: failure.httpStatus ?? undefined, errorCode }
    if (failure.outcome === 'retry' && job.attempt + 1 < OTEL_EXPORT_MAX_ATTEMPTS) {
      const delayMs = Math.max(failure.retryAfterMs ?? 0, otelExportBackoffMs(job.attempt))
      await deps.enqueue({ runId: job.runId, attempt: job.attempt + 1 }, { delayMs })
      return 'retry_scheduled'
    }
    const code = failure.outcome === 'retry' ? OTEL_EXPORT_ERROR_CODES.failed : OTEL_EXPORT_ERROR_CODES.rejected
    logger.warn('otel export gave up', attributes)
    reportExportError(new Error(`[internal] otel export ${failure.outcome === 'retry' ? 'failed' : 'rejected'}`), code, attributes)
    await recordOtelExportHealth(deps.container, tenantId, { outcome: 'error', errorCode })
    return failure.outcome === 'retry' ? 'failed' : 'rejected'
  } catch (error) {
    logger.warn('otel export job failed unexpectedly', {
      runId: job.runId,
      error: error instanceof Error ? error.message : String(error),
    })
    reportExportError(error, OTEL_EXPORT_ERROR_CODES.unexpected, { runId: job.runId, tenantId: tenantId ?? undefined })
    if (tenantId) await recordOtelExportHealth(deps.container, tenantId, { outcome: 'error', errorCode: 'unexpected' })
    return 'error'
  }
}
