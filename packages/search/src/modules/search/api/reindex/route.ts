import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { SearchStrategy } from '@open-mercato/shared/modules/search'
import type { SearchIndexer } from '@open-mercato/search/indexer'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { recordIndexerLog } from '@open-mercato/shared/lib/indexers/status-log'
import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
import { searchDebug, searchError } from '../../../../lib/debug'
import {
  acquireReindexLock,
  clearReindexLock,
  getReindexLockStatus,
} from '../../lib/reindex-lock'
import { reindexOpenApi } from '../openapi'

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

  // Capture tenantId as non-null for TypeScript (we checked above)
  const tenantId = auth.tenantId

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
  // Use queue by default (requires queue workers to be running), can be disabled with useQueue: false
  const useQueue = payload.useQueue !== false

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const knex = (em.getConnection() as unknown as { getKnex: () => Knex }).getKnex()

  // Check if another fulltext reindex operation is already in progress
  const existingLock = await getReindexLockStatus(knex, tenantId, { type: 'fulltext' })
  if (existingLock) {
    const startedAt = new Date(existingLock.startedAt)
    return NextResponse.json(
      {
        error: t('search.api.errors.reindexInProgress', 'A reindex operation is already in progress'),
        lock: {
          type: existingLock.type,
          action: existingLock.action,
          startedAt: existingLock.startedAt,
          elapsedMinutes: Math.round((Date.now() - startedAt.getTime()) / 60000),
          processedCount: existingLock.processedCount,
          totalCount: existingLock.totalCount,
        },
      },
      { status: 409 }
    )
  }

  // Acquire lock before starting the operation
  const { acquired: lockAcquired } = await acquireReindexLock(knex, {
    type: 'fulltext',
    action,
    tenantId: tenantId,
    organizationId: auth.orgId ?? null,
  })

  if (!lockAcquired) {
    return NextResponse.json(
      { error: t('search.api.errors.lockFailed', 'Failed to acquire reindex lock') },
      { status: 409 }
    )
  }

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
      searchDebug('search.reindex', 'Starting reindex', {
        tenantId: tenantId,
        orgId,
        enabledEntities,
        entityId: entityId ?? 'all',
        useQueue,
      })

      // Log reindex started
      await recordIndexerLog(
        { em },
        {
          source: 'fulltext',
          handler: 'api:search.reindex',
          message: entityId
            ? `Starting Meilisearch reindex for ${entityId}`
            : `Starting Meilisearch reindex for all entities (${enabledEntities.join(', ')})`,
          entityType: entityId ?? null,
          tenantId: tenantId,
          organizationId: orgId,
          details: { enabledEntities, useQueue },
        },
      )

      if (entityId) {
        // Reindex specific entity
        result = await searchIndexer.reindexEntityToFulltext({
          entityId: entityId as EntityId,
          tenantId: tenantId,
          organizationId: orgId,
          recreateIndex: true,
          useQueue,
          onProgress: async (progress) => {
            searchDebug('search.reindex', 'Progress', progress)
            // Note: Heartbeat is updated by workers during job processing, not during enqueueing
          },
        })
        searchDebug('search.reindex', 'Reindexed entity to Meilisearch', {
          entityId,
          tenantId: tenantId,
          recordsIndexed: result.recordsIndexed,
          jobsEnqueued: result.jobsEnqueued,
          errors: result.errors,
        })

        // Log to indexer status logs
        await recordIndexerLog(
          { em },
          {
            source: 'fulltext',
            handler: 'api:search.reindex',
            message: useQueue
              ? `Enqueued ${result.jobsEnqueued ?? 0} jobs for Meilisearch reindex of ${entityId}`
              : `Reindexed ${result.recordsIndexed} records to Meilisearch for ${entityId}`,
            entityType: entityId,
            tenantId: tenantId,
            organizationId: orgId,
            details: {
              recordsIndexed: result.recordsIndexed,
              jobsEnqueued: result.jobsEnqueued,
              useQueue,
              errors: result.errors.length > 0 ? result.errors : undefined,
            },
          },
        )

        // Log any batch errors to error logs
        for (const err of result.errors) {
          await recordIndexerError(
            { em },
            {
              source: 'fulltext',
              handler: 'api:search.reindex',
              error: new Error(err.error),
              entityType: err.entityId,
              tenantId: tenantId,
              organizationId: orgId,
              payload: { action, useQueue },
            },
          )
        }
      } else {
        // Reindex all entities
        result = await searchIndexer.reindexAllToFulltext({
          tenantId: tenantId,
          organizationId: orgId,
          recreateIndex: true,
          useQueue,
          onProgress: async (progress) => {
            searchDebug('search.reindex', 'Progress', progress)
            // Note: Heartbeat is updated by workers during job processing, not during enqueueing
          },
        })
        searchDebug('search.reindex', 'Reindexed all entities to Meilisearch', {
          tenantId: tenantId,
          entitiesProcessed: result.entitiesProcessed,
          recordsIndexed: result.recordsIndexed,
          jobsEnqueued: result.jobsEnqueued,
          errors: result.errors,
        })

        // Log to indexer status logs
        await recordIndexerLog(
          { em },
          {
            source: 'fulltext',
            handler: 'api:search.reindex',
            message: useQueue
              ? `Enqueued ${result.jobsEnqueued ?? 0} jobs for Meilisearch reindex of all entities`
              : `Reindexed ${result.recordsIndexed} records to Meilisearch for ${result.entitiesProcessed} entities`,
            tenantId: tenantId,
            organizationId: orgId,
            details: {
              entitiesProcessed: result.entitiesProcessed,
              recordsIndexed: result.recordsIndexed,
              jobsEnqueued: result.jobsEnqueued,
              useQueue,
              errors: result.errors.length > 0 ? result.errors : undefined,
            },
          },
        )

        // Log any batch errors to error logs
        for (const err of result.errors) {
          await recordIndexerError(
            { em },
            {
              source: 'fulltext',
              handler: 'api:search.reindex',
              error: new Error(err.error),
              entityType: err.entityId,
              tenantId: tenantId,
              organizationId: orgId,
              payload: { action, useQueue },
            },
          )
        }
      }

      // Get updated stats from all strategies
      const stats = await collectStrategyStats(searchStrategies, tenantId)

      return toJson({
        ok: result.success,
        action,
        entityId: entityId ?? null,
        useQueue,
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
      await indexableStrategy.purge?.(entityId as EntityId, tenantId)
      searchDebug('search.reindex', 'Purged entity', { strategyId: indexableStrategy.id, entityId, tenantId: tenantId })

      await recordIndexerLog(
        { em },
        {
          source: 'fulltext',
          handler: 'api:search.reindex',
          message: `Purged entity ${entityId} from Meilisearch`,
          entityType: entityId,
          tenantId: tenantId,
          organizationId: auth.orgId ?? null,
        },
      )
    } else if (action === 'clear') {
      // Clear all documents but keep index
      if (indexableStrategy.clearIndex) {
        await indexableStrategy.clearIndex(tenantId)
        searchDebug('search.reindex', 'Cleared index', { strategyId: indexableStrategy.id, tenantId: tenantId })

        await recordIndexerLog(
          { em },
          {
            source: 'fulltext',
            handler: 'api:search.reindex',
            message: 'Cleared all documents from Meilisearch index',
            tenantId: tenantId,
            organizationId: auth.orgId ?? null,
          },
        )
      }
    } else {
      // Recreate the entire index
      if (indexableStrategy.recreateIndex) {
        await indexableStrategy.recreateIndex(tenantId)
        searchDebug('search.reindex', 'Recreated index', { strategyId: indexableStrategy.id, tenantId: tenantId })

        await recordIndexerLog(
          { em },
          {
            source: 'fulltext',
            handler: 'api:search.reindex',
            message: 'Recreated Meilisearch index',
            tenantId: tenantId,
            organizationId: auth.orgId ?? null,
          },
        )
      }
    }

    // Get updated stats from all strategies
    const stats = await collectStrategyStats(searchStrategies, tenantId)

    return toJson({
      ok: true,
      action,
      entityId: entityId ?? null,
      stats,
    })
  } catch (error: unknown) {
    // Log full error details server-side only
    searchError('search.reindex', 'Failed', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      tenantId: tenantId,
    })

    // Record error to indexer error logs
    await recordIndexerError(
      { em },
      {
        source: 'fulltext',
        handler: 'api:search.reindex',
        error,
        entityType: entityId ?? null,
        tenantId: tenantId,
        organizationId: auth.orgId ?? null,
        payload: { action, entityId, useQueue },
      },
    )

    // Return generic message to client - don't expose internal error details
    return toJson(
      { error: t('search.api.errors.reindexFailed', 'Reindex operation failed. Please try again or contact support.') },
      { status: 500 }
    )
  } finally {
    // Only clear lock immediately if NOT using queue mode
    // When using queue mode, workers update heartbeat and stale detection handles cleanup
    if (!useQueue) {
      await clearReindexLock(knex, tenantId, 'fulltext', auth.orgId ?? null)
    }

    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}

export const openApi = reindexOpenApi
