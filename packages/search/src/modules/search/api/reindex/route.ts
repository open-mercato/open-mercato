import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { MeilisearchStrategy } from '@open-mercato/search/strategies/meilisearch.strategy'
import type { SearchIndexer } from '@open-mercato/search/indexer'
import type { EntityId } from '@open-mercato/shared/modules/entities'

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

  let payload: { action?: ReindexAction; entityId?: string } = {}
  try {
    payload = await req.json()
  } catch {
    // Default to reindex
  }

  const action: ReindexAction =
    payload.action === 'clear' ? 'clear' :
    payload.action === 'recreate' ? 'recreate' : 'reindex'
  const entityId = typeof payload.entityId === 'string' ? payload.entityId : undefined

  const container = await createRequestContainer()
  try {
    // Get the Meilisearch strategy
    const searchStrategies = container.resolve('searchStrategies') as unknown[] | undefined
    const meilisearchStrategy = searchStrategies?.find(
      (s: unknown) => (s as { id?: string })?.id === 'meilisearch'
    ) as MeilisearchStrategy | undefined

    if (!meilisearchStrategy) {
      return toJson(
        { error: t('search.api.errors.meilisearchUnavailable', 'Meilisearch is not configured') },
        { status: 503 }
      )
    }

    // Check if Meilisearch is available
    const isAvailable = await meilisearchStrategy.isAvailable()
    if (!isAvailable) {
      return toJson(
        { error: t('search.api.errors.meilisearchUnavailable', 'Meilisearch is not available') },
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
      const orgId = typeof auth.organizationId === 'string' ? auth.organizationId : null
      if (entityId) {
        // Reindex specific entity
        result = await searchIndexer.reindexEntityToMeilisearch({
          entityId: entityId as EntityId,
          tenantId: auth.tenantId,
          organizationId: orgId,
          recreateIndex: true,
        })
        console.log('[search.reindex] Reindexed entity to Meilisearch', {
          entityId,
          tenantId: auth.tenantId,
          recordsIndexed: result.recordsIndexed,
        })
      } else {
        // Reindex all entities
        result = await searchIndexer.reindexAllToMeilisearch({
          tenantId: auth.tenantId,
          organizationId: orgId,
          recreateIndex: true,
        })
        console.log('[search.reindex] Reindexed all entities to Meilisearch', {
          tenantId: auth.tenantId,
          entitiesProcessed: result.entitiesProcessed,
          recordsIndexed: result.recordsIndexed,
        })
      }

      // Get updated stats
      const stats = await meilisearchStrategy.getIndexStats(auth.tenantId)

      return toJson({
        ok: result.success,
        action,
        entityId: entityId ?? null,
        result: {
          entitiesProcessed: result.entitiesProcessed,
          recordsIndexed: result.recordsIndexed,
          errors: result.errors.length > 0 ? result.errors : undefined,
        },
        stats,
      })
    } else if (entityId) {
      // Purge specific entity
      await meilisearchStrategy.purge(entityId, auth.tenantId)
      console.log('[search.reindex] Purged entity from Meilisearch', { entityId, tenantId: auth.tenantId })
    } else if (action === 'clear') {
      // Clear all documents but keep index
      await meilisearchStrategy.clearIndex(auth.tenantId)
      console.log('[search.reindex] Cleared Meilisearch index', { tenantId: auth.tenantId })
    } else {
      // Recreate the entire index
      await meilisearchStrategy.recreateIndex(auth.tenantId)
      console.log('[search.reindex] Recreated Meilisearch index', { tenantId: auth.tenantId })
    }

    // Get updated stats
    const stats = await meilisearchStrategy.getIndexStats(auth.tenantId)

    return toJson({
      ok: true,
      action,
      entityId: entityId ?? null,
      stats,
    })
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[search.reindex] Failed', { error: errorMessage, tenantId: auth.tenantId })
    return toJson(
      { error: t('search.api.errors.reindexFailed', 'Failed to reindex: ') + errorMessage },
      { status: 500 }
    )
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}
