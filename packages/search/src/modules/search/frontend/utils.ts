import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { SearchResult, SearchStrategyId } from '@open-mercato/shared/modules/search'

export type HybridSearchResponse = {
  results: SearchResult[]
  strategiesUsed: string[]
  timing: number
  error?: string | null
}

export type FetchHybridSearchOptions = {
  limit?: number
  strategies?: SearchStrategyId[]
  signal?: AbortSignal
}

export async function fetchHybridSearchResults(
  query: string,
  opts: FetchHybridSearchOptions = {}
): Promise<HybridSearchResponse> {
  const params = new URLSearchParams()
  params.set('q', query)

  const limit = Math.max(1, Math.min(opts.limit ?? 50, 100))
  params.set('limit', String(limit))

  if (opts.strategies && opts.strategies.length > 0) {
    params.set('strategies', opts.strategies.join(','))
  }

  const body = await readApiResultOrThrow<{
    results?: SearchResult[]
    strategiesUsed?: string[]
    timing?: number
    error?: string
  }>(
    `/api/search/search?${params.toString()}`,
    { signal: opts.signal },
    { errorMessage: 'Hybrid search failed', allowNullResult: true }
  )

  return {
    results: Array.isArray(body?.results) ? body.results : [],
    strategiesUsed: Array.isArray(body?.strategiesUsed) ? body.strategiesUsed : [],
    timing: typeof body?.timing === 'number' ? body.timing : 0,
    error: typeof body?.error === 'string' ? body.error : null,
  }
}

/**
 * Fetch global search results for the Cmd+K dialog.
 * Uses the hybrid search API with configurable strategies.
 */
export type FetchGlobalSearchOptions = {
  limit?: number
  strategies?: SearchStrategyId[]
  signal?: AbortSignal
}

export async function fetchGlobalSearchResults(
  query: string,
  opts: FetchGlobalSearchOptions = {}
): Promise<{ results: SearchResult[]; error?: string | null }> {
  const params = new URLSearchParams()
  params.set('q', query)

  const limit = Math.max(1, Math.min(opts.limit ?? 10, 50))
  params.set('limit', String(limit))

  if (opts.strategies && opts.strategies.length > 0) {
    params.set('strategies', opts.strategies.join(','))
  }

  const body = await readApiResultOrThrow<{
    results?: SearchResult[]
    error?: string
  }>(
    `/api/search/search?${params.toString()}`,
    { signal: opts.signal },
    { errorMessage: 'Search failed', allowNullResult: true }
  )

  return {
    results: Array.isArray(body?.results) ? body.results : [],
    error: typeof body?.error === 'string' ? body.error : null,
  }
}
