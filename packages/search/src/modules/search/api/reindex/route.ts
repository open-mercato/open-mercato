import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { SearchStrategy } from '@open-mercato/shared/modules/search'
import type { SearchIndexer } from '@open-mercato/search/indexer'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { Queue } from '@open-mercato/queue'
import type { MeilisearchIndexJobPayload } from '../../../../queue/meilisearch-indexing'
import { handleMeilisearchIndexJob } from '../../workers/meilisearch-index.worker'

/** Strategy with optional stats support */
type StrategyWithStats = SearchStrategy & {
  getIndexStats?: (tenantId: string) => Promise<Record<string, unknown> | null>
  clearIndex?: (tenantId: string) => Promise<void>
  recreateIndex?: (tenantId: string) => Promise<void>
}

/** Collect stats from all strategies that support it */
async function collectStrategyStats(
  strategies: StrategyWithStats[],
  tenantId: string
): Promise<Record<string, Record<string, unknown> | null>> {
  const stats: Record<string, Record<string, unknown> | null> = {}
  for (const strategy of strategies) {
    if (typeof strategy.getIndexStats === 'function') {
      try {
        const isAvailable = await strategy.isAvailable()
        if (isAvailable) {
          stats[strategy.id] = await strategy.getIndexStats(tenantId)
        }
      } catch {
        // Skip strategy if stats collection fails
      }
    }
  }
  return stats
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['search.reindex'] },
}

type ReindexAction = 'clear' | 'recreate' | 'reindex'

const toJson = (payload: Record<string, unknown>, init?: ResponseInit) => NextResponse.json(payload, init)

const unauthorized = async () => {
  const { t } = await resolveTranslations()
  return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
}

export async function POST(req: Request) {
  const { t } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return await unauthorized()
  }

  let payload: { action?: ReindexAction; entityId?: string; useQueue?: boolean } = {}
  try {
    payload = await req.json()
  } catch {
    // Default to reindex
  }

  const action: ReindexAction =
    payload.action === 'clear' ? 'clear' :
    payload.action === 'recreate' ? 'recreate' : 'reindex'
  const entityId = typeof payload.entityId === 'string' ? payload.entityId : undefined
  // Force direct indexing when using local queue strategy (no background worker)
  const queueStrategy = process.env.QUEUE_STRATEGY || 'local'
  const useQueue = queueStrategy === 'async' && payload.useQueue === true

  const container = await createRequestContainer()
  try {
    // Get all search strategies
    const searchStrategies = (container.resolve('searchStrategies') as StrategyWithStats[] | undefined) ?? []

    // Find a strategy that supports index management (clear/recreate)
    const indexableStrategy = searchStrategies.find(
      (s) => typeof s.clearIndex === 'function' || typeof s.recreateIndex === 'function'
    )

    if (!indexableStrategy) {
      return toJson(
        { error: t('search.api.errors.noIndexableStrategy', 'No indexable search strategy is configured') },
        { status: 503 }
      )
    }

    // Check if strategy is available
    const isAvailable = await indexableStrategy.isAvailable()
    if (!isAvailable) {
      return toJson(
        { error: t('search.api.errors.strategyUnavailable', 'Search strategy is not available') },
        { status: 503 }
      )
    }

    // Perform the requested action
    if (action === 'reindex') {
      // Full reindex: recreate index and re-index all data
      const searchIndexer = container.resolve('searchIndexer') as SearchIndexer | undefined
      if (!searchIndexer) {
        return toJson(
          { error: t('search.api.errors.indexerUnavailable', 'Search indexer is not available') },
          { status: 503 }
        )
      }

      let result
      const orgId = typeof auth.orgId === 'string' ? auth.orgId : null

      // Debug: List enabled entities
      const enabledEntities = searchIndexer.listEnabledEntities()
      console.log('[search.reindex] Starting reindex', {
        tenantId: auth.tenantId,
        orgId,
        enabledEntities,
        entityId: entityId ?? 'all',
        useQueue,
      })

      if (entityId) {
        // Reindex specific entity
        result = await searchIndexer.reindexEntityToMeilisearch({
          entityId: entityId as EntityId,
          tenantId: auth.tenantId,
          organizationId: orgId,
          recreateIndex: true,
          useQueue,
          onProgress: (progress) => {
            console.log('[search.reindex] Progress', progress)
          },
        })
        console.log('[search.reindex] Reindexed entity to Meilisearch', {
          entityId,
          tenantId: auth.tenantId,
          recordsIndexed: result.recordsIndexed,
          jobsEnqueued: result.jobsEnqueued,
          errors: result.errors,
        })
      } else {
        // Reindex all entities
        result = await searchIndexer.reindexAllToMeilisearch({
          tenantId: auth.tenantId,
          organizationId: orgId,
          recreateIndex: true,
          useQueue,
          onProgress: (progress) => {
            console.log('[search.reindex] Progress', progress)
          },
        })
        console.log('[search.reindex] Reindexed all entities to Meilisearch', {
          tenantId: auth.tenantId,
          entitiesProcessed: result.entitiesProcessed,
          recordsIndexed: result.recordsIndexed,
          jobsEnqueued: result.jobsEnqueued,
          errors: result.errors,
        })
      }

      // TODO: Remove this block when @open-mercato/queue supports auto-processing for local strategy
      // Currently, local queue (file-based) has no background worker, so we process jobs synchronously.
      // Once the queue package implements auto-pulling for local strategy, this workaround can be removed.
      let processedSync = false

      if (useQueue && queueStrategy === 'local') {
        let queue: Queue<MeilisearchIndexJobPayload> | null = null
        try {
          queue = container.resolve<Queue<MeilisearchIndexJobPayload>>('meilisearchIndexQueue')
        } catch {
          queue = null
        }
        if (queue) {
          console.log('[search.reindex] Processing queue jobs synchronously (local strategy)...')
          const queueResult = await queue.process(async (job, ctx) => {
            await handleMeilisearchIndexJob(job, ctx, { resolve: container.resolve.bind(container) })
          })
          processedSync = true
          console.log('[search.reindex] Synchronous queue processing complete', {
            processed: queueResult.processed,
            failed: queueResult.failed,
          })
        }
      }

      // Get updated stats from all strategies
      const stats = await collectStrategyStats(searchStrategies, auth.tenantId)

      return toJson({
        ok: result.success,
        action,
        entityId: entityId ?? null,
        useQueue,
        processedSync,
        result: {
          entitiesProcessed: result.entitiesProcessed,
          recordsIndexed: result.recordsIndexed,
          jobsEnqueued: result.jobsEnqueued ?? 0,
          errors: result.errors.length > 0 ? result.errors : undefined,
        },
        stats,
      })
    } else if (entityId) {
      // Purge specific entity
      await indexableStrategy.purge?.(entityId as EntityId, auth.tenantId)
      console.log('[search.reindex] Purged entity', { strategyId: indexableStrategy.id, entityId, tenantId: auth.tenantId })
    } else if (action === 'clear') {
      // Clear all documents but keep index
      if (indexableStrategy.clearIndex) {
        await indexableStrategy.clearIndex(auth.tenantId)
        console.log('[search.reindex] Cleared index', { strategyId: indexableStrategy.id, tenantId: auth.tenantId })
      }
    } else {
      // Recreate the entire index
      if (indexableStrategy.recreateIndex) {
        await indexableStrategy.recreateIndex(auth.tenantId)
        console.log('[search.reindex] Recreated index', { strategyId: indexableStrategy.id, tenantId: auth.tenantId })
      }
    }

    // Get updated stats from all strategies
    const stats = await collectStrategyStats(searchStrategies, auth.tenantId)

    return toJson({
      ok: true,
      action,
      entityId: entityId ?? null,
      stats,
    })
  } catch (error: unknown) {
    // Log full error details server-side only
    console.error('[search.reindex] Failed', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      tenantId: auth.tenantId,
    })
    // Return generic message to client - don't expose internal error details
    return toJson(
      { error: t('search.api.errors.reindexFailed', 'Reindex operation failed. Please try again or contact support.') },
      { status: 500 }
    )
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}
