import { silentLogger } from '../contract/http'
import { toOutcomeFailure, type FetchOutcome } from '../contract/outcomes'
import type { SearchPolicy } from '../contract/policy'
import {
  searchRequestSchema,
  type FetchRequest,
  type FetchedPage,
  type PageVerdict,
  type SearchRequest,
  type SearchRequestInput,
  type SearchResult,
} from '../contract/results'
import type { SearchStep, SearchStepEvent, SearchStepMetrics, StepSink } from '../contract/steps'
import { classifyPage } from '../extract/classify'
import { extractMainContent } from '../extract/content'
import { extractTitle, htmlToText } from '../extract/text'
import { fuseResults, type FusionInput } from '../fusion/fuse'
import { buildCacheKey, createSingleFlight } from './cache'
import { DEADLINE_REACHED, deadlineRace, linkSignals } from './deadline'
import { outcomeReason, outcomeToStatus, runAdapter, type AdapterRunResult } from './runAdapter'
import type {
  AdapterDiagnostic,
  AdapterDiagnosticStatus,
  AdapterHealthReport,
  EngineAdapterEntry,
  RunOptions,
  SearchEngine,
  SearchEngineOptions,
  SearchEngineResult,
} from './types'

const TEXTUAL_CONTENT = ['text/', 'application/xhtml+xml', 'application/json', 'application/xml']
const HEALTH_TIMEOUT_MS = 5_000

function statusToEvent(status: AdapterDiagnosticStatus): SearchStepEvent {
  return status === 'skipped' ? 'unavailable' : status
}

function normalizeRequest(
  input: SearchRequestInput,
  policy: SearchPolicy,
): { request: SearchRequest; includeContent: boolean } {
  const parsed = searchRequestSchema.parse(input)
  return {
    request: {
      query: parsed.query,
      limit: parsed.limit ?? 10,
      ...(parsed.locale ? { locale: parsed.locale } : {}),
      ...(parsed.freshness ? { freshness: parsed.freshness } : {}),
      ...(parsed.site ? { site: parsed.site } : {}),
    },
    includeContent: parsed.includeContent ?? policy.content.enabledByDefault,
  }
}

export function createSearchEngine(options: SearchEngineOptions): SearchEngine {
  const { policy, http } = options
  const logger = options.logger ?? silentLogger
  const now = options.now ?? Date.now
  const singleFlight = createSingleFlight<SearchEngineResult>()

  const ordered = [...options.adapters].sort((left, right) => left.order - right.order)
  const browserEntries = ordered.filter((entry) => entry.adapter.kind === 'browser')

  function createReporter(sinks: ReadonlyArray<StepSink | undefined>) {
    const active = sinks.filter((sink): sink is StepSink => sink !== undefined)
    let seq = 0
    return (
      phase: SearchStep['phase'],
      event: SearchStepEvent,
      adapterId?: string,
      detail?: string,
      metrics?: SearchStepMetrics,
    ): void => {
      if (active.length === 0) return
      const step: SearchStep = {
        seq: seq++,
        at: new Date(now()).toISOString(),
        phase,
        event,
        ...(adapterId ? { adapterId } : {}),
        ...(detail ? { detail } : {}),
        ...(metrics ? { metrics } : {}),
      }
      for (const sink of active) {
        try {
          sink(step)
        } catch (error) {
          logger.warn('[web-research] step sink threw', { error: String(error) })
        }
      }
    }
  }

  async function enrichContent(
    results: readonly SearchResult[],
    signal: AbortSignal,
    deadlineAt: number,
    report: (event: SearchStepEvent, detail?: string, metrics?: SearchStepMetrics) => void,
  ): Promise<readonly SearchResult[]> {
    const targets = results.filter((result) => result.content === null).slice(0, policy.content.maxPages)
    if (targets.length === 0) return results
    report('started', `reading ${targets.length} page(s) for inline content`)

    const contentByUrl = new Map<string, string>()
    const queue = [...targets]
    // Bounded by the same knob as the search wave: reading N pages at once is the
    // same egress burst as running N adapters, and it lands on third-party hosts.
    const workers = Array.from({ length: Math.min(policy.concurrency, queue.length) }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        // The run deadline binds here too — otherwise a search bounded to
        // `hardDeadlineMs` could spend minutes reading pages after fusion.
        if (signal.aborted || now() >= deadlineAt) return
        const outcome = await fetchPage(
          { url: next.url, maxBytes: policy.content.maxBytesPerPage },
          { signal },
        )
        if (outcome.status === 'ok' && outcome.page.text.trim().length > 0) {
          contentByUrl.set(next.url, outcome.page.text)
        }
      }
    })
    await Promise.all(workers)

    report('ok', `read ${contentByUrl.size} of ${targets.length} page(s)`, {
      resultCount: contentByUrl.size,
    })

    return results.map((result) => {
      const content = contentByUrl.get(result.url)
      return content === undefined ? result : { ...result, content }
    })
  }

  async function fetchPage(request: FetchRequest, runOptions: RunOptions = {}): Promise<FetchOutcome> {
    const maxBytes = request.maxBytes ?? policy.content.maxBytesPerPage
    const render = request.render ?? 'auto'

    if (render !== 'always') {
      try {
        const response = await http.request(request.url, {
          maxBytes,
          accept: TEXTUAL_CONTENT,
          ...(runOptions.signal ? { signal: runOptions.signal } : {}),
        })
        const isHtml = response.contentType === null || response.contentType.includes('html')
        const text = isHtml ? extractMainContent(response.body) || htmlToText(response.body) : response.body
        const classification = classifyPage({
          status: response.status,
          contentType: response.contentType,
          html: response.body,
          text,
        })
        const page: FetchedPage = {
          url: response.url,
          title: isHtml ? extractTitle(response.body) : null,
          text,
          contentType: response.contentType,
          status: response.status,
          truncated: response.truncated,
          renderedWith: 'http',
        }
        if (classification.verdict === 'ok' || render === 'never') return { status: 'ok', page }

        // Escalation is best-effort: a browser failure must not lose the text we
        // already have, so an unusable render falls back to the annotated HTTP page.
        const escalated = await escalateFetch(request, classification.verdict, maxBytes, runOptions)
        if (escalated?.status === 'ok') return escalated
        return { status: 'ok', page: { ...page, escalatedBecause: classification.verdict } }
      } catch (error) {
        const failure = toOutcomeFailure(error)
        if (render !== 'never' && failure.status === 'blocked') {
          const escalated = await escalateFetch(request, 'blocked', maxBytes, runOptions)
          if (escalated?.status === 'ok') return escalated
        }
        return failure
      }
    }

    const rendered = await escalateFetch(request, 'ok', maxBytes, runOptions)
    return rendered ?? { status: 'unavailable', reason: 'no browser adapter is configured for rendering' }
  }

  /** Re-reads a page through a browser adapter when the HTTP read was insufficient. */
  async function escalateFetch(
    request: FetchRequest,
    because: PageVerdict,
    maxBytes: number,
    runOptions: RunOptions,
  ): Promise<FetchOutcome | null> {
    if (!policy.escalateToBrowser) return null
    const entry = browserEntries.find(
      (candidate) =>
        candidate.enabled && candidate.adapter.fetch !== undefined && candidate.adapter.readiness().ready,
    )
    if (!entry?.adapter.fetch) return null

    const linked = linkSignals([runOptions.signal])
    try {
      const outcome = await entry.adapter.fetch(
        { url: request.url, maxBytes, render: 'always' },
        {
          signal: linked.signal,
          http,
          report: () => {},
          deadlineAt: now() + policy.hardDeadlineMs,
          logger,
        },
      )
      if (outcome.status !== 'ok') return outcome
      return { status: 'ok', page: { ...outcome.page, renderedWith: 'browser', escalatedBecause: because } }
    } catch (error) {
      return toOutcomeFailure(error)
    } finally {
      linked.dispose()
    }
  }

  async function runSearch(
    request: SearchRequest,
    includeContent: boolean,
    runOptions: RunOptions,
    report: ReturnType<typeof createReporter>,
  ): Promise<SearchEngineResult> {
    const startedAt = now()
    const deadlineAt = startedAt + policy.hardDeadlineMs
    const softDeadlineAt = startedAt + policy.softDeadlineMs

    const diagnostics: AdapterDiagnostic[] = []
    const collected: FusionInput[] = []
    const attempted = new Set<string>()
    const blockedAdapters: string[] = []
    let successCount = 0
    let totalResults = 0
    let answer: string | null = null

    const searchable: EngineAdapterEntry[] = []
    for (const entry of ordered) {
      if (entry.adapter.kind === 'browser') continue
      if (!entry.enabled) continue
      if (!entry.adapter.capabilities.search) continue
      const readiness = entry.adapter.readiness()
      if (!readiness.ready) {
        diagnostics.push({
          id: entry.adapter.id,
          status: 'skipped',
          latencyMs: 0,
          resultCount: 0,
          reason: readiness.reason,
        })
        report('plan', 'unavailable', entry.adapter.id, readiness.reason)
        continue
      }
      searchable.push(entry)
      report('plan', 'queued', entry.adapter.id)
    }

    const waveController = new AbortController()
    const wave = linkSignals([runOptions.signal, waveController.signal])
    const adapterDeps = {
      http,
      logger,
      now,
      report: (adapterId: string, event: SearchStepEvent, detail?: string, metrics?: SearchStepMetrics) =>
        report('adapter', event, adapterId, detail, metrics),
      parentSignal: wave.signal,
      deadlineAt,
      adapterTimeoutMs: policy.adapterTimeoutMs,
    }

    const queue = [...searchable]
    const inflight = new Map<string, Promise<AdapterRunResult>>()

    const absorb = (settled: AdapterRunResult): void => {
      const id = settled.entry.adapter.id
      inflight.delete(id)
      const status = outcomeToStatus(settled.outcome)
      const resultCount = settled.outcome.status === 'ok' ? settled.outcome.results.length : 0
      const reason = outcomeReason(settled.outcome)
      diagnostics.push({
        id,
        status,
        latencyMs: settled.latencyMs,
        resultCount,
        ...(reason ? { reason } : {}),
      })
      report('adapter', statusToEvent(status), id, reason, {
        latencyMs: settled.latencyMs,
        resultCount,
      })
      if (settled.outcome.status === 'ok') {
        successCount += 1
        totalResults += resultCount
        collected.push({
          adapterId: id,
          weight: settled.entry.weight,
          results: settled.outcome.results,
        })
        if (answer === null && settled.outcome.answer) answer = settled.outcome.answer
      }
      if (status === 'blocked') blockedAdapters.push(id)
    }

    const launch = (): void => {
      while (inflight.size < policy.concurrency && queue.length > 0) {
        const entry = queue.shift()
        if (!entry) break
        attempted.add(entry.adapter.id)
        inflight.set(entry.adapter.id, runAdapter(entry, request, adapterDeps))
      }
    }

    const satisfied = (): boolean => {
      if (policy.settleMode === 'exhaustive') return false
      if (totalResults < policy.minResults) return false
      if (policy.settleMode === 'race') return true
      return successCount >= policy.minAdapters
    }

    launch()
    while (inflight.size > 0) {
      // Past the soft deadline we only keep waiting while we have nothing at all;
      // holding an answer back for a straggler is worse than answering now.
      const barrier =
        totalResults > 0 && policy.settleMode !== 'exhaustive' ? softDeadlineAt : deadlineAt
      const remaining = barrier - now()
      if (remaining <= 0) break
      const timer = deadlineRace(remaining)
      let winner: AdapterRunResult | typeof DEADLINE_REACHED
      try {
        winner = await Promise.race([...inflight.values(), timer.promise])
      } finally {
        timer.cancel()
      }
      if (winner === DEADLINE_REACHED) break
      absorb(winner)
      if (satisfied()) break
      launch()
    }

    if (inflight.size > 0 || queue.length > 0) {
      waveController.abort()
      const elapsed = now() - startedAt
      for (const id of inflight.keys()) {
        diagnostics.push({ id, status: 'cancelled', latencyMs: elapsed, resultCount: 0 })
        report('adapter', 'cancelled', id)
      }
      for (const promise of inflight.values()) promise.catch(() => undefined)
      inflight.clear()
    }
    wave.dispose()

    let escalated = false
    if (
      policy.escalateToBrowser &&
      totalResults < policy.minResults &&
      blockedAdapters.length > 0 &&
      now() < deadlineAt
    ) {
      const entry = browserEntries.find(
        (candidate) =>
          candidate.enabled &&
          candidate.adapter.capabilities.search &&
          candidate.adapter.readiness().ready &&
          !attempted.has(candidate.adapter.id),
      )
      if (entry) {
        attempted.add(entry.adapter.id)
        escalated = true
        report(
          'adapter',
          'escalated',
          entry.adapter.id,
          `retrying with a browser after ${blockedAdapters.join(', ')} were blocked`,
        )
        const escalation = linkSignals([runOptions.signal])
        try {
          absorb(await runAdapter(entry, request, { ...adapterDeps, parentSignal: escalation.signal }))
        } finally {
          escalation.dispose()
        }
      }
    }

    if (totalResults < policy.minResults && policy.lastResort !== null && now() < deadlineAt) {
      const entry = ordered.find(
        (candidate) =>
          candidate.adapter.id === policy.lastResort &&
          candidate.adapter.capabilities.search &&
          !attempted.has(candidate.adapter.id),
      )
      const readiness = entry?.adapter.readiness()
      if (entry && readiness?.ready) {
        attempted.add(entry.adapter.id)
        report('adapter', 'started', entry.adapter.id, 'last-resort adapter')
        const fallback = linkSignals([runOptions.signal])
        try {
          absorb(await runAdapter(entry, request, { ...adapterDeps, parentSignal: fallback.signal }))
        } finally {
          fallback.dispose()
        }
      }
    }

    const fused = fuseResults(collected, {
      limit: request.limit,
      minResults: policy.minResults,
      minConfidence: policy.minConfidence,
      maxPerDomain: policy.maxPerDomain,
    })
    report('fusion', 'fused', undefined, fused.degraded ? 'confidence threshold relaxed' : undefined, {
      resultCount: fused.results.length,
    })

    let results = fused.results
    if (includeContent && results.length > 0) {
      const expiry = new AbortController()
      const timer = setTimeout(() => expiry.abort(), Math.max(0, deadlineAt - now()))
      timer.unref?.()
      const enrichment = linkSignals([runOptions.signal, expiry.signal])
      try {
        results = await enrichContent(results, enrichment.signal, deadlineAt, (event, detail, metrics) =>
          report('fetch', event, undefined, detail, metrics),
        )
      } finally {
        clearTimeout(timer)
        enrichment.dispose()
      }
    }

    const elapsedMs = now() - startedAt
    report('done', 'completed', undefined, undefined, { latencyMs: elapsedMs, resultCount: results.length })

    // `degraded` means the engine could not do its job properly, not that the web
    // held few answers. Flagging every run that returned fewer than `minResults`
    // marked a citation-style adapter's normal 1-3 hits as degraded on every
    // call, and an agent reading that reports its own findings as unreliable.
    // `cancelled` is excluded on purpose: race and quorum cancel by design.
    const lostSource = diagnostics.some(
      (entry) => entry.status === 'blocked' || entry.status === 'timeout' || entry.status === 'error',
    )

    return {
      results,
      answer,
      diagnostics: {
        adapters: diagnostics,
        degraded: fused.degraded || results.length === 0 || lostSource,
        cached: false,
        escalated,
        elapsedMs,
      },
    }
  }

  async function search(input: SearchRequestInput, runOptions: RunOptions = {}): Promise<SearchEngineResult> {
    const report = createReporter([options.onStep, runOptions.onStep])
    const { request, includeContent } = normalizeRequest(input, policy)
    const adapterIds = ordered.filter((entry) => entry.enabled).map((entry) => entry.adapter.id)
    const cacheKey = `${buildCacheKey(request, adapterIds)}:${includeContent ? 'full' : 'lite'}`

    if (options.cache && policy.cacheTtlMs > 0) {
      const cached = await options.cache.get(cacheKey).catch(() => null)
      if (cached) {
        report('done', 'cached', undefined, 'served from cache', { resultCount: cached.results.length })
        return { ...cached, diagnostics: { ...cached.diagnostics, cached: true } }
      }
    }

    const result = await singleFlight(cacheKey, () => runSearch(request, includeContent, runOptions, report))

    if (options.cache && policy.cacheTtlMs > 0 && result.results.length > 0) {
      await options.cache.set(cacheKey, result, policy.cacheTtlMs).catch(() => undefined)
    }
    return result
  }

  async function health(runOptions: RunOptions = {}): Promise<readonly AdapterHealthReport[]> {
    return Promise.all(
      ordered.map(async (entry): Promise<AdapterHealthReport> => {
        const readiness = entry.adapter.readiness()
        if (!readiness.ready) {
          return { id: entry.adapter.id, ready: false, ok: false, detail: readiness.reason }
        }
        if (!entry.adapter.healthCheck) return { id: entry.adapter.id, ready: true, ok: true }
        const startedAt = now()
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
        timer.unref?.()
        const linked = linkSignals([runOptions.signal, controller.signal])
        try {
          const result = await entry.adapter.healthCheck({
            signal: linked.signal,
            http,
            report: () => {},
            deadlineAt: startedAt + HEALTH_TIMEOUT_MS,
            logger,
          })
          return { id: entry.adapter.id, ready: true, latencyMs: now() - startedAt, ...result }
        } catch (error) {
          return {
            id: entry.adapter.id,
            ready: true,
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
            latencyMs: now() - startedAt,
          }
        } finally {
          clearTimeout(timer)
          linked.dispose()
        }
      }),
    )
  }

  async function dispose(): Promise<void> {
    await Promise.all(
      ordered.map(async (entry) => {
        try {
          await entry.adapter.dispose?.()
        } catch (error) {
          logger.warn(`[web-research] ${entry.adapter.id} failed to dispose`, { error: String(error) })
        }
      }),
    )
  }

  return { search, fetch: fetchPage, health, dispose }
}
