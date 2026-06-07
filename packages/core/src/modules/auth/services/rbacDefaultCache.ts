import type { CacheStrategy, CacheValue, CacheSetOptions, CacheGetOptions } from '@open-mercato/cache'

/**
 * Process-scoped fallback CacheStrategy for RbacService.
 *
 * Used only when no shared `cache` service is registered in DI
 * (CLI scripts, lean test bootstraps, isolated unit harnesses). Production
 * deployments wire `@open-mercato/cache` via bootstrap.ts, which preempts
 * this fallback.
 *
 * Goals:
 *  - Match the CacheStrategy contract that RbacService consumes (`get`,
 *    `set`, `has`, `delete`, `deleteByTags`, `clear`).
 *  - Bound memory: LRU eviction at MAX_ENTRIES.
 *  - Honor `OM_RBAC_DEFAULT_CACHE=off` so callers can disable it explicitly.
 *  - Stay process-scoped via `globalThis` so HMR / module duplication does
 *    not produce divergent caches (same pattern as registerDiRegistrars).
 */

type FallbackEntry = {
  value: CacheValue
  tags: string[]
  expiresAt: number | null
}

type FallbackCache = CacheStrategy & {
  __reset: () => void
}

const GLOBAL_KEY = '__openMercatoRbacFallbackCache__'
const MAX_ENTRIES = 5000

export function isRbacDefaultCacheEnabled(): boolean {
  // Default OFF — same gating posture as Phases 2/4/5 in this PR. The
  // integration runtime stays on the bare `asClass(RbacService).scoped()`
  // path (matching develop) unless an operator opts in explicitly.
  // Set `OM_RBAC_DEFAULT_CACHE=on` (or `1`/`true`/`yes`) to enable the
  // in-process LRU fallback.
  const raw = process.env.OM_RBAC_DEFAULT_CACHE
  if (raw === undefined) return false
  const normalized = raw.trim().toLowerCase()
  if (!normalized.length) return false
  return normalized === 'on' || normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function nowMs(): number {
  return Date.now()
}

function createCache(): FallbackCache {
  const store = new Map<string, FallbackEntry>()
  const touch = (key: string) => {
    const entry = store.get(key)
    if (!entry) return undefined
    if (entry.expiresAt !== null && entry.expiresAt < nowMs()) {
      store.delete(key)
      return undefined
    }
    // Move to most-recently-used position (Map preserves insertion order).
    store.delete(key)
    store.set(key, entry)
    return entry
  }
  const evictIfNeeded = () => {
    while (store.size > MAX_ENTRIES) {
      const oldest = store.keys().next().value
      if (typeof oldest !== 'string') break
      store.delete(oldest)
    }
  }
  const cache: FallbackCache = {
    async get(key: string, _options?: CacheGetOptions): Promise<CacheValue | null> {
      const entry = touch(key)
      return entry ? entry.value : null
    },
    async set(key: string, value: CacheValue, options?: CacheSetOptions): Promise<void> {
      const ttl = options?.ttl ?? null
      store.delete(key)
      store.set(key, {
        value,
        tags: options?.tags ?? [],
        expiresAt: typeof ttl === 'number' && ttl > 0 ? nowMs() + ttl : null,
      })
      evictIfNeeded()
    },
    async has(key: string): Promise<boolean> {
      return touch(key) !== undefined
    },
    async delete(key: string): Promise<boolean> {
      return store.delete(key)
    },
    async deleteByTags(tags: string[]): Promise<number> {
      if (!tags.length) return 0
      const tagSet = new Set(tags)
      let removed = 0
      for (const [key, entry] of store.entries()) {
        if (entry.tags.some((tag) => tagSet.has(tag))) {
          store.delete(key)
          removed += 1
        }
      }
      return removed
    },
    async clear(): Promise<number> {
      const count = store.size
      store.clear()
      return count
    },
    async keys(pattern?: string): Promise<string[]> {
      if (!pattern) return Array.from(store.keys())
      const matcher = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
      const regex = new RegExp(`^${matcher}$`)
      return Array.from(store.keys()).filter((key) => regex.test(key))
    },
    async size(): Promise<number> {
      return store.size
    },
    async stats(): Promise<{ size: number; expired: number }> {
      const now = nowMs()
      let expired = 0
      for (const entry of store.values()) {
        if (entry.expiresAt !== null && entry.expiresAt < now) expired += 1
      }
      return { size: store.size, expired }
    },
    __reset() {
      store.clear()
    },
  } as FallbackCache
  return cache
}

export function createRbacFallbackCache(): CacheStrategy {
  const existing = (globalThis as any)[GLOBAL_KEY] as FallbackCache | undefined
  if (existing) return existing
  const cache = createCache()
  ;(globalThis as any)[GLOBAL_KEY] = cache
  return cache
}

/** Test-only helper. Clears the process-scoped fallback cache. */
export function resetRbacFallbackCache(): void {
  const existing = (globalThis as any)[GLOBAL_KEY] as FallbackCache | undefined
  existing?.__reset()
}
