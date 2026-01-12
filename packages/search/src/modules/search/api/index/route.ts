import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import type { SearchIndexer } from '../../../../indexer/search-indexer'
import type { SearchService } from '../../../../service'
import { recordIndexerLog } from '@open-mercato/shared/lib/indexers/status-log'
import { writeCoverageCounts } from '@open-mercato/core/modules/query_index/lib/coverage'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { VectorSearchStrategy } from '../../../../strategies/vector.strategy'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { searchDebugWarn, searchError } from '../../../../lib/debug'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['search.view'] },
  DELETE: { requireAuth: true, requireFeatures: ['search.embeddings.manage'] },
}

function parseLimit(value: string | null): number {
  if (!value) return 50
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed <= 0) return 50
  return Math.min(parsed, 200)
}

function parseOffset(value: string | null): number {
  if (!value) return 0
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 0) return 0
  return parsed
}

export async function GET(req: Request) {
  const { t } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }

  const url = new URL(req.url)
  const entityIdParam = url.searchParams.get('entityId')
  const limit = parseLimit(url.searchParams.get('limit'))
  const offset = parseOffset(url.searchParams.get('offset'))

  const container = await createRequestContainer()
  try {
    // Get the vector strategy from search service
    let searchService: SearchService
    try {
      searchService = container.resolve('searchService') as SearchService
    } catch {
      return NextResponse.json(
        { error: t('search.api.errors.serviceUnavailable', 'Search service unavailable') },
        { status: 503 }
      )
    }

    // Access vector strategy for listing entries
    const strategies = searchService.getStrategies()
    const vectorStrategy = strategies.find((s) => s.id === 'vector') as VectorSearchStrategy | undefined

    if (!vectorStrategy) {
      return NextResponse.json(
        { error: t('search.api.errors.vectorUnavailable', 'Vector strategy not configured') },
        { status: 503 }
      )
    }

    const isAvailable = await vectorStrategy.isAvailable()
    if (!isAvailable) {
      return NextResponse.json(
        { error: t('search.api.errors.vectorUnavailable', 'Vector strategy not available') },
        { status: 503 }
      )
    }

    // List vector entries via the strategy
    const entries = await vectorStrategy.listEntries({
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
      entityId: entityIdParam ?? undefined,
      limit,
      offset,
    })

    return NextResponse.json({ entries, limit, offset })
  } catch (error: unknown) {
    const err = error as { status?: number; statusCode?: number }
    const status = typeof err?.status === 'number'
      ? err.status
      : (typeof err?.statusCode === 'number' ? err.statusCode : 500)
    searchError('search.index.list', 'failed', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      { error: t('search.api.errors.indexFetchFailed', 'Failed to fetch vector index. Please try again.') },
      { status: status >= 400 ? status : 500 }
    )
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}

export async function DELETE(req: Request) {
  const { t } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }

  const url = new URL(req.url)
  const entityIdParam = url.searchParams.get('entityId')
  const confirmAll = url.searchParams.get('confirmAll') === 'true'

  // Require explicit confirmation when purging ALL entities (dangerous operation)
  if (!entityIdParam && !confirmAll) {
    return NextResponse.json(
      { error: t('search.api.errors.confirmAllRequired', 'Purging all entities requires confirmAll=true parameter.') },
      { status: 400 }
    )
  }

  const container = await createRequestContainer()
  try {
    let searchIndexer: SearchIndexer
    try {
      searchIndexer = container.resolve('searchIndexer') as SearchIndexer
    } catch {
      return NextResponse.json(
        { error: t('search.api.errors.indexUnavailable', 'Search indexer unavailable') },
        { status: 503 }
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let em: any = null
    try {
      em = container.resolve('em')
    } catch {
      // em not available
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let eventBus: { emitEvent(event: string, payload: any, options?: any): Promise<void> } | null = null
    try {
      eventBus = container.resolve('eventBus')
    } catch {
      eventBus = null
    }

    const entityIds = entityIdParam
      ? [entityIdParam]
      : searchIndexer.listEnabledEntities()

    const scopes = new Set<string>()
    const registerScope = (org: string | null) => {
      const key = org ?? '__null__'
      if (!scopes.has(key)) scopes.add(key)
    }
    registerScope(null)
    if (auth.orgId) registerScope(auth.orgId)

    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'vector',
        handler: 'api:search.index.purge',
        message: entityIdParam
          ? `Vector purge requested for ${entityIdParam}`
          : 'Vector purge requested for all entities',
        entityType: entityIdParam ?? null,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        details: { entityIds },
      },
    ).catch(() => undefined)

    // Purge each entity using SearchIndexer
    for (const entityId of entityIds) {
      await searchIndexer.purgeEntity({
        entityId: entityId as EntityId,
        tenantId: auth.tenantId,
      })
    }

    // Update coverage counts
    if (em) {
      try {
        for (const entityId of entityIds) {
          for (const scope of scopes) {
            const orgValue = scope === '__null__' ? null : scope
            await writeCoverageCounts(
              em,
              {
                entityType: entityId,
                tenantId: auth.tenantId,
                organizationId: orgValue,
                withDeleted: false,
              },
              { vectorCount: 0 },
            )
          }
        }
      } catch (coverageError) {
        searchDebugWarn('search.index.purge', 'Failed to reset coverage after purge', {
          error: coverageError instanceof Error ? coverageError.message : coverageError,
        })
      }
    }

    // Emit coverage refresh events
    if (eventBus) {
      await Promise.all(
        entityIds.flatMap((entityId) =>
          Array.from(scopes).map((scope) => {
            const orgValue = scope === '__null__' ? null : scope
            return eventBus!
              .emitEvent(
                'query_index.coverage.refresh',
                {
                  entityType: entityId,
                  tenantId: auth.tenantId,
                  organizationId: orgValue,
                  delayMs: 0,
                },
              )
              .catch(() => undefined)
          }),
        ),
      )
    }

    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'vector',
        handler: 'api:search.index.purge',
        message: entityIdParam
          ? `Vector purge completed for ${entityIdParam}`
          : 'Vector purge completed for all entities',
        entityType: entityIdParam ?? null,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        details: { entityIds },
      },
    ).catch(() => undefined)

    return NextResponse.json({ ok: true })
  } catch (error: unknown) {
    const err = error as { status?: number; statusCode?: number }
    const status = typeof err?.status === 'number'
      ? err.status
      : (typeof err?.statusCode === 'number' ? err.statusCode : 500)
    const errorMessage = error instanceof Error ? error.message : String(error)
    searchError('search.index.purge', 'failed', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let em: any = null
    try {
      em = container.resolve('em')
    } catch {
      // em not available
    }

    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'vector',
        handler: 'api:search.index.purge',
        level: 'warn',
        message: entityIdParam
          ? `Vector purge failed for ${entityIdParam}`
          : 'Vector purge failed for all entities',
        entityType: entityIdParam ?? null,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        details: { error: errorMessage },
      },
    ).catch(() => undefined)

    return NextResponse.json(
      { error: t('search.api.errors.purgeFailed', 'Vector index purge failed. Please try again.') },
      { status: status >= 400 ? status : 500 }
    )
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}
