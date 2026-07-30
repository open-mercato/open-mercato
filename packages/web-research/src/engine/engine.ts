import { silentLogger } from '../contract/http'
import { timedOut, toOutcomeFailure, type FetchOutcome } from '../contract/outcomes'
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
  ): Promise<{ results: readonly SearchResult[]; pagesRead: number }> {
    const targets = results.filter((result) => result.content === null).slice(0, policy.content.maxPages)
    if (targets.length === 0) return { results, pagesRead: 0 }
    report('started', `reading ${targets.length} page(s) for inline content`)

    const contentByUrl = new Map<string, string>()
    // Counts pages we actually went to the network for, not pages that yielded
    // usable text: the budget this feeds is about egress, and a fetch that came
    // back empty still cost a request to somebody else's server.
    let pagesRead = 0
    const queue = [...targets]
    // Bounded by the same knob as the search wave: reading N pages at once is the
    // same egress burst as running N adapters, and it lands on third-party hosts.
    const workers = Array.from({ length: Math.min(policy.concurrency, queue.length) }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        // The run deadline binds here too — otherwise a search bounded to
        // `hardDeadlineMs` could spend minutes reading pages after fusion.
        if (signal.aborted || now() >= deadlineAt) return
        pagesRead += 1
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

    return {
      results: results.map((result) => {
        const content = contentByUrl.get(result.url)
        return content === undefined ? result : { ...result, content }
      }),
      pagesRead,
    }
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

  /**
   * Races a fetch against a hard wall-clock budget so an adapter that ignores its
   * abort signal — a wedged headless-browser navigation is the classic case —
   * can never hang the caller. When the timer fires it both aborts the signal (so
   * a cooperative adapter cancels) and wins the race, returning a `timeout`
   * outcome; the leaked adapter promise keeps running in the background without
   * blocking anyone. This is the abort+deadline the search scheduler already
   * gives the adapter wave (`runAdapter` + `deadlineRace`); the fetch/escalation
   * path previously passed only a cooperative signal and awaited directly, so a
   * misbehaving browser render could pin the run for the full parent deadline.
   */
  async function withFetchDeadline(
    budgetMs: number,
    parentSignal: AbortSignal | undefined,
    run: (signal: AbortSignal) => Promise<FetchOutcome>,
  ): Promise<FetchOutcome> {
    const budget = Math.max(0, budgetMs)
    const controller = new AbortController()
    const linked = linkSignals(parentSignal ? [parentSignal, controller.signal] : [controller.signal])
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<{ readonly kind: 'deadline' }>((resolve) => {
      timer = setTimeout(() => {
        controller.abort()
        resolve({ kind: 'deadline' })
      }, budget)
      timer.unref?.()
    })
    try {
      const raced = await Promise.race([
        run(linked.signal)
          .then((outcome) => ({ kind: 'outcome' as const, outcome }))
          .catch((error) => ({ kind: 'outcome' as const, outcome: toOutcomeFailure(error) })),
        timeout,
      ])
      return raced.kind === 'deadline' ? timedOut(`fetch exceeded ${budget}ms`) : raced.outcome
    } finally {
      if (timer) clearTimeout(timer)
      linked.dispose()
    }
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
    const browserFetch = entry.adapter.fetch

    return withFetchDeadline(policy.hardDeadlineMs, runOptions.signal, async (signal) => {
      const outcome = await browserFetch(
        { url: request.url, maxBytes, render: 'always' },
        { signal, http, report: () => {}, deadlineAt: now() + policy.hardDeadlineMs, logger },
      )
      if (outcome.status !== 'ok') return outcome
      return { status: 'ok', page: { ...outcome.page, renderedWith: 'browser', escalatedBecause: because } }
    })
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
    const answersById = new Map<string, string>()
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
        // The top-level answer stays first-wins, but every adapter's prose is
        // kept so a comparison run can show them side by side.
        if (settled.outcome.answer) answersById.set(id, settled.outcome.answer)
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
    let pagesRead = 0
    if (includeContent && results.length > 0) {
      const expiry = new AbortController()
      const timer = setTimeout(() => expiry.abort(), Math.max(0, deadlineAt - now()))
      timer.unref?.()
      const enrichment = linkSignals([runOptions.signal, expiry.signal])
      try {
        const enriched = await enrichContent(results, enrichment.signal, deadlineAt, (event, detail, metrics) =>
          report('fetch', event, undefined, detail, metrics),
        )
        results = enriched.results
        pagesRead = enriched.pagesRead
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
        pagesRead,
      },
      ...(runOptions.includeAdapterResults
        ? {
            byAdapter: collected.map((input) => ({
              adapterId: input.adapterId,
              weight: input.weight,
              answer: answersById.get(input.adapterId) ?? null,
              results: input.results,
            })),
          }
        : {}),
    }
  }

  async function search(input: SearchRequestInput, runOptions: RunOptions = {}): Promise<SearchEngineResult> {
    const report = createReporter([options.onStep, runOptions.onStep])
    const { request, includeContent } = normalizeRequest(input, policy)
    const adapterIds = ordered.filter((entry) => entry.enabled).map((entry) => entry.adapter.id)
    const compare = runOptions.includeAdapterResults === true
    // The suffix keeps a comparison run off the normal run's single-flight slot,
    // which would otherwise hand one caller a result built for the other shape.
    const cacheKey = `${buildCacheKey(request, adapterIds)}:${includeContent ? 'full' : 'lite'}${compare ? ':compare' : ''}`
    // A comparison is a diagnostic: serving it from cache would show an operator
    // yesterday's adapter behaviour while they change settings, and storing it
    // would put every adapter's full result list in the cache for one debug run.
    const useCache = options.cache !== undefined && policy.cacheTtlMs > 0 && !compare

    if (useCache) {
      const cached = await options.cache!.get(cacheKey).catch(() => null)
      if (cached) {
        report('done', 'cached', undefined, 'served from cache', { resultCount: cached.results.length })
        // A cache hit read nothing, so it owes nothing to the fetch budget.
        return { ...cached, diagnostics: { ...cached.diagnostics, cached: true, pagesRead: 0 } }
      }
    }

    const result = await singleFlight(cacheKey, () => runSearch(request, includeContent, runOptions, report))

    if (useCache && result.results.length > 0) {
      await options.cache!.set(cacheKey, result, policy.cacheTtlMs).catch(() => undefined)
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

  /**
   * Public single-URL fetch. Wraps `fetchPage` in the same hard deadline so a
   * direct `web_fetch` — which carries no caller signal — is bounded end-to-end
   * (HTTP read AND any browser escalation) at `hardDeadlineMs`, symmetric with the
   * scheduler-bounded search path.
   */
  async function boundedFetch(request: FetchRequest, runOptions: RunOptions = {}): Promise<FetchOutcome> {
    return withFetchDeadline(policy.hardDeadlineMs, runOptions.signal, (signal) =>
      fetchPage(request, { ...runOptions, signal }),
    )
  }

  return { search, fetch: boundedFetch, health, dispose }
}
