import type { SearchRequest } from '@open-mercato/web-research'
import type { SerpSelector } from './extract'

export type SerpEngineId = 'ddg-html' | 'ddg-lite'

export type SerpEngineProfile = {
  readonly id: SerpEngineId
  readonly label: string
  readonly baseUrl: string
  readonly selector: SerpSelector
  buildUrl(request: SearchRequest): string
}

function buildQuery(request: SearchRequest): string {
  const parts = [request.query]
  if (request.site) parts.push(`site:${request.site}`)
  return parts.join(' ')
}

/** DuckDuckGo maps a freshness window onto its `df` parameter. */
function freshnessParam(request: SearchRequest): string | null {
  switch (request.freshness) {
    case 'day':
      return 'd'
    case 'week':
      return 'w'
    case 'month':
      return 'm'
    case 'year':
      return 'y'
    default:
      return null
  }
}

function duckDuckGoUrl(base: string, request: SearchRequest): string {
  const url = new URL(base)
  url.searchParams.set('q', buildQuery(request))
  const freshness = freshnessParam(request)
  if (freshness) url.searchParams.set('df', freshness)
  if (request.locale) url.searchParams.set('kl', request.locale.toLowerCase().replace('_', '-'))
  return url.toString()
}

/**
 * Engine markup is a contract nobody signed — it changes without notice. Keeping
 * profiles as data means a break is a one-line selector edit plus a fixture, and
 * the adapter's zero-results self-check turns a silent parser rot into a visible
 * `blocked` diagnostic rather than an empty answer.
 */
export const SERP_PROFILES: Readonly<Record<SerpEngineId, SerpEngineProfile>> = {
  'ddg-html': {
    id: 'ddg-html',
    label: 'DuckDuckGo (HTML)',
    baseUrl: 'https://html.duckduckgo.com/html/',
    selector: { linkClass: 'result__a', snippetClass: 'result__snippet' },
    buildUrl: (request) => duckDuckGoUrl('https://html.duckduckgo.com/html/', request),
  },
  'ddg-lite': {
    id: 'ddg-lite',
    label: 'DuckDuckGo (Lite)',
    baseUrl: 'https://lite.duckduckgo.com/lite/',
    selector: { linkClass: 'result-link', snippetClass: 'result-snippet' },
    buildUrl: (request) => duckDuckGoUrl('https://lite.duckduckgo.com/lite/', request),
  },
}

export const DEFAULT_ENGINES: readonly SerpEngineId[] = ['ddg-html', 'ddg-lite']
