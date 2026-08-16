/**
 * Where a web-search health probe is remembered, and for how long.
 *
 * The cache is what makes a costly probe affordable: one operator-initiated call
 * serves every colleague's overview for the TTL, and a page view never initiates
 * one. It is also the rate limit — see `healthProbePlan`.
 */
import type { AwilixContainer } from 'awilix'

export type CachedProbe = {
  ok: boolean
  detail: string | null
  latencyMs: number | null
  probeCost: 'free' | 'heavy' | 'billable'
  checkedAt: string
}

type CacheLike = {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown, options?: { ttl?: number; tags?: string[] }): Promise<void>
  deleteByTags?(tags: string[]): Promise<number>
}

const DEFAULT_PROBE_TTL_MS = 600_000

export function probeTtlMs(): number {
  const raw = Number(process.env.OM_AGENT_HEALTH_PROBE_TTL_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PROBE_TTL_MS
}

export function healthCacheKey(tenantId: string | null, adapterId: string): string {
  return `agent_orchestrator:health:web_search:v1:${tenantId ?? 'global'}:${adapterId}`
}

export function healthCacheTag(tenantId: string | null): string {
  return `agent_orchestrator:health:${tenantId ?? 'global'}`
}

/**
 * A container without a cache registration is a valid deployment, and this
 * degrades the same way the search engine's own cache does. It never becomes a
 * licence to probe a billable adapter unattended: those rows simply stay
 * unverified until an operator asks.
 */
export function resolveHealthCache(container: AwilixContainer): CacheLike | null {
  try {
    return container.resolve('cache') as CacheLike
  } catch {
    return null
  }
}

export async function readCachedProbes(
  cache: CacheLike | null,
  tenantId: string | null,
  adapterIds: readonly string[],
): Promise<Map<string, CachedProbe>> {
  const found = new Map<string, CachedProbe>()
  if (!cache) return found
  await Promise.all(
    adapterIds.map(async (id) => {
      try {
        const value = (await cache.get(healthCacheKey(tenantId, id))) as CachedProbe | undefined
        if (value && typeof value.checkedAt === 'string') found.set(id, value)
      } catch {
        // A cache outage must never fail a status read.
      }
    }),
  )
  return found
}

export async function writeCachedProbes(
  cache: CacheLike | null,
  tenantId: string | null,
  probes: ReadonlyMap<string, CachedProbe>,
): Promise<void> {
  if (!cache) return
  const ttl = probeTtlMs()
  await Promise.all(
    Array.from(probes.entries()).map(async ([id, probe]) => {
      try {
        await cache.set(healthCacheKey(tenantId, id), probe, { ttl, tags: [healthCacheTag(tenantId)] })
      } catch {
        // Losing the write only means the next reader probes again.
      }
    }),
  )
}

/** Called after a settings write, because a saved key changes every verdict. */
export async function invalidateWebSearchHealthCache(
  container: AwilixContainer,
  tenantId: string | null,
): Promise<void> {
  const cache = resolveHealthCache(container)
  if (!cache?.deleteByTags) return
  try {
    await cache.deleteByTags([healthCacheTag(tenantId)])
  } catch {
    // Worst case the next reader serves a row that is at most one TTL stale.
  }
}

export function probeAgeMs(probe: CachedProbe | undefined, nowMs: number): number {
  if (!probe) return Number.POSITIVE_INFINITY
  const then = Date.parse(probe.checkedAt)
  return Number.isNaN(then) ? Number.POSITIVE_INFINITY : nowMs - then
}
