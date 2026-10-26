import {
  CONTRACT_VERSION,
  READY,
  blocked,
  classifyPage,
  defineAdapterModule,
  notReady,
  searchOk,
  toOutcomeFailure,
  type AdapterContext,
  type RawResult,
  type SearchAdapter,
  type SearchOutcome,
  type SearchRequest,
} from '@open-mercato/web-research'
import { z } from 'zod'
import { extractSerpResults } from './extract'
import { DEFAULT_ENGINES, SERP_PROFILES, type SerpEngineId } from './profiles'

export const serpOptionsSchema = z.object({
  engines: z.array(z.enum(['ddg-html', 'ddg-lite'])).min(1).optional(),
  /** Bytes to read per SERP; enough for a full result page, small enough to bound cost. */
  maxBytes: z.number().int().min(4096).max(4 * 1024 * 1024).optional(),
})

export type SerpOptions = z.infer<typeof serpOptionsSchema>

const DEFAULT_MAX_BYTES = 1024 * 1024
/** Below this a 200 response is a challenge or an error page, not a result page. */
const MIN_PLAUSIBLE_SERP_BYTES = 2_048

const ACCEPT_HTML = ['text/html', 'application/xhtml+xml']

function attempt(
  engine: SerpEngineId,
  request: SearchRequest,
  context: AdapterContext,
  maxBytes: number,
): Promise<SearchOutcome> {
  const profile = SERP_PROFILES[engine]
  return context.http
    .request(profile.buildUrl(request), {
      maxBytes,
      accept: ACCEPT_HTML,
      signal: context.signal,
      headers: { referer: profile.baseUrl },
    })
    .then((response): SearchOutcome => {
      const results = extractSerpResults(response.body, profile.selector, profile.baseUrl, request.limit)
      if (results.length > 0) return searchOk(results)

      const verdict = classifyPage({
        status: response.status,
        contentType: response.contentType,
        html: response.body,
        text: '',
      })
      if (verdict.verdict === 'blocked') {
        return blocked(`${profile.label} served a challenge page (${verdict.reason ?? 'unknown'})`)
      }
      // A substantial page that yields nothing means our selectors no longer match
      // the engine's markup. Reporting `blocked` rather than `empty` is deliberate:
      // it escalates to the browser tier and shows up as a fault instead of
      // masquerading as a legitimate "no results".
      if (response.body.length > MIN_PLAUSIBLE_SERP_BYTES) {
        return blocked(
          `${profile.label} returned a page we could not parse (${response.body.length} bytes, 0 results) - selectors may be stale`,
        )
      }
      return { status: 'empty' }
    })
    .catch((error: unknown) => toOutcomeFailure(error))
}

export function createSerpAdapter(options: SerpOptions): SearchAdapter {
  const engines = options.engines ?? DEFAULT_ENGINES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  return {
    id: 'serp-html',
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
    /** `free` — no health check to pay for. */
    probeCost: 'free' as const,
    readiness: () => (engines.length > 0 ? READY : notReady('no search engines are enabled')),
    async search(request, context) {
      let lastFailure: SearchOutcome | null = null

      for (const engine of engines) {
        if (context.signal.aborted) break
        context.report('started', `querying ${SERP_PROFILES[engine].label}`)
        const outcome = await attempt(engine, request, context, maxBytes)
        if (outcome.status === 'ok') {
          const results: readonly RawResult[] = outcome.results
          context.report('ok', `${SERP_PROFILES[engine].label} returned ${results.length} result(s)`, {
            resultCount: results.length,
          })
          return outcome
        }
        lastFailure = outcome
        context.report(
          outcome.status === 'empty' ? 'empty' : 'blocked',
          outcome.status === 'empty' ? `${SERP_PROFILES[engine].label} had no results` : outcome.reason,
        )
      }

      return lastFailure ?? { status: 'empty' }
    },
  }
}

export const serpAdapterModule = defineAdapterModule({
  id: 'serp-html',
  kind: 'serp',
  contractVersion: CONTRACT_VERSION,
  optionsSchema: serpOptionsSchema,
  createAdapter: createSerpAdapter,
})
