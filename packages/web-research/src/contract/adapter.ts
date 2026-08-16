import type { z } from 'zod'
import type { HttpClient, Logger } from './http'
import type { FetchOutcome, SearchOutcome } from './outcomes'
import type { FetchRequest, SearchRequest } from './results'
import type { StepReporter } from './steps'

export type AdapterKind = 'serp' | 'api' | 'model' | 'browser'

export type AdapterCost = 'free' | 'metered' | 'llm-tokens'

/**
 * What calling `healthCheck()` costs — which is NOT what searching costs.
 *
 * Exa's probe reads a local key and Model-native's resolves configuration, both
 * free, though both are priced adapters to search with. Firecrawl's and Tavily's
 * probes issue a real query and bill for it. The browser tier's spawns an OS
 * process: no money, but not something to run on every page view either.
 *
 * A status surface may run `free` probes unattended; `heavy` and `billable` need
 * a human to ask for them.
 */
export type ProbeCost = 'free' | 'heavy' | 'billable'

export type AdapterCapabilities = {
  readonly search: boolean
  readonly fetch: boolean
  /** Returns real snippets rather than bare URLs. */
  readonly snippets: boolean
  /** Returns full page text inline, sparing a follow-up fetch. */
  readonly content: boolean
  readonly freshness: boolean
  readonly siteFilter: boolean
  readonly cost: AdapterCost
}

export type AdapterReadiness =
  | { readonly ready: true }
  | { readonly ready: false; readonly reason: string }

export type AdapterHealth = {
  readonly ok: boolean
  readonly detail?: string
  readonly latencyMs?: number
}

export type AdapterContext = {
  readonly signal: AbortSignal
  readonly http: HttpClient
  /** Narrates progress; the engine supplies the sequence, timestamp and adapter id. */
  readonly report: StepReporter
  /** Epoch ms after which the engine stops caring about this adapter's answer. */
  readonly deadlineAt: number
  readonly logger: Logger
}

export interface SearchAdapter {
  readonly id: string
  readonly kind: AdapterKind
  readonly capabilities: AdapterCapabilities
  /**
   * Synchronous and I/O-free by contract, so planning a wave never blocks and an
   * unconfigured adapter costs nothing to skip.
   */
  readiness(): AdapterReadiness
  /**
   * What `healthCheck()` costs to call. Omitting it is safe but pessimistic: the
   * engine then derives `billable` from `capabilities.cost === 'metered'` and
   * `free` otherwise, so an adapter that never declares it is simply left out of
   * unattended probing. Declare it whenever the probe costs money.
   */
  readonly probeCost?: ProbeCost
  search(request: SearchRequest, context: AdapterContext): Promise<SearchOutcome>
  fetch?(request: FetchRequest, context: AdapterContext): Promise<FetchOutcome>
  healthCheck?(context: AdapterContext): Promise<AdapterHealth>
  dispose?(): Promise<void>
}

/**
 * What an adapter package default-exports. A descriptor rather than an instance,
 * because the engine builds one instance per tenant from that tenant's options.
 */
export type AdapterModule<TOptions = unknown> = {
  readonly id: string
  readonly kind: AdapterKind
  readonly contractVersion: number
  readonly optionsSchema: z.ZodType<TOptions>
  createAdapter(options: TOptions): SearchAdapter
}

export function defineAdapterModule<TOptions>(
  module: AdapterModule<TOptions>,
): AdapterModule<TOptions> {
  return module
}

export const READY: AdapterReadiness = { ready: true }

export function notReady(reason: string): AdapterReadiness {
  return { ready: false, reason }
}
