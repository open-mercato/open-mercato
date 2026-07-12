import { z } from 'zod'
import { WebSearchProviderError } from './errors'
import { extractTitle, htmlToText } from './html-to-text'
import { assertPublicUrl, type LookupFn } from './ssrf'
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
const MAX_REDIRECTS = 5

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

    const response = await this.request(url.toString(), opts.timeoutMs)
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

  async fetch(rawUrl: string, opts: WebFetchOptions = {}): Promise<WebFetchResult> {
    const maxBytes = opts.maxBytes ?? this.defaultMaxBytes
    let currentUrl = (await assertPublicUrl(rawUrl, { lookup: this.lookup })).toString()

    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const response = await this.request(currentUrl, opts.timeoutMs, 'manual')
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) {
          throw new WebSearchProviderError('bad_response', 'Redirect response without a Location header')
        }
        const nextUrl = new URL(location, currentUrl)
        currentUrl = (await assertPublicUrl(nextUrl.toString(), { lookup: this.lookup })).toString()
        continue
      }
      if (!response.ok) {
        throw new WebSearchProviderError('bad_response', `Fetch failed with status ${response.status}`)
      }
      const { text: body, truncated } = await readCappedText(response, maxBytes)
      return {
        url: currentUrl,
        ...(extractTitle(body) ? { title: extractTitle(body) } : {}),
        text: htmlToText(body),
        truncated,
      }
    }
    throw new WebSearchProviderError('too_many_redirects', `Exceeded ${MAX_REDIRECTS} redirects`)
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const response = await this.request(`${this.baseUrl}/healthz`, this.defaultTimeoutMs)
      if (response.ok) return { ok: true }
      return { ok: false, detail: `SearXNG health returned status ${response.status}` }
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown error'
      return { ok: false, detail }
    }
  }

  private async request(url: string, timeoutMs: number | undefined, redirect: RequestRedirect = 'follow'): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs ?? this.defaultTimeoutMs)
    try {
      return await this.fetchFn(url, { signal: controller.signal, redirect })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new WebSearchProviderError('timeout', `Request to ${url} timed out`)
      }
      const detail = err instanceof Error ? err.message : 'Unknown error'
      throw new WebSearchProviderError('bad_response', `Request to ${url} failed: ${detail}`)
    } finally {
      clearTimeout(timeout)
    }
  }
}

async function readCappedText(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const body = response.body
  if (!body) {
    const full = await response.text()
    const encoded = new TextEncoder().encode(full)
    if (encoded.byteLength <= maxBytes) return { text: full, truncated: false }
    return { text: new TextDecoder().decode(encoded.slice(0, maxBytes)), truncated: true }
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  let truncated = false
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      const remaining = maxBytes - received
      if (value.byteLength > remaining) {
        chunks.push(value.slice(0, remaining))
        received += remaining
        truncated = true
        break
      }
      chunks.push(value)
      received += value.byteLength
    }
    if (!truncated) {
      const { done } = await reader.read()
      if (!done) truncated = true
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  const merged = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { text: new TextDecoder().decode(merged), truncated }
}

export function createSearxngProvider(config: SearxngProviderConfig): SearxngProvider {
  return new SearxngProvider(config)
}
