/**
 * Enqueue-time dedupe guard for `poll-channel` jobs (#8713 — follow-up to #8711).
 *
 * The scheduled poll tick and the manual `poll-now` route each enqueue a
 * `poll-channel` job for a channel independently, with no visibility into
 * whether a job for that channel is already queued or running. A duplicate
 * can no longer regress the sync cursor (cursor compare-and-set, #8711), but
 * it still performs its own provider fetch (and idempotent ingest) before
 * discarding the page — pure wasted work.
 *
 * This is a short, best-effort per-channel lease in the shared cache, not a
 * distributed lock: `has()` + `set()` is not atomic, so two near-simultaneous
 * callers can both observe no lease and both enqueue. That is acceptable, not
 * corrupting — mirrors the accepted race in `queueImportHistory`'s own
 * concurrency guard (`commands/queue-import-history.ts`). The lease is
 * TTL-only (no explicit release) so a crashed or abandoned job can never
 * strand polling for a channel; it only needs to outlive the typical
 * single-page poll (fetch + ingest), not the full inter-tick interval.
 *
 * Like `oauth-state.ts`'s consume marker, this guarantee is process-local with
 * `CACHE_STRATEGY=memory` (the default) — a multi-replica deployment wanting
 * it to hold across replicas needs `CACHE_STRATEGY=redis`. Either way the
 * fallback is only a wasted fetch, never incorrect data.
 */

/**
 * Minimal cache surface this helper needs — matches the `has`/`set` subset of
 * `@open-mercato/cache`'s `CacheStrategy` so callers can pass
 * `container.resolve('cache')` / `ctx.resolve('cache')` directly.
 */
export type PollLeaseStore = {
  has(key: string): Promise<boolean>
  set(
    key: string,
    value: unknown,
    options?: { ttl?: number; tags?: string[] },
  ): Promise<void>
}

/** Cache tag for poll-lease markers (invalidation / diagnostics). */
export const COMMUNICATION_CHANNELS_POLL_LEASE_CACHE_TAG = 'communication_channels:poll-lease'

const DEFAULT_POLL_LEASE_TTL_MS = 60_000

/** Lease TTL, overridable via env for deployments with slower provider fetches. */
export function getPollLeaseTtlMs(): number {
  const parsed = Number.parseInt(process.env.COMMUNICATION_CHANNELS_POLL_LEASE_TTL_MS ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POLL_LEASE_TTL_MS
}

/** Cache key for a channel's poll lease. Exported for tests. */
export function pollLeaseCacheKey(tenantId: string, channelId: string): string {
  return `${COMMUNICATION_CHANNELS_POLL_LEASE_CACHE_TAG}:${tenantId}:${channelId}`
}

/**
 * Try to acquire the poll lease for a channel.
 *
 * Returns `true` when no lease was found (the caller should enqueue the job
 * and a fresh lease is now recorded), `false` when a lease is already held
 * (the caller should skip the enqueue).
 */
export async function tryAcquirePollLease(
  store: PollLeaseStore,
  scope: { tenantId: string; channelId: string },
  ttlMs: number = getPollLeaseTtlMs(),
): Promise<boolean> {
  const key = pollLeaseCacheKey(scope.tenantId, scope.channelId)
  if (await store.has(key)) return false
  await store.set(key, 1, {
    ttl: ttlMs,
    tags: [`${COMMUNICATION_CHANNELS_POLL_LEASE_CACHE_TAG}:${scope.tenantId}`],
  })
  return true
}
