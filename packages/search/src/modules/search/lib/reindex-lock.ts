import type { Knex } from 'knex'
import {
  prepareJob,
  updateJobProgress,
  finalizeJob,
  type JobScope,
} from '@open-mercato/core/modules/query_index/lib/jobs'

export const REINDEX_LOCK_KEY = 'reindex_lock'

export type ReindexLockType = 'fulltext' | 'vector'

// Entity type mapping for search reindex jobs
const LOCK_ENTITY_TYPES: Record<ReindexLockType, string> = {
  fulltext: 'search:reindex:fulltext',
  vector: 'search:reindex:vector',
}

// Heartbeat staleness threshold (30 seconds)
const HEARTBEAT_STALE_MS = 30 * 1000

export type ReindexLockStatus = {
  type: ReindexLockType
  action: string
  startedAt: string
  tenantId: string
  organizationId?: string | null
  processedCount?: number | null
  totalCount?: number | null
}

export type ReindexProgressSnapshot = {
  type: ReindexLockType
  action: string
  startedAt: number
  processedCount: number
  totalCount: number
  completed: boolean
}

function buildScope(
  type: ReindexLockType,
  tenantId: string,
  organizationId?: string | null,
): JobScope {
  return {
    entityType: LOCK_ENTITY_TYPES[type],
    tenantId,
    organizationId: organizationId ?? null,
    partitionIndex: null,
    partitionCount: null,
  }
}

/**
 * Check if a reindex operation is currently in progress for a specific type.
 * Returns the lock status if active, null if no lock or lock is stale.
 *
 * Automatically cleans up stale locks (heartbeat older than 60 seconds).
 */
export async function getReindexLockStatus(
  knex: Knex,
  tenantId: string,
  options?: { type?: ReindexLockType },
): Promise<ReindexLockStatus | null> {
  const typesToCheck: ReindexLockType[] = options?.type
    ? [options.type]
    : ['fulltext', 'vector']

  for (const lockType of typesToCheck) {
    const entityType = LOCK_ENTITY_TYPES[lockType]

    try {
      const job = await knex('entity_index_jobs')
        .where('entity_type', entityType)
        .whereRaw('tenant_id is not distinct from ?', [tenantId])
        .whereNull('finished_at')
        .first()

      if (!job) continue

      // Check heartbeat staleness
      const heartbeatAt = job.heartbeat_at
        ? new Date(job.heartbeat_at).getTime()
        : 0
      const elapsed = Date.now() - heartbeatAt

      if (elapsed > HEARTBEAT_STALE_MS) {
        // Auto-cleanup stale lock
        await knex('entity_index_jobs')
          .where('id', job.id)
          .update({ finished_at: knex.fn.now() })
        continue
      }

      // started_at comes as string from knex, convert if needed
      const startedAtStr = job.started_at
        ? (typeof job.started_at === 'string' ? job.started_at : new Date(job.started_at).toISOString())
        : new Date().toISOString()

      const result = {
        type: lockType,
        action: job.status || 'reindexing',
        startedAt: startedAtStr,
        tenantId,
        organizationId: job.organization_id,
        processedCount: job.processed_count,
        totalCount: job.total_count,
      }
      return result
    } catch {
      continue
    }
  }

  return null
}

/**
 * Acquire a reindex lock for a specific type. Returns whether lock was acquired.
 * Fulltext and vector locks are independent - they don't block each other.
 */
export async function acquireReindexLock(
  knex: Knex,
  options: {
    type: ReindexLockType
    action: string
    tenantId: string
    organizationId?: string | null
    totalCount?: number | null
  },
): Promise<{ acquired: boolean; jobId?: string }> {
  // Check existing active lock
  const existing = await getReindexLockStatus(knex, options.tenantId, {
    type: options.type,
  })
  if (existing) {
    return { acquired: false }
  }

  try {
    const scope = buildScope(
      options.type,
      options.tenantId,
      options.organizationId,
    )
    const jobId = await prepareJob(knex, scope, 'reindexing', {
      totalCount: options.totalCount,
    })

    return { acquired: true, jobId: jobId ?? undefined }
  } catch {
    return { acquired: false }
  }
}

/**
 * Release the reindex lock for a specific type.
 */
export async function clearReindexLock(
  knex: Knex,
  tenantId: string,
  type: ReindexLockType,
  organizationId?: string | null,
): Promise<void> {
  try {
    const scope = buildScope(type, tenantId, organizationId)
    await finalizeJob(knex, scope)
  } catch {
    // Ignore errors when clearing lock
  }
}

export async function setReindexLockTotalCount(
  knex: Knex,
  tenantId: string,
  type: ReindexLockType,
  totalCount: number,
  organizationId?: string | null,
): Promise<void> {
  try {
    const entityType = LOCK_ENTITY_TYPES[type]
    await knex('entity_index_jobs')
      .where('entity_type', entityType)
      .whereRaw('tenant_id is not distinct from ?', [tenantId])
      .whereRaw('organization_id is not distinct from ?', [organizationId ?? null])
      .whereNull('finished_at')
      .update({
        total_count: Math.max(0, Math.round(totalCount)),
        heartbeat_at: knex.fn.now(),
      })
  } catch {
    // Ignore errors when setting lock totals
  }
}

/**
 * Update the reindex progress and refresh the heartbeat.
 * Call this periodically during batch processing to prevent stale lock detection.
 *
 * If no active lock exists (e.g., it expired after queue restart), this will
 * recreate the lock so the reindex button stays disabled while processing.
 */
export async function updateReindexProgress(
  knex: Knex,
  tenantId: string,
  type: ReindexLockType,
  processedDelta: number,
  organizationId?: string | null,
): Promise<ReindexProgressSnapshot | null> {
  try {
    const scope = buildScope(type, tenantId, organizationId)
    const entityType = LOCK_ENTITY_TYPES[type]

    // Try to update existing active job first
    const updated = await knex('entity_index_jobs')
      .where('entity_type', entityType)
      .whereRaw('tenant_id is not distinct from ?', [tenantId])
      .whereRaw('organization_id is not distinct from ?', [organizationId ?? null])
      .whereNull('finished_at')
      .update({
        processed_count: knex.raw('coalesce(processed_count, 0) + ?', [Math.max(0, processedDelta)]),
        heartbeat_at: knex.fn.now(),
      })

    // If no active lock exists, recreate it
    if (updated === 0) {
      await prepareJob(knex, scope, 'reindexing')
      return null
    }

    const job = await knex('entity_index_jobs')
      .where('entity_type', entityType)
      .whereRaw('tenant_id is not distinct from ?', [tenantId])
      .whereRaw('organization_id is not distinct from ?', [organizationId ?? null])
      .whereNull('finished_at')
      .first([
        'status',
        'started_at',
        'processed_count',
        'total_count',
      ])

    if (!job) {
      return null
    }

    const processedCount = typeof job.processed_count === 'number'
      ? Math.max(0, job.processed_count)
      : 0
    const totalCount = typeof job.total_count === 'number'
      ? Math.max(0, job.total_count)
      : 0
    const startedAt = job.started_at
      ? new Date(job.started_at as string | Date).getTime()
      : Date.now()
    const completed = totalCount > 0 && processedCount >= totalCount

    if (completed) {
      await finalizeJob(knex, scope)
    }

    return {
      type,
      action: typeof job.status === 'string' && job.status.trim().length > 0
        ? job.status
        : 'reindexing',
      startedAt,
      processedCount,
      totalCount,
      completed,
    }
  } catch {
    // Ignore errors when updating progress
    return null
  }
}
