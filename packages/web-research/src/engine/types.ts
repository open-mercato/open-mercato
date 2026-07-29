import type { AdapterHealth, SearchAdapter } from '../contract/adapter'
import type { HttpClient, Logger } from '../contract/http'
import type { FetchOutcome } from '../contract/outcomes'
import type { SearchPolicy } from '../contract/policy'
import type { FetchRequest, SearchRequestInput, SearchResult } from '../contract/results'
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
}

export type SearchEngineResult = {
  readonly results: readonly SearchResult[]
  /** Prose synthesis when an adapter produced one; never fabricated by the engine. */
  readonly answer: string | null
  readonly diagnostics: SearchDiagnostics
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
}

export interface SearchEngine {
  search(input: SearchRequestInput, options?: RunOptions): Promise<SearchEngineResult>
  fetch(request: FetchRequest, options?: RunOptions): Promise<FetchOutcome>
  health(options?: RunOptions): Promise<readonly AdapterHealthReport[]>
  dispose(): Promise<void>
}
