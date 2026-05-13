import { normalizeHostname, tryNormalizeHostname } from '@open-mercato/core/modules/customer_accounts/lib/hostname'

export type DomainResolution = {
  hostname: string
  tenantId: string
  organizationId: string
  orgSlug: string | null
  status: 'active'
}

type PositiveEntry = {
  isNegative: false
  data: DomainResolution
  expiresAt: number
}

type NegativeEntry = {
  isNegative: true
  expiresAt: number
}

type CacheEntry = PositiveEntry | NegativeEntry

export type CacheLookup =
  | { kind: 'fresh-hit'; data: DomainResolution | null }
  | { kind: 'stale-hit'; data: DomainResolution | null }
  | { kind: 'cold-miss' }

export type DomainResolver = (hostname: string) => Promise<DomainResolution | null>

export type CustomDomainCacheOptions = {
  positiveTtlMs: number
  negativeTtlMs: number
  maxEntries: number
  resolver: DomainResolver
  now?: () => number
  onWarmupError?: (error: unknown) => void
  onResolveError?: (hostname: string, error: unknown) => void
  /**
   * Maximum number of in-flight resolver promises. When exceeded, new unique
   * hostnames are dropped (resolved as `null`) instead of starting another
   * fetch. Prevents unbounded `inFlight` growth under hostname-flood probing.
   * Defaults to `maxEntries` when omitted.
   */
  maxInFlight?: number
  /**
   * Invoked once when an in-flight slot is denied to a new hostname because
   * the cap is saturated. The cache rate-limits its own warning, so this hook
   * fires every time but the default warning logger does not spam.
   */
  onInFlightCapReached?: (hostname: string) => void
}

const POSITIVE_TTL_DEFAULT_SECONDS = 60
const NEGATIVE_TTL_DEFAULT_SECONDS = 60
// Hard ceiling for the per-process negative TTL. There is no in-process
// invalidation hook between Next.js workers — only the shared cache is
// invalidated when a domain becomes active — so a longer negative TTL means
// a newly registered domain can stay unresolved on a given process up to
// this many seconds. Keep it under one minute to bound that propagation
// delay for real customers while still absorbing unknown-hostname probing.
const NEGATIVE_TTL_MAX_SECONDS = 60
const MAX_ENTRIES_DEFAULT = 10_000

function readNumberEnv(name: string, fallbackSeconds: number, maxSeconds?: number): number {
  const raw = process.env[name]
  if (!raw) return fallbackSeconds * 1000
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackSeconds * 1000
  const seconds = maxSeconds !== undefined ? Math.min(parsed, maxSeconds) : parsed
  return seconds * 1000
}

function readMaxEntriesEnv(): number {
  const raw = process.env.DOMAIN_CACHE_MAX_ENTRIES
  if (!raw) return MAX_ENTRIES_DEFAULT
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return MAX_ENTRIES_DEFAULT
  return Math.floor(parsed)
}

const IN_FLIGHT_CAP_WARN_INTERVAL_MS = 60_000

export function createCustomDomainCache(options: CustomDomainCacheOptions) {
  const {
    positiveTtlMs,
    negativeTtlMs,
    maxEntries,
    resolver,
    now = Date.now,
    onResolveError,
    onInFlightCapReached,
  } = options
  const maxInFlight = Math.max(1, Math.floor(options.maxInFlight ?? maxEntries))

  // Map preserves insertion order — re-inserting on access yields LRU semantics.
  const store = new Map<string, CacheEntry>()
  const inFlight = new Map<string, Promise<DomainResolution | null>>()
  let lastCapWarnAt = 0

  function touch(key: string, entry: CacheEntry): void {
    store.delete(key)
    store.set(key, entry)
    while (store.size > maxEntries) {
      const oldest = store.keys().next().value
      if (oldest === undefined) break
      store.delete(oldest)
    }
  }

  function readEntry(hostname: string): CacheLookup {
    const entry = store.get(hostname)
    if (!entry) return { kind: 'cold-miss' }
    // Re-insert to keep LRU order on each access.
    store.delete(hostname)
    store.set(hostname, entry)
    const fresh = entry.expiresAt > now()
    const data = entry.isNegative ? null : entry.data
    return fresh ? { kind: 'fresh-hit', data } : { kind: 'stale-hit', data }
  }

  function writePositive(hostname: string, data: DomainResolution): void {
    touch(hostname, { isNegative: false, data, expiresAt: now() + positiveTtlMs })
  }

  function writeNegative(hostname: string): void {
    touch(hostname, { isNegative: true, expiresAt: now() + negativeTtlMs })
  }

  function reportInFlightCap(hostname: string): void {
    if (onInFlightCapReached) {
      onInFlightCapReached(hostname)
      return
    }
    const ts = now()
    if (ts - lastCapWarnAt >= IN_FLIGHT_CAP_WARN_INTERVAL_MS) {
      lastCapWarnAt = ts
      console.warn('[customDomainCache] inFlight cap reached, dropping fetch for', hostname)
    }
  }

  async function fetchAndStore(hostname: string): Promise<DomainResolution | null> {
    const existing = inFlight.get(hostname)
    if (existing) return existing
    if (inFlight.size >= maxInFlight) {
      // Cap saturated: refuse to start another fetch. Returning null mirrors
      // the resolver's "unknown host" path (HTTP 404) so callers degrade
      // gracefully without poisoning the cache or pinning more promises.
      reportInFlightCap(hostname)
      return null
    }
    const promise = (async () => {
      try {
        const result = await resolver(hostname)
        if (result) writePositive(hostname, result)
        else writeNegative(hostname)
        return result
      } catch (err) {
        onResolveError?.(hostname, err)
        // Do not poison the cache on transient resolver errors — let the next
        // request retry. Stale entries (if any) keep serving via SWR.
        throw err
      } finally {
        inFlight.delete(hostname)
      }
    })()
    inFlight.set(hostname, promise)
    return promise
  }

  async function resolve(rawHostname: string): Promise<DomainResolution | null> {
    const normalized = tryNormalizeHostname(rawHostname)
    if (!normalized) return null
    const lookup = readEntry(normalized)
    if (lookup.kind === 'fresh-hit') {
      return lookup.data
    }
    if (lookup.kind === 'stale-hit') {
      // Serve stale immediately; trigger a non-blocking refresh.
      void fetchAndStore(normalized).catch(() => {
        /* error already reported via onResolveError */
      })
      return lookup.data
    }
    // Cold miss: synchronous fetch as fallback.
    return fetchAndStore(normalized)
  }

  function primeFromList(entries: Iterable<DomainResolution>): void {
    for (const entry of entries) {
      const normalized = tryNormalizeHostname(entry.hostname)
      if (!normalized) continue
      writePositive(normalized, { ...entry, hostname: normalized })
    }
  }

  function clear(): void {
    store.clear()
    inFlight.clear()
    lastCapWarnAt = 0
  }

  function size(): number {
    return store.size
  }

  function peek(hostname: string): CacheEntry | undefined {
    const normalized = tryNormalizeHostname(hostname) ?? hostname
    return store.get(normalized)
  }

  return {
    resolve,
    primeFromList,
    clear,
    size,
    peek,
    // Exposed for tests / instrumentation only.
    _internals: { store, inFlight, writePositive, writeNegative, normalize: normalizeHostname },
  }
}

export type CustomDomainCache = ReturnType<typeof createCustomDomainCache>

export function readPositiveTtlMs(): number {
  return readNumberEnv('DOMAIN_CACHE_TTL_SECONDS', POSITIVE_TTL_DEFAULT_SECONDS)
}

export function readNegativeTtlMs(): number {
  return readNumberEnv(
    'DOMAIN_NEGATIVE_CACHE_TTL_SECONDS',
    NEGATIVE_TTL_DEFAULT_SECONDS,
    NEGATIVE_TTL_MAX_SECONDS,
  )
}

export function readMaxEntries(): number {
  return readMaxEntriesEnv()
}
