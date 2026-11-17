/**
 * Retention for full-fidelity trace content (LLM request/response and packed
 * context payload artifacts). Keys are enumerated from the database — `llm`
 * span attributes and context bundle `payloadRef` — never by listing storage,
 * scoped to one tenant/organization. Each row family is walked in
 * `(created_at, id)` order from a persisted per-scope cursor up to the retention
 * cutoff (kept in module config until the next AO re-squash adds a table), so a missed run, a lowered `retentionDays` or a backlog larger than one
 * run's cap is caught up by later runs. The cursor only advances past a row once
 * every expired key it references is gone; a delete failure or a key that has
 * not expired yet holds it back for the next run. Spans and bundles are
 * append-only and are left untouched (the artifact route answers 410 by key
 * age). Deletion is strict: an already-absent object counts as deleted, an
 * unavailable storage service skips the whole scope, and a per-key failure is
 * reported and counted without aborting the batch.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { AgentContextBundle, AgentSpan } from '../../data/entities'
import { deleteArtifact, type ArtifactScope } from './artifactStore'
import { TRACE_CAPTURE_CONFIG_MODULE, readTraceCapturePolicy } from './capturePolicy'
import { isTraceContentKeyExpired, parseStorageKeyEpochMs } from './contentArtifactAccess'
import { OM_LLM_ATTRIBUTES } from './genAiAttributes'

const logger = createLogger('agent_orchestrator').child({ component: 'trace-content-retention' })

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * @deprecated The sweep no longer scans a fixed window before the cutoff; it
 * resumes from a persisted cursor. Kept for import compatibility only.
 */
export const TRACE_CONTENT_RETENTION_WINDOW_DAYS = 7
export const TRACE_CONTENT_RETENTION_BATCH_SIZE = 200
export const TRACE_CONTENT_RETENTION_MAX_BATCHES = 50

export const TRACE_CONTENT_RETENTION_CURSOR_CONFIG_PREFIX = 'trace_content_retention_cursor'

/** The row family a trace content retention cursor walks. */
export type TraceContentRetentionSource = 'llm_span' | 'context_bundle'

export type TraceContentRetentionCursorPosition = { createdAt: Date; rowId: string }

/** Persists how far the sweep has walked one row family of one scope. */
export type TraceContentRetentionCursorStore = {
  read: (scope: ArtifactScope, source: TraceContentRetentionSource) => Promise<TraceContentRetentionCursorPosition | null>
  write: (
    scope: ArtifactScope,
    source: TraceContentRetentionSource,
    position: TraceContentRetentionCursorPosition,
  ) => Promise<void>
}

export type TraceContentRetentionOptions = {
  now?: Date
  batchSize?: number
  maxBatches?: number
  cursorStore?: TraceContentRetentionCursorStore
}

export type TraceContentRetentionResult = {
  status: 'completed' | 'storage_unavailable'
  retentionDays: number
  scannedRows: number
  deleted: number
  failed: number
}

type ContentRow = { id: string; createdAt: Date; keys: string[] }

type RowSource = {
  source: TraceContentRetentionSource
  load: (after: TraceContentRetentionCursorPosition | null, limit: number) => Promise<ContentRow[]>
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

function createdAtRange(cutoff: Date, after: TraceContentRetentionCursorPosition | null): Record<string, unknown> {
  if (!after) return { createdAt: { $lt: cutoff } }
  return {
    $and: [
      { createdAt: { $lt: cutoff } },
      { $or: [{ createdAt: { $gt: after.createdAt } }, { createdAt: after.createdAt, id: { $gt: after.rowId } }] },
    ],
  }
}

const storedCursorSchema = z.object({
  createdAt: z.string().min(1).max(64).refine((value) => !Number.isNaN(Date.parse(value))),
  rowId: z.string().min(1).max(64),
})

type ModuleConfigServiceLike = {
  getRecord(
    moduleId: string,
    name: string,
    scope?: { tenantId?: string | null },
  ): Promise<{ value: unknown; source?: string } | null>
  setValue(
    moduleId: string,
    name: string,
    value: unknown,
    scope?: { tenantId?: string | null; organizationId?: string | null },
  ): Promise<unknown>
}

export function traceContentRetentionCursorConfigName(
  organizationId: string,
  source: TraceContentRetentionSource,
): string {
  return `${TRACE_CONTENT_RETENTION_CURSOR_CONFIG_PREFIX}:${organizationId}:${source}`
}

/**
 * Cursors are tenant-scoped module config rows, one per organization and row
 * family (stand-in for a table until the next AO re-squash). An instance-level
 * row is never read as a cursor, and a value that does not parse reads as no
 * cursor, so the sweep falls back to walking from the beginning. A missing
 * config service throws: without a cursor the sweep cannot make progress.
 */
export function createModuleConfigTraceContentRetentionCursorStore(
  container: AwilixContainer,
): TraceContentRetentionCursorStore {
  const resolveService = (): ModuleConfigServiceLike => {
    const service = container.resolve('moduleConfigService') as ModuleConfigServiceLike | undefined
    if (!service || typeof service.getRecord !== 'function' || typeof service.setValue !== 'function') {
      throw new Error('[internal] moduleConfigService unavailable for trace content retention cursors')
    }
    return service
  }
  return {
    async read(scope, source) {
      const record = await resolveService().getRecord(
        TRACE_CAPTURE_CONFIG_MODULE,
        traceContentRetentionCursorConfigName(scope.organizationId, source),
        { tenantId: scope.tenantId },
      )
      if (!record || record.source === 'instance') return null
      const parsed = storedCursorSchema.safeParse(record.value)
      if (!parsed.success) return null
      return { createdAt: new Date(parsed.data.createdAt), rowId: parsed.data.rowId }
    },
    async write(scope, source, position) {
      await resolveService().setValue(
        TRACE_CAPTURE_CONFIG_MODULE,
        traceContentRetentionCursorConfigName(scope.organizationId, source),
        { createdAt: position.createdAt.toISOString(), rowId: position.rowId },
        { tenantId: scope.tenantId, organizationId: scope.organizationId },
      )
    },
  }
}

/**
 * Delete every expired trace content artifact referenced by the scope's rows
 * created before the retention cutoff, resuming from the scope's cursors.
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
  const cursorStore = options.cursorStore ?? createModuleConfigTraceContentRetentionCursorStore(container)
  const { policy } = await readTraceCapturePolicy(container, scope.tenantId)
  const retentionDays = policy.retentionDays
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS)
  const scopeFilter = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  const decryptionScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  const orderBy = { createdAt: 'asc', id: 'asc' } as const

  const sources: RowSource[] = [
    {
      source: 'llm_span',
      load: async (after, limit) => {
        const spans = await findWithDecryption(
          em,
          AgentSpan,
          { ...scopeFilter, kind: 'llm', ...createdAtRange(cutoff, after) },
          { orderBy, limit },
          decryptionScope,
        )
        return spans.map((span) => ({ id: span.id, createdAt: span.createdAt, keys: spanContentKeys(span) }))
      },
    },
    {
      source: 'context_bundle',
      load: async (after, limit) => {
        const bundles = await findWithDecryption(
          em,
          AgentContextBundle,
          { ...scopeFilter, payloadRef: { $ne: null }, ...createdAtRange(cutoff, after) },
          { orderBy, limit },
          decryptionScope,
        )
        return bundles.map((bundle) => ({ id: bundle.id, createdAt: bundle.createdAt, keys: bundleContentKeys(bundle) }))
      },
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

  const deleteKey = async (key: string): Promise<'deleted' | 'failed' | 'unavailable'> => {
    try {
      const outcome = await deleteArtifact(container, scope, key)
      if (outcome.status === 'unavailable') return 'unavailable'
      result.deleted += 1
      return 'deleted'
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
      return 'failed'
    }
  }

  for (const { source, load } of sources) {
    let position = await cursorStore.read(scope, source)
    let held = false
    for (let batch = 0; batch < maxBatches && !held; batch += 1) {
      const rows = await load(position, batchSize)
      result.scannedRows += rows.length
      let advanced: TraceContentRetentionCursorPosition | null = null
      let storageUnavailable = false
      for (const row of rows) {
        let rowDone = true
        for (const key of row.keys) {
          if (processed.has(key)) continue
          if (parseStorageKeyEpochMs(key) === null) continue
          if (!isTraceContentKeyExpired(key, retentionDays, now)) {
            rowDone = false
            break
          }
          const outcome = await deleteKey(key)
          if (outcome === 'unavailable') {
            storageUnavailable = true
            break
          }
          if (outcome === 'failed') {
            rowDone = false
            continue
          }
          processed.add(key)
        }
        if (storageUnavailable) break
        if (!rowDone) held = true
        if (!held) advanced = { createdAt: row.createdAt, rowId: row.id }
      }
      if (advanced) {
        await cursorStore.write(scope, source, advanced)
        position = advanced
      }
      if (storageUnavailable) {
        logger.warn('trace content retention skipped: storage unavailable for the scope', { ...scope })
        return { ...result, status: 'storage_unavailable' }
      }
      if (rows.length < batchSize) break
    }
  }

  return result
}
