import type { AdapterContext } from '../contract/adapter'
import { errorMessage } from '../contract/errors'
import type { HttpClient, Logger } from '../contract/http'
import { failed, type SearchOutcome } from '../contract/outcomes'
import type { SearchRequest } from '../contract/results'
import type { SearchStepEvent, SearchStepMetrics } from '../contract/steps'
import { linkSignals } from './deadline'
import type { AdapterDiagnosticStatus, EngineAdapterEntry } from './types'

export type AdapterRunResult = {
  readonly entry: EngineAdapterEntry
  readonly outcome: SearchOutcome
  readonly latencyMs: number
}

export type AdapterRunDeps = {
  readonly http: HttpClient
  readonly logger: Logger
  readonly now: () => number
  readonly report: (adapterId: string, event: SearchStepEvent, detail?: string, metrics?: SearchStepMetrics) => void
  readonly parentSignal: AbortSignal
  readonly deadlineAt: number
  readonly adapterTimeoutMs: number
}

export function outcomeToStatus(outcome: SearchOutcome): AdapterDiagnosticStatus {
  switch (outcome.status) {
    case 'ok':
      return 'ok'
    case 'empty':
      return 'empty'
    case 'unavailable':
      return 'unavailable'
    case 'blocked':
      return 'blocked'
    case 'timeout':
      return 'timeout'
    case 'error':
      return 'error'
  }
}

export function outcomeReason(outcome: SearchOutcome): string | undefined {
  if (outcome.status === 'ok' || outcome.status === 'empty') return undefined
  return outcome.reason
}

/**
 * Runs one adapter under its own timeout and abort linkage.
 *
 * The contract says adapters return outcomes rather than throwing, but a
 * third-party adapter is not trusted to honour that — a throw here is converted
 * into an `error` outcome so one misbehaving package cannot abort the whole run.
 */
export async function runAdapter(
  entry: EngineAdapterEntry,
  request: SearchRequest,
  deps: AdapterRunDeps,
): Promise<AdapterRunResult> {
  const startedAt = deps.now()
  const allowance = entry.timeoutMs ?? deps.adapterTimeoutMs
  const budget = Math.max(0, Math.min(allowance, deps.deadlineAt - startedAt))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), budget)
  timer.unref?.()
  const linked = linkSignals([deps.parentSignal, controller.signal])

  const context: AdapterContext = {
    signal: linked.signal,
    http: deps.http,
    report: (event, detail, metrics) => deps.report(entry.adapter.id, event, detail, metrics),
    deadlineAt: startedAt + budget,
    logger: deps.logger,
  }

  deps.report(entry.adapter.id, 'started')

  try {
    const outcome = await entry.adapter.search(request, context)
    return { entry, outcome, latencyMs: deps.now() - startedAt }
  } catch (error) {
    const detail = `adapter threw instead of returning an outcome: ${errorMessage(error)}`
    deps.logger.warn(`[web-research] ${entry.adapter.id} ${detail}`)
    return { entry, outcome: failed(detail, false), latencyMs: deps.now() - startedAt }
  } finally {
    clearTimeout(timer)
    linked.dispose()
  }
}
