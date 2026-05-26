const DEFAULT_SUCCESS_TTL_MS = 30_000
const DEFAULT_NEGATIVE_TTL_MS = 5_000
const DEFAULT_LAST_USED_WRITE_INTERVAL_MS = 60_000
const DEFAULT_MAX_ENTRIES = 1_000

export type CachedApiKeyAuth = Record<string, unknown> | null

type CachedEntry = {
  auth: CachedApiKeyAuth
  cachedAtMs: number
  expiresAtMs: number
}

export type ApiKeyAuthCacheOptions = {
  successTtlMs?: number
  negativeTtlMs?: number
  lastUsedWriteIntervalMs?: number
  maxEntries?: number
  now?: () => number
}

export type ApiKeyAuthCache = {
  get(secret: string): CachedApiKeyAuth | undefined
  setSuccess(secret: string, auth: Exclude<CachedApiKeyAuth, null>, expiresAtMs: number | null): void
  setMiss(secret: string): void
  invalidateByKeyId(keyId: string): void
  shouldWriteLastUsed(keyId: string): boolean
  clear(): void
  size(): number
}

function resolveTtlEnv(name: string, fallback: number): number {
  const raw = process.env?.[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

export function createApiKeyAuthCache(options: ApiKeyAuthCacheOptions = {}): ApiKeyAuthCache {
  const successTtlMs = options.successTtlMs ?? resolveTtlEnv('OM_API_KEY_AUTH_TTL_MS', DEFAULT_SUCCESS_TTL_MS)
  const negativeTtlMs = options.negativeTtlMs ?? resolveTtlEnv('OM_API_KEY_AUTH_NEGATIVE_TTL_MS', DEFAULT_NEGATIVE_TTL_MS)
  const lastUsedWriteIntervalMs = options.lastUsedWriteIntervalMs ?? resolveTtlEnv(
    'OM_API_KEY_LAST_USED_WRITE_INTERVAL_MS',
    DEFAULT_LAST_USED_WRITE_INTERVAL_MS,
  )
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const now = options.now ?? (() => Date.now())

  const entries = new Map<string, CachedEntry>()
  const lastUsedWrites = new Map<string, number>()

  function touch(key: string, entry: CachedEntry) {
    entries.delete(key)
    entries.set(key, entry)
    if (entries.size > maxEntries) {
      const oldest = entries.keys().next().value
      if (typeof oldest === 'string') entries.delete(oldest)
    }
  }

  function purgeStale(key: string, entry: CachedEntry, currentMs: number): boolean {
    if (entry.expiresAtMs > currentMs) return false
    entries.delete(key)
    return true
  }

  return {
    get(secret) {
      if (!secret) return undefined
      const entry = entries.get(secret)
      if (!entry) return undefined
      const currentMs = now()
      if (purgeStale(secret, entry, currentMs)) return undefined
      entries.delete(secret)
      entries.set(secret, entry)
      return entry.auth
    },
    setSuccess(secret, auth, expiresAtMs) {
      if (!secret) return
      if (successTtlMs <= 0) return
      const currentMs = now()
      const ttlEnd = currentMs + successTtlMs
      const effectiveExpiry = expiresAtMs != null ? Math.min(ttlEnd, expiresAtMs) : ttlEnd
      if (effectiveExpiry <= currentMs) return
      touch(secret, { auth, cachedAtMs: currentMs, expiresAtMs: effectiveExpiry })
    },
    setMiss(secret) {
      if (!secret) return
      if (negativeTtlMs <= 0) return
      const currentMs = now()
      touch(secret, { auth: null, cachedAtMs: currentMs, expiresAtMs: currentMs + negativeTtlMs })
    },
    invalidateByKeyId(keyId) {
      if (!keyId) return
      for (const [key, entry] of entries) {
        const auth = entry.auth
        if (auth && typeof auth === 'object' && (auth as { keyId?: string }).keyId === keyId) {
          entries.delete(key)
        }
      }
      lastUsedWrites.delete(keyId)
    },
    shouldWriteLastUsed(keyId) {
      if (!keyId) return true
      if (lastUsedWriteIntervalMs <= 0) return true
      const currentMs = now()
      const previous = lastUsedWrites.get(keyId)
      if (previous != null && currentMs - previous < lastUsedWriteIntervalMs) return false
      lastUsedWrites.set(keyId, currentMs)
      return true
    },
    clear() {
      entries.clear()
      lastUsedWrites.clear()
    },
    size() {
      return entries.size
    },
  }
}

let sharedCache: ApiKeyAuthCache | null = null

export function getSharedApiKeyAuthCache(): ApiKeyAuthCache {
  if (!sharedCache) sharedCache = createApiKeyAuthCache()
  return sharedCache
}

export function resetSharedApiKeyAuthCacheForTests(): void {
  sharedCache = null
}
