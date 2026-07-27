import { z } from 'zod'
import { WebSearchProviderError } from './errors'
import { fetchUrl, httpRequest } from './fetch'
import { type LookupFn } from './ssrf'
import type {
  ProviderHealth,
  WebFetchOptions,
  WebFetchResult,
  WebSearchOptions,
  WebSearchProvider,
  WebSearchResult,
} from './types'

const DEFAULT_LIMIT = 10
const DEFAULT_MAX_BYTES = 64 * 1024
const DEFAULT_TIMEOUT_MS = 10_000

export type SearxngProviderConfig = {
  /** Base URL of the trusted, operator-run SearXNG instance (JSON output enabled). */
  baseUrl: string
  defaultLimit?: number
  defaultMaxBytes?: number
  defaultTimeoutMs?: number
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch
  /** Injectable DNS lookup for the SSRF guard; defaults to node:dns. */
  lookup?: LookupFn
}

const searxngResponseSchema = z.object({
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

export class SearxngProvider implements WebSearchProvider {
  readonly id = 'searxng'
  private readonly baseUrl: string
  private readonly defaultLimit: number
  private readonly defaultMaxBytes: number
  private readonly defaultTimeoutMs: number
  private readonly fetchFn: typeof fetch
  private readonly lookup?: LookupFn

  constructor(config: SearxngProviderConfig) {
    if (!config.baseUrl) {
      throw new WebSearchProviderError('provider_unhealthy', 'SearXNG baseUrl is not configured')
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.defaultLimit = config.defaultLimit ?? DEFAULT_LIMIT
    this.defaultMaxBytes = config.defaultMaxBytes ?? DEFAULT_MAX_BYTES
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchFn = config.fetchFn ?? fetch
    this.lookup = config.lookup
  }

  async search(query: string, opts: WebSearchOptions = {}): Promise<WebSearchResult[]> {
    const limit = opts.limit ?? this.defaultLimit
    const url = new URL(`${this.baseUrl}/search`)
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')

    const response = await httpRequest(this.fetchFn, url.toString(), {
      timeoutMs: opts.timeoutMs ?? this.defaultTimeoutMs,
    })
    if (!response.ok) {
      throw new WebSearchProviderError('bad_response', `SearXNG search failed with status ${response.status}`)
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new WebSearchProviderError('bad_response', 'SearXNG returned a non-JSON response')
    }

    const parsed = searxngResponseSchema.safeParse(payload)
    if (!parsed.success) {
      throw new WebSearchProviderError('bad_response', 'SearXNG response did not match the expected shape')
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
  }

  fetch(rawUrl: string, opts: WebFetchOptions = {}): Promise<WebFetchResult> {
    return fetchUrl(
      rawUrl,
      { maxBytes: opts.maxBytes ?? this.defaultMaxBytes, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : { timeoutMs: this.defaultTimeoutMs }) },
      { fetchFn: this.fetchFn, lookup: this.lookup },
    )
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const response = await httpRequest(this.fetchFn, `${this.baseUrl}/healthz`, { timeoutMs: this.defaultTimeoutMs })
      if (response.ok) return { ok: true }
      return { ok: false, detail: `SearXNG health returned status ${response.status}` }
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown error'
      return { ok: false, detail }
    }
  }
}

export function createSearxngProvider(config: SearxngProviderConfig): SearxngProvider {
  return new SearxngProvider(config)
}
