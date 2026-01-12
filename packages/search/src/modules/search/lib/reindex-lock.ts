import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { Queue } from '@open-mercato/queue'

export const REINDEX_LOCK_KEY = 'reindex_lock'

/** Lock timeout in milliseconds (30 minutes) - absolute maximum, used when queue check is unavailable */
const LOCK_TIMEOUT_MS = 30 * 60 * 1000

/** Shorter timeout (2 minutes) when queue shows no active/waiting jobs */
const IDLE_LOCK_TIMEOUT_MS = 2 * 60 * 1000

export type ReindexLockType = 'fulltext' | 'vector'

export type ReindexLockStatus = {
  type: ReindexLockType
  action: string
  startedAt: string
  tenantId: string
  organizationId?: string | null
}

type Resolver = {
  resolve: <T = unknown>(name: string) => T
}

type QueueLike = Pick<Queue, 'getJobCounts'>

export type LockCheckOptions = {
  /** Queue to check for active jobs (optional - improves stale detection) */
  queue?: QueueLike
}

/**
 * Check if there are active or waiting jobs in the queue.
 */
async function hasActiveJobs(queue: QueueLike): Promise<boolean> {
  try {
    const counts = await queue.getJobCounts()
    return counts.active > 0 || counts.waiting > 0
  } catch {
    // If we can't check the queue, assume jobs might be running
    return true
  }
}

/**
 * Check if a reindex operation is currently in progress for a specific type.
 * Returns the lock status if active, null if no lock or lock is stale.
 *
 * When a queue is provided, uses smarter stale detection:
 * - If queue has no active/waiting jobs and lock is older than 2 minutes, considers it stale
 * - This handles cases where the server crashed during reindexing
 */
export async function getReindexLockStatus(
  resolver: Resolver,
  tenantId: string,
  options?: LockCheckOptions & { type?: ReindexLockType },
): Promise<ReindexLockStatus | null> {
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    return null
  }

  // If type is specified, check only that type's lock
  // Otherwise, check both and return whichever is active
  const typesToCheck: ReindexLockType[] = options?.type ? [options.type] : ['fulltext', 'vector']

  for (const lockType of typesToCheck) {
    try {
      const lockKey = `${REINDEX_LOCK_KEY}:${lockType}:${tenantId}`
      const lock = await service.getValue<ReindexLockStatus>('search', lockKey)
      if (!lock) continue

      const startedAt = new Date(lock.startedAt).getTime()
      const now = Date.now()
      const elapsed = now - startedAt

      // Check absolute timeout first (30 minutes)
      if (elapsed > LOCK_TIMEOUT_MS) {
        await clearReindexLock(resolver, tenantId, lockType)
        continue
      }

      // If queue is provided, use smarter stale detection
      if (options?.queue && elapsed > IDLE_LOCK_TIMEOUT_MS) {
        const hasJobs = await hasActiveJobs(options.queue)
        if (!hasJobs) {
          // No jobs in queue and lock is older than 2 minutes - likely stale
          await clearReindexLock(resolver, tenantId, lockType)
          continue
        }
      }

      return lock
    } catch {
      continue
    }
  }

  return null
}

/**
 * Acquire a reindex lock for a specific type. Returns true if lock was acquired, false if already locked.
 * Fulltext and vector locks are independent - they don't block each other.
 */
export async function acquireReindexLock(
  resolver: Resolver,
  options: {
    type: ReindexLockType
    action: string
    tenantId: string
    organizationId?: string | null
  },
): Promise<boolean> {
  // Check if already locked for this specific type
  const existing = await getReindexLockStatus(resolver, options.tenantId, { type: options.type })
  if (existing) {
    return false
  }

  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    // If service not available, allow the operation (no locking)
    return true
  }

  const lock: ReindexLockStatus = {
    type: options.type,
    action: options.action,
    startedAt: new Date().toISOString(),
    tenantId: options.tenantId,
    organizationId: options.organizationId,
  }

  try {
    // Use type-specific lock key so fulltext and vector can run independently
    await service.setValue('search', `${REINDEX_LOCK_KEY}:${options.type}:${options.tenantId}`, lock)
    return true
  } catch {
    return false
  }
}

/**
 * Release the reindex lock for a specific type.
 */
export async function clearReindexLock(
  resolver: Resolver,
  tenantId: string,
  type: ReindexLockType,
): Promise<void> {
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    return
  }

  try {
    await service.setValue('search', `${REINDEX_LOCK_KEY}:${type}:${tenantId}`, null)
  } catch {
    // Ignore errors when clearing lock
  }
}

