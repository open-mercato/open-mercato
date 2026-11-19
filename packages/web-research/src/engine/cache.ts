import { createHash } from 'node:crypto'
import type { SearchRequest } from '../contract/results'

export type CacheEntry<T> = {
  readonly value: T
  readonly storedAt: number
}

/**
 * Storage seam. Deliberately narrow so a host can back it with any store, and
 * deliberately failable — a cache outage must degrade to a live search, never to
 * an error, so implementations should swallow their own faults.
 */
export type ResultCache<T> = {
  get(key: string): Promise<T | null>
  set(key: string, value: T, ttlMs: number): Promise<void>
}

export function buildCacheKey(request: SearchRequest, adapterIds: readonly string[]): string {
  const payload = JSON.stringify({
    query: request.query.trim().toLowerCase(),
    limit: request.limit,
    locale: request.locale ?? null,
    freshness: request.freshness ?? null,
    site: request.site ?? null,
    adapters: [...adapterIds].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
  })
  return createHash('sha256').update(payload).digest('hex')
}

/**
 * Collapses concurrent identical calls onto one execution. A fan-out of agents
 * asking the same question hits each adapter once instead of once per agent.
 */
export function createSingleFlight<T>(): (key: string, run: () => Promise<T>) => Promise<T> {
  const inflight = new Map<string, Promise<T>>()
  return (key, run) => {
    const existing = inflight.get(key)
    if (existing) return existing
    const promise = run().finally(() => {
      inflight.delete(key)
    })
    inflight.set(key, promise)
    return promise
  }
}
