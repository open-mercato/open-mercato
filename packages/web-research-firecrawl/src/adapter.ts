import {
  CONTRACT_VERSION,
  READY,
  defineAdapterModule,
  notReady,
  searchOk,
  stripTrailingSlashes,
  toOutcomeFailure,
  type AdapterContext,
  type FetchOutcome,
  type FetchRequest,
  type RawResult,
  type SearchAdapter,
  type SearchOutcome,
} from '@open-mercato/web-research'
import { z } from 'zod'

export const firecrawlOptionsSchema = z.object({
  apiKey: z.string().min(1).optional(),
  baseUrl: z.url().optional(),
  /** Ask Firecrawl to return page content inline, sparing a second round trip. */
  includeContent: z.boolean().optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
})

export type FirecrawlOptions = z.infer<typeof firecrawlOptionsSchema>

const DEFAULT_BASE_URL = 'https://api.firecrawl.dev'
const DEFAULT_TIMEOUT_MS = 20_000

const searchResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z
    .array(
      z.object({
        url: z.string(),
        title: z.string().nullish(),
        description: z.string().nullish(),
        markdown: z.string().nullish(),
        publishedDate: z.string().nullish(),
      }),
    )
    .nullish(),
})

const scrapeResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z
    .object({
      markdown: z.string().nullish(),
      html: z.string().nullish(),
      metadata: z
        .object({
          title: z.string().nullish(),
          sourceURL: z.string().nullish(),
          statusCode: z.number().nullish(),
        })
        .nullish(),
    })
    .nullish(),
})

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

export function createFirecrawlAdapter(options: FirecrawlOptions): SearchAdapter {
  const apiKey = options.apiKey?.trim() ?? ''
  const baseUrl = stripTrailingSlashes(options.baseUrl ?? DEFAULT_BASE_URL)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const includeContent = options.includeContent ?? true

  const post = (path: string, payload: unknown, context: AdapterContext) =>
    context.http.request(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      accept: ['application/json'],
      timeoutMs,
      signal: context.signal,
    })

  return {
    id: 'firecrawl',
    kind: 'api',
    capabilities: {
      search: true,
      fetch: true,
      snippets: true,
      content: includeContent,
      freshness: false,
      siteFilter: true,
      cost: 'metered',
    },
    readiness: () => (apiKey.length > 0 ? READY : notReady('Firecrawl API key is not set')),

    async search(request, context): Promise<SearchOutcome> {
      if (apiKey.length === 0) return { status: 'unavailable', reason: 'Firecrawl API key is not set' }
      try {
        const query = request.site ? `${request.query} site:${request.site}` : request.query
        const response = await post(
          '/v1/search',
          {
            query,
            limit: request.limit,
            ...(includeContent ? { scrapeOptions: { formats: ['markdown'] } } : {}),
          },
          context,
        )
        const parsed = searchResponseSchema.safeParse(parseJson(response.body))
        if (!parsed.success) {
          return { status: 'error', reason: 'Firecrawl returned an unrecognized response shape', retriable: false }
        }
        const results: RawResult[] = (parsed.data.data ?? []).map((item) => ({
          url: item.url,
          title: item.title ?? null,
          snippet: item.description ?? null,
          content: item.markdown ?? null,
          publishedAt: item.publishedDate ?? null,
        }))
        context.report('ok', `Firecrawl returned ${results.length} result(s)`, { resultCount: results.length })
        return searchOk(results)
      } catch (error) {
        return toOutcomeFailure(error)
      }
    },

    async fetch(request: FetchRequest, context): Promise<FetchOutcome> {
      if (apiKey.length === 0) return { status: 'unavailable', reason: 'Firecrawl API key is not set' }
      try {
        const response = await post('/v1/scrape', { url: request.url, formats: ['markdown'] }, context)
        const parsed = scrapeResponseSchema.safeParse(parseJson(response.body))
        const data = parsed.success ? parsed.data.data : null
        const text = data?.markdown?.trim() ?? ''
        if (text.length === 0) {
          return { status: 'error', reason: 'Firecrawl returned no readable content', retriable: false }
        }
        return {
          status: 'ok',
          page: {
            url: data?.metadata?.sourceURL ?? request.url,
            title: data?.metadata?.title ?? null,
            text,
            contentType: 'text/markdown',
            status: data?.metadata?.statusCode ?? 200,
            truncated: false,
            // Firecrawl renders server-side, so content that needed JavaScript
            // arrives without us running a browser at all.
            renderedWith: 'browser',
          },
        }
      } catch (error) {
        return toOutcomeFailure(error)
      }
    },

    async healthCheck(context) {
      if (apiKey.length === 0) return { ok: false, detail: 'Firecrawl API key is not set' }
      try {
        await post('/v1/search', { query: 'open mercato health check', limit: 1 }, context)
        return { ok: true }
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

export const firecrawlAdapterModule = defineAdapterModule({
  id: 'firecrawl',
  kind: 'api',
  contractVersion: CONTRACT_VERSION,
  optionsSchema: firecrawlOptionsSchema,
  createAdapter: createFirecrawlAdapter,
})
