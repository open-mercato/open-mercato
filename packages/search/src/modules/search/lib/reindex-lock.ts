
import { type Kysely, sql } from 'kysely'
import {
  prepareJob,
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
  db: Kysely<any>,
  tenantId: string,
  options?: { type?: ReindexLockType },
): Promise<ReindexLockStatus | null> {
  const typesToCheck: ReindexLockType[] = options?.type
    ? [options.type]
    : ['fulltext', 'vector']

  for (const lockType of typesToCheck) {
    const entityType = LOCK_ENTITY_TYPES[lockType]

    try {
      const job = await db
        .selectFrom('entity_index_jobs' as any)
        .selectAll()
        .where('entity_type' as any, '=', entityType)
        .where(sql<boolean>`tenant_id is not distinct from ${tenantId}`)
        .where('finished_at' as any, 'is', null)
        .executeTakeFirst() as {
          id: string
          status?: string | null
          started_at?: Date | string | null
          heartbeat_at?: Date | string | null
          organization_id?: string | null
          processed_count?: number | null
          total_count?: number | null
        } | undefined

      if (!job) continue

      // Check heartbeat staleness
      const heartbeatAt = job.heartbeat_at
        ? new Date(job.heartbeat_at as string | Date).getTime()
        : 0
      const elapsed = Date.now() - heartbeatAt

      if (elapsed > HEARTBEAT_STALE_MS) {
        // Auto-cleanup stale lock
        await db
          .updateTable('entity_index_jobs' as any)
          .set({ finished_at: sql`now()` } as any)
          .where('id' as any, '=', job.id)
          .execute()
        continue
      }

      // started_at comes as string from Kysely, convert if needed
      const startedAtStr = job.started_at
        ? (typeof job.started_at === 'string' ? job.started_at : new Date(job.started_at).toISOString())
        : new Date().toISOString()

      const result = {
        type: lockType,
        action: job.status || 'reindexing',
        startedAt: startedAtStr,
        tenantId,
        organizationId: job.organization_id ?? null,
        processedCount: job.processed_count ?? null,
        totalCount: job.total_count ?? null,
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
  db: Kysely<any>,
  options: {
    type: ReindexLockType
    action: string
    tenantId: string
    organizationId?: string | null
    totalCount?: number | null
  },
): Promise<{ acquired: boolean; jobId?: string }> {
  // Check existing active lock
  const existing = await getReindexLockStatus(db, options.tenantId, {
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
    const jobId = await prepareJob(db, scope, 'reindexing', {
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
  db: Kysely<any>,
  tenantId: string,
  type: ReindexLockType,
  organizationId?: string | null,
): Promise<void> {
  try {
    const scope = buildScope(type, tenantId, organizationId)
    await finalizeJob(db, scope)
  } catch {
    // Ignore errors when clearing lock
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
  db: Kysely<any>,
  tenantId: string,
  type: ReindexLockType,
  processedDelta: number,
  organizationId?: string | null,
): Promise<void> {
  try {
    const scope = buildScope(type, tenantId, organizationId)
    const entityType = LOCK_ENTITY_TYPES[type]
    const delta = Math.max(0, processedDelta)

    // Try to update existing active job first
    const result = await db
      .updateTable('entity_index_jobs' as any)
      .set({
        processed_count: sql`coalesce(processed_count, 0) + ${delta}`,
        heartbeat_at: sql`now()`,
      } as any)
      .where('entity_type' as any, '=', entityType)
      .where(sql<boolean>`tenant_id is not distinct from ${tenantId}`)
      .where(sql<boolean>`organization_id is not distinct from ${organizationId ?? null}`)
      .where('finished_at' as any, 'is', null)
      .executeTakeFirst()

    // Kysely returns numUpdatedRows as bigint; coerce
    const updated = Number(result?.numUpdatedRows ?? 0)

    // If no active lock exists, recreate it
    if (updated === 0) {
      await prepareJob(db, scope, 'reindexing')
    }
  } catch {
    // Ignore errors when updating progress
  }
}
