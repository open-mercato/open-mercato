import {
  CONTRACT_VERSION,
  READY,
  defineAdapterModule,
  notReady,
  searchOk,
  toOutcomeFailure,
  type RawResult,
  type SearchAdapter,
  type SearchOutcome,
  type SearchRequest,
} from '@open-mercato/web-research'
import { z } from 'zod'

/**
 * Exa's retrieval modes, cheapest first. `auto` lets Exa pick between its
 * embeddings index and keyword search, which is the right default for a general
 * agent; the `deep*` modes run an agentic loop and cost several times more per
 * call, so choosing one is deliberate.
 */
const SEARCH_TYPES = ['instant', 'fast', 'auto', 'deep-lite', 'deep', 'deep-reasoning'] as const

export const exaOptionsSchema = z.object({
  apiKey: z.string().min(1).optional(),
  baseUrl: z.url().optional(),
  searchType: z.enum(SEARCH_TYPES).optional(),
  /** Return page text inline, sparing the engine a follow-up fetch per result. */
  includeContent: z.boolean().optional(),
  /** Cap on inline text per result; Exa's own ceiling is 10000. */
  maxCharacters: z.number().int().min(200).max(10_000).optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
})

export type ExaOptions = z.infer<typeof exaOptionsSchema>

const DEFAULT_BASE_URL = 'https://api.exa.ai'
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_MAX_CHARACTERS = 4_000

const responseSchema = z.object({
  results: z
    .array(
      z.object({
        url: z.string().nullish(),
        title: z.string().nullish(),
        text: z.string().nullish(),
        highlights: z.array(z.string()).nullish(),
        summary: z.string().nullish(),
        publishedDate: z.string().nullish(),
        score: z.number().nullish(),
      }),
    )
    .nullish(),
  costDollars: z.object({ total: z.number().nullish() }).nullish(),
})

const FRESHNESS_DAYS: Readonly<Record<string, number>> = {
  day: 1,
  week: 7,
  month: 31,
  year: 365,
}

/** Exa filters by publication date natively, which beats a `site:`-style hint. */
function publishedAfter(request: SearchRequest, now: number): string | null {
  const days = request.freshness ? FRESHNESS_DAYS[request.freshness] : undefined
  if (days === undefined) return null
  return new Date(now - days * 86_400_000).toISOString()
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

export function createExaAdapter(options: ExaOptions): SearchAdapter {
  const apiKey = options.apiKey?.trim() ?? ''
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const searchType = options.searchType ?? 'auto'
  const includeContent = options.includeContent ?? false
  const maxCharacters = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    id: 'exa',
    kind: 'api',
    capabilities: {
      search: true,
      fetch: false,
      snippets: true,
      content: includeContent,
      freshness: true,
      siteFilter: true,
      cost: 'metered',
    },
    readiness: () => (apiKey.length > 0 ? READY : notReady('Exa API key is not set')),

    async search(request, context): Promise<SearchOutcome> {
      if (apiKey.length === 0) return { status: 'unavailable', reason: 'Exa API key is not set' }
      try {
        const startPublishedDate = publishedAfter(request, Date.now())
        const response = await context.http.request(`${baseUrl}/search`, {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({
            query: request.query,
            type: searchType,
            numResults: request.limit,
            // Native domain filtering rather than folding `site:` into the query:
            // Exa's index is embeddings-based, so an operator directive inside the
            // query text competes with the semantics instead of constraining them.
            ...(request.site ? { includeDomains: [request.site] } : {}),
            ...(startPublishedDate ? { startPublishedDate } : {}),
            contents: {
              highlights: true,
              ...(includeContent ? { text: { maxCharacters } } : {}),
            },
          }),
          accept: ['application/json'],
          timeoutMs,
          signal: context.signal,
        })

        const parsed = responseSchema.safeParse(parseJson(response.body))
        if (!parsed.success) {
          return { status: 'error', reason: 'Exa returned an unrecognized response shape', retriable: false }
        }

        const results: RawResult[] = []
        for (const item of parsed.data.results ?? []) {
          if (!item.url) continue
          // Highlights are the passages Exa judged most relevant, so they make a
          // better snippet than the head of the page text.
          const snippet = item.highlights?.filter(Boolean).join(' … ') || item.summary || null
          results.push({
            url: item.url,
            title: item.title ?? null,
            snippet,
            content: item.text ?? null,
            publishedAt: item.publishedDate ?? null,
            score: item.score ?? null,
          })
          if (results.length >= request.limit) break
        }

        // Exa prices per call and reports it, so the operator can see what a
        // search actually cost instead of inferring it from an invoice.
        const cost = parsed.data.costDollars?.total
        context.report(
          'ok',
          `Exa returned ${results.length} result(s)${typeof cost === 'number' ? ` for $${cost.toFixed(4)}` : ''}`,
          { resultCount: results.length },
        )
        return searchOk(results)
      } catch (error) {
        return toOutcomeFailure(error)
      }
    },

    /**
     * Deliberately configuration-only: Exa bills per search, and this runs for
     * every installed adapter whenever an operator opens the settings page.
     */
    async healthCheck() {
      return apiKey.length > 0
        ? { ok: true, detail: `key set; ${searchType} mode` }
        : { ok: false, detail: 'Exa API key is not set' }
    },
  }
}

export const exaAdapterModule = defineAdapterModule({
  id: 'exa',
  kind: 'api',
  contractVersion: CONTRACT_VERSION,
  optionsSchema: exaOptionsSchema,
  createAdapter: createExaAdapter,
})
