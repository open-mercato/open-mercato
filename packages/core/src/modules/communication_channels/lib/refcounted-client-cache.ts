/**
 * A bounded, LRU client cache whose disposal is fenced on in-flight use.
 *
 * Push adapters cache one live provider client (a firebase-admin App carrying a
 * background OAuth-refresh timer, or a node-apn Provider holding an HTTP/2 socket)
 * per credential identity, and LRU-evict the least-recently-used one when the cache
 * grows past `max`. The hazard the previous inline caches had: eviction disposed the
 * client (`app.delete()` / `provider.shutdown()`) immediately, even while a concurrent
 * `sendMessage` still held it — closing the socket mid-stream. Above the cap that is a
 * steady-state error rate, not a rare race.
 *
 * This cache reference-counts every borrow and DEFERS disposal of an evicted client
 * until its last in-flight borrow releases, so a send never loses its client
 * underneath it. A client that is never evicted is never disposed.
 */
export type RefCountedClientCacheOptions<TClient> = {
  /** Maximum number of live clients kept at once; the least-recently-used is evicted past this. */
  max: number
  /**
   * Release the underlying resource. Called at most once per created client, and only after the client
   * has been evicted AND every borrow of it has been released. Must not throw synchronously.
   */
  dispose: (client: TClient) => void | Promise<void>
}

export type ClientLease<TClient> = {
  client: TClient
  /**
   * Release this borrow. Idempotent. Once the last borrow of an already-evicted client releases, the
   * client is disposed. Callers MUST call this exactly once per successful `acquire`, in a `finally`.
   */
  release: () => void
}

type CacheEntry<TClient> = {
  key: string
  client: Promise<TClient>
  refs: number
  evicted: boolean
  disposed: boolean
}

export type RefCountedClientCache<TClient> = {
  /**
   * Borrow the client for `key`, creating it via `factory` on a miss. On a hit the entry is promoted to
   * most-recently-used. A rejected factory result is dropped from the cache (never disposed — nothing was
   * constructed) so the next borrow re-creates. The returned lease MUST be released by the caller.
   */
  acquire: (key: string, factory: () => Promise<TClient>) => Promise<ClientLease<TClient>>
  /** Number of live (non-evicted) cached entries. Test/introspection only. */
  size: () => number
}

export function createRefCountedClientCache<TClient>(
  options: RefCountedClientCacheOptions<TClient>,
): RefCountedClientCache<TClient> {
  const entries = new Map<string, CacheEntry<TClient>>()

  const scheduleDispose = (entry: CacheEntry<TClient>): void => {
    if (entry.disposed) return
    entry.disposed = true
    void entry.client.then((client) => options.dispose(client)).catch(() => {})
  }

  const releaseEntry = (entry: CacheEntry<TClient>): void => {
    if (entry.refs <= 0) return
    entry.refs -= 1
    if (entry.refs === 0 && entry.evicted) scheduleDispose(entry)
  }

  const enforceMax = (): void => {
    while (entries.size > options.max) {
      const oldest = entries.values().next().value as CacheEntry<TClient> | undefined
      if (!oldest) break
      entries.delete(oldest.key)
      oldest.evicted = true
      // Defer disposal while borrows remain; releaseEntry disposes when the last one returns.
      if (oldest.refs === 0) scheduleDispose(oldest)
    }
  }

  const obtain = (key: string, factory: () => Promise<TClient>): CacheEntry<TClient> => {
    const existing = entries.get(key)
    if (existing) {
      // Refresh recency: delete + re-insert moves the key to the newest position.
      entries.delete(key)
      entries.set(key, existing)
      existing.refs += 1
      return existing
    }
    const entry: CacheEntry<TClient> = { key, client: factory(), refs: 1, evicted: false, disposed: false }
    entries.set(key, entry)
    // Drop a rejected init (e.g. invalid credentials) so the next borrow re-creates instead of forever
    // returning the cached rejection. Nothing was constructed, so there is nothing to dispose.
    entry.client.catch(() => {
      if (entries.get(key) === entry) entries.delete(key)
    })
    enforceMax()
    return entry
  }

  return {
    async acquire(key, factory) {
      const entry = obtain(key, factory)
      try {
        const client = await entry.client
        let released = false
        return {
          client,
          release: () => {
            if (released) return
            released = true
            releaseEntry(entry)
          },
        }
      } catch (err) {
        releaseEntry(entry)
        throw err
      }
    },
    size: () => entries.size,
  }
}
