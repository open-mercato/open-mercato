import { z } from 'zod'
import {
  WebSearchProviderError,
  fetchUrl,
  httpRequest,
  type ProviderHealth,
  type WebFetchOptions,
  type WebFetchResult,
  type WebSearchOptions,
  type WebSearchProvider,
  type WebSearchResult,
} from '@open-mercato/web-search'

const DEFAULT_LIMIT = 10
const DEFAULT_TIMEOUT_MS = 10_000
const TAVILY_ENDPOINT = 'https://api.tavily.com/search'

export type TavilyProviderConfig = {
  apiKey: string
  defaultLimit?: number
  defaultMaxBytes?: number
  defaultTimeoutMs?: number
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch
}

const tavilyResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().optional(),
        url: z.string().optional(),
        content: z.string().optional(),
        score: z.number().optional(),
      }),
    )
    .optional(),
})

/**
 * Keyed adapter (Flavor A) for Tavily — an AI-agent-focused search API that
 * returns cleaned, extracted content. Opt-in upgrade over the model-native
 * default: set `OM_AGENT_WEB_SEARCH_PROVIDER=tavily` + `OM_AGENT_WEB_SEARCH_TAVILY_API_KEY`.
 * `fetch` delegates to the shared provider-independent `fetchUrl`.
 */
export function createTavilyProvider(config: TavilyProviderConfig): WebSearchProvider {
  if (!config.apiKey) {
    throw new WebSearchProviderError('provider_unhealthy', 'Tavily API key is not configured')
  }
  const defaultLimit = config.defaultLimit ?? DEFAULT_LIMIT
  const defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchFn = config.fetchFn ?? fetch

  const request = async (query: string, limit: number, timeoutMs: number): Promise<Response> => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetchFn(TAVILY_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ query, max_results: limit, search_depth: 'basic' }),
        signal: controller.signal,
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new WebSearchProviderError('timeout', 'Tavily request timed out')
      }
      const detail = err instanceof Error ? err.message : 'unknown error'
      throw new WebSearchProviderError('bad_response', `Tavily request failed: ${detail}`)
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    id: 'tavily',
    async search(query: string, opts: WebSearchOptions = {}): Promise<WebSearchResult[]> {
      const limit = opts.limit ?? defaultLimit
      const response = await request(query, limit, opts.timeoutMs ?? defaultTimeoutMs)
      if (!response.ok) {
        throw new WebSearchProviderError('bad_response', `Tavily search failed with status ${response.status}`)
      }
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw new WebSearchProviderError('bad_response', 'Tavily returned a non-JSON response')
      }
      const parsed = tavilyResponseSchema.safeParse(payload)
      if (!parsed.success) {
        throw new WebSearchProviderError('bad_response', 'Tavily response did not match the expected shape')
      }
      const results: WebSearchResult[] = []
      for (const item of parsed.data.results ?? []) {
        if (!item.url) continue
        results.push({
          title: item.title ?? item.url,
          url: item.url,
          snippet: item.content ?? '',
          ...(typeof item.score === 'number' ? { score: item.score } : {}),
        })
        if (results.length >= limit) break
      }
      return results
    },
    fetch(url: string, opts: WebFetchOptions = {}): Promise<WebFetchResult> {
      return fetchUrl(url, {
        maxBytes: opts.maxBytes ?? config.defaultMaxBytes,
        ...(opts.timeoutMs ?? config.defaultTimeoutMs ? { timeoutMs: opts.timeoutMs ?? config.defaultTimeoutMs } : {}),
      })
    },
    async healthCheck(): Promise<ProviderHealth> {
      try {
        const response = await httpRequest(fetchFn, TAVILY_ENDPOINT, { timeoutMs: defaultTimeoutMs, redirect: 'manual' })
        // Any HTTP response (even 4xx for the GET) proves reachability; network errors throw.
        return response.status < 500 ? { ok: true } : { ok: false, detail: `Tavily returned status ${response.status}` }
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : 'unavailable' }
      }
    },
  }
}
