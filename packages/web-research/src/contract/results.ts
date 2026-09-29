import { z } from 'zod'

export type Freshness = 'day' | 'week' | 'month' | 'year'

/** Normalized request handed to adapters. The engine resolves defaults first. */
export type SearchRequest = {
  readonly query: string
  readonly limit: number
  readonly locale?: string
  readonly freshness?: Freshness
  readonly site?: string
}

/**
 * What an adapter returns per hit. Everything but `url` is optional because
 * sources differ wildly — an LLM citation list has no snippet, a SERP has no
 * content, a scraping API has both.
 */
export type RawResult = {
  readonly url: string
  readonly title?: string | null
  readonly snippet?: string | null
  readonly content?: string | null
  readonly publishedAt?: string | null
  /** Adapter-native relevance, used only to break ties within one adapter. */
  readonly score?: number | null
}

export type ResultProvenance = {
  readonly adapterId: string
  readonly rank: number
}

/** A hit after canonicalization, dedup and cross-adapter fusion. */
export type SearchResult = {
  readonly url: string
  readonly title: string
  readonly snippet: string | null
  readonly content: string | null
  readonly publishedAt: string | null
  readonly confidence: number
  readonly sources: readonly ResultProvenance[]
}

export type RenderMode = 'auto' | 'never' | 'always'

export type FetchRequest = {
  readonly url: string
  readonly maxBytes?: number
  readonly render?: RenderMode
}

/**
 * Why an HTTP read was judged insufficient. Drives browser escalation, and is
 * reported back so the decision is auditable rather than invisible.
 */
export type PageVerdict = 'ok' | 'js-shell' | 'blocked' | 'empty'

export type FetchedPage = {
  readonly url: string
  readonly title: string | null
  readonly text: string
  readonly contentType: string | null
  readonly status: number
  readonly truncated: boolean
  readonly renderedWith: 'http' | 'browser'
  readonly escalatedBecause?: PageVerdict
}

export const searchRequestSchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(50).optional(),
  locale: z.string().min(2).max(16).optional(),
  freshness: z.enum(['day', 'week', 'month', 'year']).optional(),
  site: z.string().min(1).max(253).optional(),
  includeContent: z.boolean().optional(),
})

export type SearchRequestInput = z.infer<typeof searchRequestSchema>
