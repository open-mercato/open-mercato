/**
 * Helpers for serving full-fidelity trace content (LLM request/response and
 * packed context payload artifacts) from the run artifact route: retention
 * expiry derived from the storage key, and the best-effort access log written
 * for every successful content read.
 */

import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { loadInvokerAcl } from '../access/agentInvokeAccess'
import { invokerFromAuth } from '../access/invokeDenial'
import { readArtifact, type ArtifactEncryptionRef, type ArtifactScope } from './artifactStore'

const logger = createLogger('agent_orchestrator').child({ component: 'trace-content-access' })

export const TRACE_CONTENT_ACCESS_RESOURCE_KIND = 'agent_orchestrator.agent_run.content'
export const TRACE_CONTENT_ACCESS_TYPE = 'read:item'
export const TRACE_VIEW_CONTENT_FEATURE = 'agent_orchestrator.trace.view_content'

const DAY_MS = 24 * 60 * 60 * 1000
const STORED_NAME_EPOCH_PATTERN = /^(\d{10,16})_/

/**
 * The upload time encoded in a `storage-s3` key. Keys end with
 * `<epochMs>_<suffix>_<fileName>`; `null` when the last segment does not
 * carry that prefix.
 */
export function parseStorageKeyEpochMs(key: string): number | null {
  const lastSegment = key.split('/').pop() ?? ''
  const match = STORED_NAME_EPOCH_PATTERN.exec(lastSegment)
  if (!match) return null
  const epochMs = Number(match[1])
  return Number.isSafeInteger(epochMs) ? epochMs : null
}

/** Whether a content key was uploaded longer ago than the retention window. */
export function isTraceContentKeyExpired(key: string, retentionDays: number, now: Date = new Date()): boolean {
  const epochMs = parseStorageKeyEpochMs(key)
  if (epochMs === null) return false
  return epochMs < now.getTime() - retentionDays * DAY_MS
}

type AccessLogWriter = {
  log(input: {
    tenantId: string
    organizationId: string
    actorUserId: string | null
    resourceKind: string
    resourceId: string
    accessType: string
    context: Record<string, unknown>
  }): Promise<unknown>
}

type ServiceResolver = { resolve<T = unknown>(name: string): T }

function tryResolveAccessLogService(container: ServiceResolver): AccessLogWriter | null {
  try {
    const service = container.resolve<AccessLogWriter | undefined>('accessLogService')
    return service && typeof service.log === 'function' ? service : null
  } catch {
    return null
  }
}

export type TraceContentAccessEntry = {
  tenantId: string
  organizationId: string
  actorUserId: string | null
  apiKeyId: string | null
  runId: string
  kind: string
  key: string
}

/**
 * Write the access log row for one successful content read. Best-effort: an
 * absent `accessLogService` or a failed write is logged and never fails the read.
 */
export async function recordTraceContentAccess(
  container: ServiceResolver,
  entry: TraceContentAccessEntry,
): Promise<void> {
  const service = tryResolveAccessLogService(container)
  if (!service) {
    logger.warn('trace content access log skipped: accessLogService unavailable', { runId: entry.runId })
    return
  }
  try {
    await service.log({
      tenantId: entry.tenantId,
      organizationId: entry.organizationId,
      actorUserId: entry.actorUserId,
      resourceKind: TRACE_CONTENT_ACCESS_RESOURCE_KIND,
      resourceId: entry.runId,
      accessType: TRACE_CONTENT_ACCESS_TYPE,
      context: { kind: entry.kind, key: entry.key, apiKeyId: entry.apiKeyId },
    })
  } catch (error) {
    logger.warn('trace content access log write failed', { runId: entry.runId, err: error })
    getTelemetryRuntime()?.reportError(error, {
      module: 'agent_orchestrator',
      code: 'agent_orchestrator.trace_content_access_log_failed',
      attributes: { runId: entry.runId, kind: entry.kind },
    })
  }
}

/** Whether the caller holds `agent_orchestrator.trace.view_content` (superadmin passes). */
export async function hasTraceViewContentAccess(
  container: AwilixContainer,
  auth: Exclude<AuthContext, null>,
  tenantId: string,
): Promise<boolean> {
  const acl = await loadInvokerAcl(container, invokerFromAuth(auth), {
    tenantId,
    organizationId: auth.orgId ?? null,
  })
  return authorizeFeatures([TRACE_VIEW_CONTENT_FEATURE], { grantedFeatures: acl.features, unrestricted: acl.isSuperAdmin })
}

export type TraceContentActor = { actorUserId: string | null; apiKeyId: string | null }

/** The access-log actor of a request: the user, or the API key and its owning user. */
export function traceContentActorFromAuth(auth: Exclude<AuthContext, null>): TraceContentActor {
  const isApiKey = auth.isApiKey === true
  return {
    actorUserId: isApiKey ? auth.userId || null : auth.sub,
    apiKeyId: isApiKey ? auth.keyId || null : null,
  }
}

export type TraceContentReadResult =
  | { status: 'ok'; value: unknown }
  | { status: 'expired' }
  | { status: 'unavailable' }

export type TraceContentReadInput = {
  scope: ArtifactScope
  runId: string
  kind: string
  ref: ArtifactEncryptionRef
  key: string
  retentionDays: number
  actor: TraceContentActor
}

/**
 * Read one content artifact the caller already proved belongs to the run.
 * A key past the retention window or a missing object is `expired`; a storage
 * failure is `unavailable`; a successful read writes the access log.
 */
export async function readTraceContentArtifact(
  container: AwilixContainer,
  input: TraceContentReadInput,
): Promise<TraceContentReadResult> {
  if (isTraceContentKeyExpired(input.key, input.retentionDays)) return { status: 'expired' }
  const result = await readArtifact(container, input.scope, input.ref, input.key)
  if (result.status === 'missing') return { status: 'expired' }
  if (result.status === 'unavailable') return { status: 'unavailable' }
  await recordTraceContentAccess(container, {
    ...input.scope,
    ...input.actor,
    runId: input.runId,
    kind: input.kind,
    key: input.key,
  })
  return { status: 'ok', value: result.value }
}
