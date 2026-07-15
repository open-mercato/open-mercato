import { z } from 'zod'

export const webSearchOptionsSchema = z.object({
  limit: z.number().int().min(1).max(50).optional(),
  timeoutMs: z.number().int().positive().optional(),
})
export type WebSearchOptions = z.infer<typeof webSearchOptionsSchema>

export const webSearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  score: z.number().optional(),
})
export type WebSearchResult = z.infer<typeof webSearchResultSchema>

export const webFetchOptionsSchema = z.object({
  maxBytes: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
})
export type WebFetchOptions = z.infer<typeof webFetchOptionsSchema>

export const webFetchResultSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  text: z.string(),
  truncated: z.boolean(),
})
export type WebFetchResult = z.infer<typeof webFetchResultSchema>

export const providerHealthSchema = z.object({
  ok: z.boolean(),
  detail: z.string().optional(),
})
export type ProviderHealth = z.infer<typeof providerHealthSchema>

/**
 * A governed web-egress provider. Ships as SearXNG by default; keyed adapters
 * (Exa/Tavily) may implement the same interface. `fetch` is intentionally part
 * of the "search provider" surface — the package name understates it on purpose
 * (see spec 2026-07-11-agent-web-search-tool). Providers that support only one
 * mode MUST throw `WebSearchProviderError('unsupported', …)` from the other.
 */
export interface WebSearchProvider {
  readonly id: string
  search(query: string, opts?: WebSearchOptions): Promise<WebSearchResult[]>
  fetch(url: string, opts?: WebFetchOptions): Promise<WebFetchResult>
  healthCheck(): Promise<ProviderHealth>
}
