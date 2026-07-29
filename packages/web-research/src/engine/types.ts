import type { AdapterHealth, SearchAdapter } from '../contract/adapter'
import type { HttpClient, Logger } from '../contract/http'
import type { FetchOutcome } from '../contract/outcomes'
import type { SearchPolicy } from '../contract/policy'
import type { FetchRequest, RawResult, SearchRequestInput, SearchResult } from '../contract/results'
import type { StepSink } from '../contract/steps'
import type { ResultCache } from './cache'

export type AdapterDiagnosticStatus =
  | 'ok'
  | 'empty'
  | 'unavailable'
  | 'blocked'
  | 'timeout'
  | 'error'
  | 'skipped'
  | 'cancelled'

export type AdapterDiagnostic = {
  readonly id: string
  readonly status: AdapterDiagnosticStatus
  readonly latencyMs: number
  readonly resultCount: number
  readonly reason?: string
}

export type SearchDiagnostics = {
  readonly adapters: readonly AdapterDiagnostic[]
  readonly degraded: boolean
  readonly cached: boolean
  readonly escalated: boolean
  readonly elapsedMs: number
  /** Pages fetched for inline content; what the host charges a fetch budget for. */
  readonly pagesRead: number
}

/**
 * One adapter's own answer, before fusion touched it.
 *
 * Fusion is lossy on purpose: dedup, the per-domain cap and the limit all drop
 * hits, and only the first prose answer survives. That is right for an agent,
 * which wants one ranked list rather than N to reconcile — but it leaves an
 * operator comparing sources with nothing to compare. This is that view, and it
 * is opt-in for the same reason it is not the default.
 */
export type AdapterResultSet = {
  readonly adapterId: string
  readonly weight: number
  readonly answer: string | null
  /** Exactly what the adapter returned, in its own order. */
  readonly results: readonly RawResult[]
}

export type SearchEngineResult = {
  readonly results: readonly SearchResult[]
  /** Prose synthesis when an adapter produced one; never fabricated by the engine. */
  readonly answer: string | null
  readonly diagnostics: SearchDiagnostics
  /** Present only when the caller asked for `includeAdapterResults`. */
  readonly byAdapter?: readonly AdapterResultSet[]
}

export type AdapterHealthReport = AdapterHealth & {
  readonly id: string
  readonly ready: boolean
}

export type EngineAdapterEntry = {
  readonly adapter: SearchAdapter
  readonly weight: number
  readonly order: number
  /**
   * Whether the normal waves may use it. A disabled adapter is still reachable
   * as `policy.lastResort`, which is what lets an operator keep an expensive
   * source out of every query while retaining it as the safety net.
   */
  readonly enabled: boolean
  /** Overrides `policy.adapterTimeoutMs` for this adapter alone. */
  readonly timeoutMs?: number
}

export type SearchEngineOptions = {
  readonly policy: SearchPolicy
  readonly adapters: readonly EngineAdapterEntry[]
  readonly http: HttpClient
  readonly logger?: Logger
  readonly cache?: ResultCache<SearchEngineResult>
  readonly onStep?: StepSink
  readonly now?: () => number
}

export type RunOptions = {
  readonly signal?: AbortSignal
  readonly onStep?: StepSink
  /**
   * Also return each adapter's untouched result list and prose. An operator
   * comparison aid, deliberately separate from `settleMode`: that decides when
   * to stop, this decides what to hand back. Pair it with `exhaustive` or the
   * scheduler will cancel the very adapters you meant to compare.
   */
  readonly includeAdapterResults?: boolean
}

export type HealthOptions = RunOptions & {
  /**
   * Whether to actually call `healthCheck()` on each adapter.
   *
   * Off means readiness only, which is synchronous and I/O-free. A live probe is
   * not free for every adapter — a metered source spends a real search credit and
   * the browser tier spawns a process — so a screen that merely displays status
   * must be able to ask without billing anyone.
   */
  readonly probe?: boolean
}

export interface SearchEngine {
  search(input: SearchRequestInput, options?: RunOptions): Promise<SearchEngineResult>
  fetch(request: FetchRequest, options?: RunOptions): Promise<FetchOutcome>
  health(options?: HealthOptions): Promise<readonly AdapterHealthReport[]>
  dispose(): Promise<void>
}
