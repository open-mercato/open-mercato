import { randomUUID } from 'node:crypto'
import {
  CONTRACT_VERSION,
  READY,
  blocked,
  classifyPage,
  defineAdapterModule,
  extractMainContent,
  extractTitle,
  htmlToText,
  notReady,
  searchOk,
  type FetchOutcome,
  type SearchAdapter,
  type SearchOutcome,
} from '@open-mercato/web-research'
import { SERP_PROFILES, extractSerpResults, type SerpEngineId } from '@open-mercato/web-research-serp'
import { z } from 'zod'
import { createSidecar, type Sidecar, type SidecarOptions } from './client'
import { SidecarError } from './protocol'

export const browserOptionsSchema = z.object({
  engines: z.array(z.enum(['ddg-html', 'ddg-lite'])).min(1).optional(),
  userAgent: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  sidecar: z.custom<SidecarOptions>((value) => typeof value === 'object' && value !== null).optional(),
})

export type BrowserOptions = z.infer<typeof browserOptionsSchema>

const DEFAULT_ENGINES: readonly SerpEngineId[] = ['ddg-html']
const DEFAULT_TIMEOUT_MS = 30_000

type RenderResult = { url: string; html: string }

function isRenderResult(value: unknown): value is RenderResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { html?: unknown }).html === 'string' &&
    typeof (value as { url?: unknown }).url === 'string'
  )
}

export function createBrowserAdapter(options: BrowserOptions): SearchAdapter {
  const engines = options.engines ?? DEFAULT_ENGINES
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let sidecar: Sidecar | null = null
  // Remembered so `readiness()` stops promising a tier that cannot start. It is
  // sync and I/O-free by contract, so it cannot probe — but it can report what
  // the last attempt already proved, instead of letting the scheduler pay the
  // escalation cost again to rediscover it.
  let startupFailure: string | null = null

  const client = (): Sidecar => {
    sidecar ??= createSidecar(options.sidecar ?? {})
    return sidecar
  }

  /**
   * Every render takes its own lease, so concurrent work never shares a cookie jar.
   *
   * The budget is the smaller of the configured timeout and whatever the engine
   * has left: a render that outlives `deadlineAt` keeps a browser context open on
   * a page nobody is waiting for any more.
   */
  const render = async (url: string, deadlineAt: number, signal: AbortSignal): Promise<RenderResult> => {
    const leaseId = randomUUID()
    const budget = Math.max(1_000, Math.min(timeoutMs, deadlineAt - Date.now()))
    const active = client()
    try {
      const result = await active.call(
        'render',
        { url, leaseId, timeoutMs: budget, ...(options.userAgent ? { userAgent: options.userAgent } : {}) },
        signal,
      )
      if (!isRenderResult(result)) throw new Error('sidecar returned a malformed render result')
      startupFailure = null
      return result
    } catch (error) {
      if (error instanceof SidecarError && (error.kind === 'init' || error.kind === 'needs-install')) {
        startupFailure = error.message
      }
      throw error
    } finally {
      await active.call('release', { leaseId }).catch(() => undefined)
    }
  }

  return {
    id: 'browser',
    kind: 'browser',
    capabilities: {
      search: true,
      fetch: true,
      snippets: true,
      content: true,
      freshness: true,
      siteFilter: true,
      // Roughly two orders of magnitude more expensive than an HTTP read, which
      // is why the engine only reaches for this after a source reports blocked.
      cost: 'metered',
    },
    // Participation is governed solely by the policy row. The scheduler already
    // keeps `kind: 'browser'` out of normal waves, so an enabled browser adapter
    // is reached only for escalation — a second per-adapter switch just made the
    // UI show two toggles meaning different things.
    /** `heavy` — spawns and pings the sidecar process. */
    probeCost: 'heavy' as const,
    readiness: () => (startupFailure === null ? READY : notReady(startupFailure)),

    async search(request, context): Promise<SearchOutcome> {
      let lastReason = 'no engine produced results'

      for (const engine of engines) {
        if (context.signal.aborted) break
        const profile = SERP_PROFILES[engine]
        context.report('started', `rendering ${profile.label} in a browser`)
        try {
          const rendered = await render(profile.buildUrl(request), context.deadlineAt, context.signal)
          const results = extractSerpResults(rendered.html, profile.selector, profile.baseUrl, request.limit)
          if (results.length > 0) {
            context.report('ok', `${profile.label} returned ${results.length} result(s)`, {
              resultCount: results.length,
            })
            return searchOk(results)
          }
          const verdict = classifyPage({
            status: 200,
            contentType: 'text/html',
            html: rendered.html,
            text: '',
          })
          lastReason =
            verdict.verdict === 'blocked'
              ? `${profile.label} served a challenge page even in a browser (${verdict.reason ?? 'unknown'})`
              : `${profile.label} rendered but produced no parseable results`
        } catch (error) {
          lastReason = error instanceof Error ? error.message : String(error)
        }
        context.report('blocked', lastReason)
      }

      return blocked(lastReason)
    },

    async fetch(request, context): Promise<FetchOutcome> {
      try {
        const rendered = await render(request.url, context.deadlineAt, context.signal)
        const text = extractMainContent(rendered.html) || htmlToText(rendered.html)
        return {
          status: 'ok',
          page: {
            url: rendered.url,
            title: extractTitle(rendered.html),
            text,
            contentType: 'text/html',
            status: 200,
            truncated: false,
            renderedWith: 'browser',
          },
        }
      } catch (error) {
        return {
          status: 'error',
          reason: error instanceof Error ? error.message : String(error),
          retriable: false,
        }
      }
    },

    async healthCheck() {
      try {
        await client().call('ping', {})
        startupFailure = null
        return { ok: true }
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) }
      }
    },

    async dispose() {
      const active = sidecar
      sidecar = null
      if (active) await active.close()
    },
  }
}

export const browserAdapterModule = defineAdapterModule({
  id: 'browser',
  kind: 'browser',
  contractVersion: CONTRACT_VERSION,
  optionsSchema: browserOptionsSchema,
  createAdapter: createBrowserAdapter,
})
