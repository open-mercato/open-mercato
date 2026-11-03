import type { AdapterCapabilities, AdapterKind, SearchAdapter } from '../contract/adapter'
import { READY, notReady } from '../contract/adapter'
import type { SearchOutcome } from '../contract/outcomes'
import type { RawResult } from '../contract/results'

export type FakeAdapterOptions = {
  readonly id: string
  readonly kind?: AdapterKind
  readonly ready?: boolean | string
  /** Milliseconds of simulated work before the outcome resolves. */
  readonly latencyMs?: number
  readonly outcome?: SearchOutcome
  readonly results?: readonly RawResult[]
  readonly capabilities?: Partial<AdapterCapabilities>
  /** Set to make the adapter violate the contract, for isolation tests. */
  readonly throws?: boolean
}

const BASE_CAPABILITIES: AdapterCapabilities = {
  search: true,
  fetch: false,
  snippets: true,
  content: false,
  freshness: false,
  siteFilter: false,
  cost: 'free',
}

/** Deterministic adapter double for scheduler and fusion tests. */
export function createFakeAdapter(options: FakeAdapterOptions): SearchAdapter {
  const capabilities: AdapterCapabilities = { ...BASE_CAPABILITIES, ...options.capabilities }
  const outcome: SearchOutcome =
    options.outcome ??
    (options.results && options.results.length > 0
      ? { status: 'ok', results: options.results }
      : { status: 'empty' })

  return {
    id: options.id,
    kind: options.kind ?? 'api',
    capabilities,
    readiness: () =>
      options.ready === false
        ? notReady('fake adapter configured as not ready')
        : typeof options.ready === 'string'
          ? notReady(options.ready)
          : READY,
    async search(_request, context) {
      if (options.throws) throw new Error(`${options.id} exploded`)
      const latency = options.latencyMs ?? 0
      if (latency > 0) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, latency)
          timer.unref?.()
          context.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              resolve()
            },
            { once: true },
          )
        })
      }
      if (context.signal.aborted) return { status: 'timeout', reason: 'aborted' }
      return outcome
    },
  }
}
