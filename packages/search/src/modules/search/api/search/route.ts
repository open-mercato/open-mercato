import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { SearchService } from '@open-mercato/search'
import type { SearchStrategyId } from '@open-mercato/shared/modules/search'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['search.view'] },
}

function parseLimit(value: string | null): number {
  if (!value) return 50
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed <= 0) return 50
  return Math.min(parsed, 100)
}

function parseStrategies(value: string | null): SearchStrategyId[] | undefined {
  if (!value) return undefined
  const strategies = value.split(',').map((s) => s.trim()).filter(Boolean)
  return strategies.length > 0 ? strategies : undefined
}

export async function GET(req: Request) {
  const { t } = await resolveTranslations()
  const url = new URL(req.url)
  const query = (url.searchParams.get('q') || '').trim()
  const limit = parseLimit(url.searchParams.get('limit'))
  const strategies = parseStrategies(url.searchParams.get('strategies'))

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

    const startTime = Date.now()

    // For the playground, we don't filter by organization to show all results
    // This can be made configurable via query param in the future
    const searchOptions = {
      tenantId: auth.tenantId,
      organizationId: null, // Don't filter by organization in playground
      limit,
      strategies,
    }

    console.log('[search.search] executing', {
      query,
      tenantId: searchOptions.tenantId,
      organizationId: searchOptions.organizationId,
      strategies: searchOptions.strategies,
      limit: searchOptions.limit,
    })

    const results = await searchService.search(query, searchOptions)

    const timing = Date.now() - startTime

    // Collect unique strategies that returned results
    const strategiesUsed = [...new Set(results.map((r) => r.source))]

    return NextResponse.json({
      results,
      strategiesUsed,
      timing,
      query,
      limit,
    })
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : t('search.api.errors.searchFailed', 'Search failed')
    console.error('[search.search] failed', error)
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}
