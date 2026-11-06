/**
 * Retention for full-fidelity trace content (LLM request/response and packed
 * context payload artifacts). Keys are enumerated from the database — `llm`
 * span attributes and context bundle `payloadRef` — never by listing storage,
 * scoped to one tenant/organization. The scan is bounded to rows created in
 * `[cutoff − window, cutoff)` and read in batches; spans and bundles are
 * append-only and are left untouched (the artifact route answers 410 by key
 * age). Deletion is strict: an already-absent object counts as deleted, an
 * unavailable storage service skips the whole scope, and a per-key failure is
 * reported and counted without aborting the batch.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { AgentContextBundle, AgentSpan } from '../../data/entities'
import { deleteArtifact, type ArtifactScope } from './artifactStore'
import { readTraceCapturePolicy } from './capturePolicy'
import { isTraceContentKeyExpired } from './contentArtifactAccess'
import { OM_LLM_ATTRIBUTES } from './genAiAttributes'

const logger = createLogger('agent_orchestrator').child({ component: 'trace-content-retention' })

const DAY_MS = 24 * 60 * 60 * 1000

export const TRACE_CONTENT_RETENTION_WINDOW_DAYS = 7
export const TRACE_CONTENT_RETENTION_BATCH_SIZE = 200
export const TRACE_CONTENT_RETENTION_MAX_BATCHES = 50

export type TraceContentRetentionOptions = {
  now?: Date
  batchSize?: number
  maxBatches?: number
}

export type TraceContentRetentionResult = {
  status: 'completed' | 'storage_unavailable'
  retentionDays: number
  scannedRows: number
  deleted: number
  failed: number
}

function readStringAttribute(attributes: unknown, name: string): string | null {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return null
  const value = (attributes as Record<string, unknown>)[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function spanContentKeys(span: AgentSpan): string[] {
  return [OM_LLM_ATTRIBUTES.contentRequestKey, OM_LLM_ATTRIBUTES.contentResponseKey]
    .map((attribute) => readStringAttribute(span.attributes, attribute))
    .filter((key): key is string => key !== null)
}

function bundleContentKeys(bundle: AgentContextBundle): string[] {
  return typeof bundle.payloadRef === 'string' && bundle.payloadRef.length > 0 ? [bundle.payloadRef] : []
}

type KeySource = (offset: number, limit: number) => Promise<string[][]>

/**
 * Delete every expired trace content artifact referenced by the scope's rows
 * created within the bounded window before the retention cutoff.
 */
export async function purgeExpiredTraceContent(
  container: AwilixContainer,
  em: EntityManager,
  scope: ArtifactScope,
  options: TraceContentRetentionOptions = {},
): Promise<TraceContentRetentionResult> {
  const now = options.now ?? new Date()
  const batchSize = options.batchSize ?? TRACE_CONTENT_RETENTION_BATCH_SIZE
  const maxBatches = options.maxBatches ?? TRACE_CONTENT_RETENTION_MAX_BATCHES
  const { policy } = await readTraceCapturePolicy(container, scope.tenantId)
  const retentionDays = policy.retentionDays
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS)
  const windowStart = new Date(cutoff.getTime() - TRACE_CONTENT_RETENTION_WINDOW_DAYS * DAY_MS)
  const createdAt = { $gte: windowStart, $lt: cutoff }
  const scopeFilter = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  const decryptionScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }

  const sources: KeySource[] = [
    async (offset, limit) => {
      const spans = await findWithDecryption(
        em,
        AgentSpan,
        { ...scopeFilter, kind: 'llm', createdAt },
        { orderBy: { createdAt: 'asc', id: 'asc' }, offset, limit },
        decryptionScope,
      )
      return spans.map(spanContentKeys)
    },
    async (offset, limit) => {
      const bundles = await findWithDecryption(
        em,
        AgentContextBundle,
        { ...scopeFilter, payloadRef: { $ne: null }, createdAt },
        { orderBy: { createdAt: 'asc', id: 'asc' }, offset, limit },
        decryptionScope,
      )
      return bundles.map(bundleContentKeys)
    },
  ]

  const result: TraceContentRetentionResult = {
    status: 'completed',
    retentionDays,
    scannedRows: 0,
    deleted: 0,
    failed: 0,
  }
  const processed = new Set<string>()

  const deleteKey = async (key: string): Promise<'done' | 'unavailable'> => {
    try {
      const outcome = await deleteArtifact(container, scope, key)
      if (outcome.status === 'unavailable') return 'unavailable'
      result.deleted += 1
    } catch (error) {
      result.failed += 1
      logger.warn('trace content artifact delete failed', {
        ...scope,
        error: error instanceof Error ? error.message : String(error),
      })
      getTelemetryRuntime()?.reportError(error, {
        module: 'agent_orchestrator',
        code: 'agent_orchestrator.trace_content_retention_delete_failed',
        attributes: { tenantId: scope.tenantId, organizationId: scope.organizationId },
      })
    }
    return 'done'
  }

  for (const source of sources) {
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const rows = await source(batch * batchSize, batchSize)
      result.scannedRows += rows.length
      for (const key of rows.flat()) {
        if (processed.has(key) || !isTraceContentKeyExpired(key, retentionDays, now)) continue
        processed.add(key)
        if ((await deleteKey(key)) === 'unavailable') {
          logger.warn('trace content retention skipped: storage unavailable for the scope', { ...scope })
          return { ...result, status: 'storage_unavailable' }
        }
      }
      if (rows.length < batchSize) break
    }
  }

  return result
}
