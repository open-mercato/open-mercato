import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { SearchService } from '@open-mercato/search'
import type { EmbeddingService } from '../../../../../vector'
import { resolveEmbeddingConfig } from '../../../lib/embedding-config'
import { resolveGlobalSearchStrategies } from '../../../lib/global-search-config'
import { searchError } from '../../../../../lib/debug'
import { globalSearchOpenApi } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['search.view'] },
}

function parseLimit(value: string | null): number {
  if (!value) return 50
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed <= 0) return 50
  return Math.min(parsed, 100)
}

function parseEntityTypes(value: string | null): string[] | undefined {
  if (!value) return undefined
  const entityTypes = value.split(',').map((s) => s.trim()).filter(Boolean)
  return entityTypes.length > 0 ? entityTypes : undefined
}

/**
 * Global search endpoint for Cmd+K.
 * Always uses saved global search settings - does NOT accept strategies from URL.
 */
export async function GET(req: Request) {
  const { t } = await resolveTranslations()
  const url = new URL(req.url)
  const query = (url.searchParams.get('q') || '').trim()
  const limit = parseLimit(url.searchParams.get('limit'))
  const entityTypes = parseEntityTypes(url.searchParams.get('entityTypes'))

  if (!query) {
    return NextResponse.json(
      { error: t('search.api.errors.missingQuery', 'Missing query') },
      { status: 400 }
    )
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json(
      { error: t('api.errors.unauthorized', 'Unauthorized') },
      { status: 401 }
    )
  }

  const container = await createRequestContainer()
  try {
    const searchService = container.resolve('searchService') as SearchService | undefined
    if (!searchService) {
      return NextResponse.json(
        { error: t('search.api.errors.serviceUnavailable', 'Search service unavailable') },
        { status: 503 }
      )
    }

    // Fetch saved global search strategies
    const strategies = await resolveGlobalSearchStrategies(container)

    // Load embedding config for vector strategy (only if vector is enabled)
    if (strategies.includes('vector')) {
      try {
        const embeddingConfig = await resolveEmbeddingConfig(container, { defaultValue: null })
        if (embeddingConfig) {
          const embeddingService = container.resolve<EmbeddingService>('vectorEmbeddingService')
          embeddingService.updateConfig(embeddingConfig)
        }
      } catch {
        // Embedding config not available, vector strategy may not work
      }
    }

    const startTime = Date.now()

    const searchOptions = {
      tenantId: auth.tenantId,
      organizationId: null,
      limit,
      strategies,
      entityTypes,
    }

    const results = await searchService.search(query, searchOptions)

    const timing = Date.now() - startTime

    // Collect unique strategies that returned results
    const strategiesUsed = [...new Set(results.map((r) => r.source))]

    return NextResponse.json({
      results,
      strategiesUsed,
      strategiesEnabled: strategies,
      timing,
      query,
      limit,
    })
  } catch (error: unknown) {
    searchError('search.api.global', 'failed', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      { error: t('search.api.errors.searchFailed', 'Search failed. Please try again.') },
      { status: 500 }
    )
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}

export const openApi = globalSearchOpenApi
