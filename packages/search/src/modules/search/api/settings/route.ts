import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { SearchService } from '@open-mercato/search'
import type { FullTextSearchStrategy } from '@open-mercato/search/strategies'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['search.view'] },
}

type StrategyStatus = {
  id: string
  name: string
  priority: number
  available: boolean
}

type FulltextStats = {
  numberOfDocuments: number
  isIndexing: boolean
  fieldDistribution: Record<string, number>
}

type SearchSettings = {
  strategies: StrategyStatus[]
  fulltextConfigured: boolean
  fulltextStats: FulltextStats | null
  vectorConfigured: boolean
  tokensEnabled: boolean
  defaultStrategies: string[]
}

type SettingsResponse = {
  settings: SearchSettings
}

const toJson = (payload: SettingsResponse, init?: ResponseInit) => NextResponse.json(payload, init)

const unauthorized = async () => {
  const { t } = await resolveTranslations()
  return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) return await unauthorized()

  const container = await createRequestContainer()
  try {
    const strategies: StrategyStatus[] = []
    let defaultStrategies: string[] = []
    let fulltextStats: FulltextStats | null = null

    try {
      const searchService = container.resolve('searchService') as SearchService | undefined
      const searchStrategies = container.resolve('searchStrategies') as unknown[] | undefined

      if (searchStrategies) {
        for (const strategy of searchStrategies) {
          const s = strategy as { id?: string; name?: string; priority?: number; isAvailable?: () => Promise<boolean> }
          const available = await s.isAvailable?.() ?? true
          strategies.push({
            id: s.id ?? 'unknown',
            name: s.name ?? s.id ?? 'unknown',
            priority: s.priority ?? 0,
            available,
          })
        }

        // Get fulltext stats if available and tenant is set
        if (auth.tenantId) {
          const fulltextStrategy = searchStrategies.find(
            (s: unknown) => (s as { id?: string })?.id === 'fulltext'
          ) as FullTextSearchStrategy | undefined

          if (fulltextStrategy) {
            try {
              const stats = await fulltextStrategy.getIndexStats(auth.tenantId)
              if (stats) {
                fulltextStats = stats
              }
            } catch {
              // Stats not available
            }
          }
        }
      }

      if (searchService) {
        defaultStrategies = searchService.getDefaultStrategies?.() ?? []
      }
    } catch {
      // Search service may not be available
    }

    const fulltextConfigured = Boolean(
      process.env.MEILISEARCH_HOST && process.env.MEILISEARCH_HOST.trim().length > 0
    )

    const vectorConfigured = Boolean(
      process.env.OPENAI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.MISTRAL_API_KEY ||
      process.env.COHERE_API_KEY ||
      process.env.AWS_ACCESS_KEY_ID ||
      process.env.OLLAMA_BASE_URL
    )

    const tokensEnabled = process.env.OM_SEARCH_ENABLED !== 'false'

    return toJson({
      settings: {
        strategies,
        fulltextConfigured,
        fulltextStats,
        vectorConfigured,
        tokensEnabled,
        defaultStrategies,
      },
    })
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}
