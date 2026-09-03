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

export const tavilyOptionsSchema = z.object({
  apiKey: z.string().min(1).optional(),
  baseUrl: z.url().optional(),
  searchDepth: z.enum(['basic', 'advanced']).optional(),
  includeContent: z.boolean().optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
})

export type TavilyOptions = z.infer<typeof tavilyOptionsSchema>

const DEFAULT_BASE_URL = 'https://api.tavily.com'
const DEFAULT_TIMEOUT_MS = 15_000

const responseSchema = z.object({
  answer: z.string().nullish(),
  results: z
    .array(
      z.object({
        url: z.string(),
        title: z.string().nullish(),
        content: z.string().nullish(),
        raw_content: z.string().nullish(),
        score: z.number().nullish(),
        published_date: z.string().nullish(),
      }),
    )
    .nullish(),
})

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

export function createTavilyAdapter(options: TavilyOptions): SearchAdapter {
  const apiKey = options.apiKey?.trim() ?? ''
  const baseUrl = stripTrailingSlashes(options.baseUrl ?? DEFAULT_BASE_URL)
  const searchDepth = options.searchDepth ?? 'basic'
  const includeContent = options.includeContent ?? false
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    id: 'tavily',
    kind: 'api',
    capabilities: {
      search: true,
      fetch: false,
      snippets: true,
      content: includeContent,
      freshness: false,
      siteFilter: true,
      cost: 'metered',
    },
    /** `billable` — issues a real /search query. */
    probeCost: 'billable' as const,
    readiness: () => (apiKey.length > 0 ? READY : notReady('Tavily API key is not set')),

    async search(request, context): Promise<SearchOutcome> {
      if (apiKey.length === 0) return { status: 'unavailable', reason: 'Tavily API key is not set' }
      try {
        const response = await context.http.request(`${baseUrl}/search`, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            query: request.site ? `${request.query} site:${request.site}` : request.query,
            max_results: request.limit,
            search_depth: searchDepth,
            include_answer: true,
            include_raw_content: includeContent,
          }),
          accept: ['application/json'],
          timeoutMs,
          signal: context.signal,
        })
        const parsed = responseSchema.safeParse(parseJson(response.body))
        if (!parsed.success) {
          return { status: 'error', reason: 'Tavily returned an unrecognized response shape', retriable: false }
        }
        const results: RawResult[] = (parsed.data.results ?? []).map((item) => ({
          url: item.url,
          title: item.title ?? null,
          snippet: item.content ?? null,
          content: item.raw_content ?? null,
          publishedAt: item.published_date ?? null,
          score: item.score ?? null,
        }))
        context.report('ok', `Tavily returned ${results.length} result(s)`, { resultCount: results.length })
        return searchOk(results, parsed.data.answer ?? undefined)
      } catch (error) {
        return toOutcomeFailure(error)
      }
    },

    async healthCheck(context) {
      if (apiKey.length === 0) return { ok: false, detail: 'Tavily API key is not set' }
      try {
        await context.http.request(`${baseUrl}/search`, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ query: 'open mercato health check', max_results: 1 }),
          accept: ['application/json'],
          timeoutMs,
          signal: context.signal,
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

export const tavilyAdapterModule = defineAdapterModule({
  id: 'tavily',
  kind: 'api',
  contractVersion: CONTRACT_VERSION,
  optionsSchema: tavilyOptionsSchema,
  createAdapter: createTavilyAdapter,
})
