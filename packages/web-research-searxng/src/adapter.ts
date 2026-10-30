import {
  CONTRACT_VERSION,
  READY,
  defineAdapterModule,
  notReady,
  searchOk,
  stripTrailingSlashes,
  toOutcomeFailure,
  type RawResult,
  type SearchAdapter,
  type SearchOutcome,
} from '@open-mercato/web-research'
import { z } from 'zod'

/**
 * Client for an operator's OWN SearXNG instance. Only the client ships here —
 * SearXNG is AGPL-3.0, so calling one over HTTP is fine but bundling the server
 * would be distribution.
 */
export const searxngOptionsSchema = z.object({
  baseUrl: z.url().optional(),
  /** SearXNG engine names to restrict the query to, e.g. ["duckduckgo","brave"]. */
  engines: z.array(z.string().min(1)).optional(),
  language: z.string().min(2).max(16).optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
})

export type SearxngOptions = z.infer<typeof searxngOptionsSchema>

const DEFAULT_TIMEOUT_MS = 12_000

const responseSchema = z.object({
  results: z
    .array(
      z.object({
        url: z.string().nullish(),
        title: z.string().nullish(),
        content: z.string().nullish(),
        score: z.number().nullish(),
        publishedDate: z.string().nullish(),
      }),
    )
    .nullish(),
})

const TIME_RANGE: Readonly<Record<string, string>> = {
  day: 'day',
  week: 'week',
  month: 'month',
  year: 'year',
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

export function createSearxngAdapter(options: SearxngOptions): SearchAdapter {
  const baseUrl = options.baseUrl ? stripTrailingSlashes(options.baseUrl) : ''
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    id: 'searxng',
    kind: 'serp',
    capabilities: {
      search: true,
      fetch: false,
      snippets: true,
      content: false,
      freshness: true,
      siteFilter: true,
      cost: 'free',
    },
    /** `free` — pings /healthz on infrastructure the tenant runs itself. */
    probeCost: 'free' as const,
    readiness: () => (baseUrl.length > 0 ? READY : notReady('SearXNG base URL is not set')),

    async search(request, context): Promise<SearchOutcome> {
      if (baseUrl.length === 0) return { status: 'unavailable', reason: 'SearXNG base URL is not set' }
      try {
        const url = new URL(`${baseUrl}/search`)
        url.searchParams.set('q', request.site ? `${request.query} site:${request.site}` : request.query)
        url.searchParams.set('format', 'json')
        if (options.engines?.length) url.searchParams.set('engines', options.engines.join(','))
        if (options.language ?? request.locale) {
          url.searchParams.set('language', options.language ?? (request.locale as string))
        }
        if (request.freshness && TIME_RANGE[request.freshness]) {
          url.searchParams.set('time_range', TIME_RANGE[request.freshness])
        }

        const response = await context.http.request(url.toString(), {
          accept: ['application/json'],
          timeoutMs,
          signal: context.signal,
        })
        const parsed = responseSchema.safeParse(parseJson(response.body))
        if (!parsed.success) {
          return {
            status: 'error',
            reason: 'SearXNG returned an unrecognized response shape (is the JSON format enabled?)',
            retriable: false,
          }
        }
        const results: RawResult[] = []
        for (const item of parsed.data.results ?? []) {
          if (!item.url) continue
          results.push({
            url: item.url,
            title: item.title ?? null,
            snippet: item.content ?? null,
            publishedAt: item.publishedDate ?? null,
            score: item.score ?? null,
          })
          if (results.length >= request.limit) break
        }
        context.report('ok', `SearXNG returned ${results.length} result(s)`, { resultCount: results.length })
        return searchOk(results)
      } catch (error) {
        return toOutcomeFailure(error)
      }
    },

    async healthCheck(context) {
      if (baseUrl.length === 0) return { ok: false, detail: 'SearXNG base URL is not set' }
      try {
        await context.http.request(`${baseUrl}/healthz`, { timeoutMs, signal: context.signal })
        return { ok: true }
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

export const searxngAdapterModule = defineAdapterModule({
  id: 'searxng',
  kind: 'serp',
  contractVersion: CONTRACT_VERSION,
  optionsSchema: searxngOptionsSchema,
  createAdapter: createSearxngAdapter,
})
