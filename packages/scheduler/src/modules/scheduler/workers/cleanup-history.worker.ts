import type { QueuedJob, JobContext, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/core'
import { ScheduledJobRun } from '../data/entities'

// Worker metadata for auto-discovery
export const metadata: WorkerMeta = {
  queue: 'scheduler-cleanup',
  concurrency: 1, // Only one cleanup job should run at a time
}

export type CleanupHistoryPayload = {
  tenantId?: string | null
  daysToKeep?: number
}

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

/**
 * Cleanup old scheduled job run history
 * 
 * Removes execution history older than N days (default: 7)
 * to keep the database size manageable.
 * 
 * This worker can be scheduled to run daily via the scheduler itself
 * or triggered manually via CLI.
 */
export default async function cleanupHistoryWorker(
  job: QueuedJob<CleanupHistoryPayload>,
  jobCtx: JobContext,
  ctx: HandlerContext,
): Promise<void> {
  const { tenantId, daysToKeep = 7 } = job.payload

  console.log(`[scheduler:cleanup] Starting history cleanup (keep last ${daysToKeep} days)`)

  const em = ctx.resolve('em') as EntityManager

  // Calculate cutoff date
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)

  try {
    // Build deletion criteria
    const where: any = {
      startedAt: { $lt: cutoffDate },
    }

    // Optionally filter by tenant
    if (tenantId) {
      where.tenantId = tenantId
    }

    // Count records to be deleted
    const countToDelete = await em.count(ScheduledJobRun, where)

    if (countToDelete === 0) {
      console.log('[scheduler:cleanup] No old records found to clean up')
      return
    }

    console.log(`[scheduler:cleanup] Found ${countToDelete} old execution records to delete`)

    // Delete old runs in batches to avoid long-running transactions
    const batchSize = 1000
    let deletedTotal = 0

    while (true) {
      const batch = await em.find(ScheduledJobRun, where, {
        limit: batchSize,
        fields: ['id'] as any,
      })

      if (batch.length === 0) break

      // Remove records
      em.remove(batch)
      await em.flush()
      
      deletedTotal += batch.length
      console.log(`[scheduler:cleanup] Deleted ${deletedTotal}/${countToDelete} records...`)

      // Clear entity manager cache to prevent memory issues
      em.clear()

      if (batch.length < batchSize) break
    }

    console.log(`[scheduler:cleanup] ✓ Successfully cleaned up ${deletedTotal} old execution records`)
  } catch (error: any) {
    console.error('[scheduler:cleanup] Failed to cleanup history:', error.message)
    throw error
  }
}
