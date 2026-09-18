import { sql } from 'kysely'
import { parseNumberWithDefault } from '@open-mercato/shared/lib/number'

export type OrganizationScope = { ids: string[]; includeNull: boolean }

export type SearchTokenSourceRef = { entity: string; recordIdColumn?: string }

type ProbeExpression = object | string | readonly string[] | null

export type SearchTokenProbeQueryBuilder = {
  select: (selection: ProbeExpression) => SearchTokenProbeQueryBuilder
  where: (column: ProbeExpression, operator?: string, value?: ProbeExpression) => SearchTokenProbeQueryBuilder
  limit: (count: number) => SearchTokenProbeQueryBuilder
  executeTakeFirst: () => Promise<object | undefined>
}

export type SearchTokenProbeDb = { selectFrom: (table: string) => SearchTokenProbeQueryBuilder }

export type SearchTokenAvailabilityDebugPayload = {
  entity: string
  tenantId: string | null
  organizationScope?: OrganizationScope | null
  recordIdColumn?: string
  hasTokens?: boolean
  error?: string
}

export type SearchTokenAvailabilityDeps = {
  getDb: () => SearchTokenProbeDb
  getConfig: () => { enabled: boolean }
  applyOrganizationScope: (
    query: SearchTokenProbeQueryBuilder,
    column: string,
    scope: OrganizationScope,
  ) => SearchTokenProbeQueryBuilder
  logDebug: (event: string, payload: SearchTokenAvailabilityDebugPayload) => void
}

export type SearchTokenAvailability = {
  /**
   * The cheap, statically-known half of the decision: search is configured on
   * AND the `search_tokens` table exists. Safe to resolve eagerly (consumers
   * like custom-field source attachment need it before any filter is
   * inspected); the table probe is memoized per instance.
   */
  staticEnabled: () => Promise<boolean>
  /**
   * The expensive half: does `search_tokens` hold any row for this
   * (entity, tenant, organization scope)? Historically the `LIMIT 1` probe
   * could degenerate into a seq scan on a large table (#4723), so callers MUST
   * only ask when the query actually carries a like/ilike filter — use
   * `hasSearchFilter` for the gate. Three layers keep it cheap for the end
   * user: index-usable predicates (no `IS NOT DISTINCT FROM`) served by the
   * dedicated `search_tokens_presence_idx (entity_type, tenant_id,
   * organization_id)` prefix — which makes the MISS as cheap as the hit — a
   * per-request instance memo, and a process-level TTL cache
   * (`OM_SEARCH_TOKEN_PRESENCE_CACHE_MS`, default 30s) that amortizes the
   * probe across requests. Probe errors log `search:has-tokens-error`,
   * resolve to `false`, and are never TTL-cached.
   */
  hasTokens: (entity: string, tenantId: string | null, orgScope?: OrganizationScope | null) => Promise<boolean>
  /** First-hit sweep over token sources; logs `search:source-has-tokens` per probed source. */
  anySourceHasTokens: (
    sources: SearchTokenSourceRef[],
    tenantId: string | null,
    orgScope?: OrganizationScope | null,
  ) => Promise<boolean>
}

export function isSearchFilterOp(op: string | null | undefined): boolean {
  return op === 'like' || op === 'ilike'
}

/**
 * The single definition of "this query actually searches". Every consumer of
 * the token-availability answer sits behind a like/ilike guard, so when this
 * returns `false` the `hasTokens` probe's answer would never be read — gate
 * the probe on it.
 */
export function hasSearchFilter(filters: ReadonlyArray<{ op?: string | null }>): boolean {
  return filters.some((filter) => isSearchFilterOp(filter.op))
}

function orgScopeKey(scope: OrganizationScope | null | undefined): string {
  if (!scope) return 'none'
  return `${scope.includeNull ? '1' : '0'}:${[...scope.ids].sort((left, right) => left.localeCompare(right)).join(',')}`
}

const PRESENCE_CACHE_DEFAULT_TTL_MS = 30_000
const PRESENCE_CACHE_MAX_ENTRIES = 10_000

// Process-level TTL cache for the token-presence answer. Module-level (process-global) on
// purpose: `createRequestContainer` builds fresh engines — and with them fresh resolver
// instances — per request, so an instance-scoped memo alone re-pays the probe on every
// request. On a large `search_tokens` one probe can be pathologically expensive (#4723),
// so the answer is amortized across requests here and only re-checked once per TTL.
// Staleness contract: a stale `false` keeps like/ilike on the plain-column fallback for up
// to the TTL after an entity's first tokens are written; a stale `true` routes search
// through an emptied token set for up to the TTL after a purge. Both converge within the
// TTL; set OM_SEARCH_TOKEN_PRESENCE_CACHE_MS=0 to disable and probe per request again.
const presenceCache = new Map<string, { value: boolean; expiresAt: number }>()

function resolvePresenceCacheTtlMs(): number {
  return parseNumberWithDefault(process.env.OM_SEARCH_TOKEN_PRESENCE_CACHE_MS, PRESENCE_CACHE_DEFAULT_TTL_MS, { integer: true, min: 0 })
}

function storePresence(key: string, value: boolean, ttlMs: number): void {
  if (presenceCache.size >= PRESENCE_CACHE_MAX_ENTRIES) {
    const now = Date.now()
    for (const [entryKey, entry] of presenceCache) {
      if (entry.expiresAt <= now) presenceCache.delete(entryKey)
    }
    if (presenceCache.size >= PRESENCE_CACHE_MAX_ENTRIES) presenceCache.clear()
  }
  presenceCache.set(key, { value, expiresAt: Date.now() + ttlMs })
}

export function clearSearchTokenPresenceCache(): void {
  presenceCache.clear()
}

/**
 * One place that answers "is token search usable here?" for both query
 * engines, instead of each hand-assembling config + table-existence +
 * token-presence probes with private duplicate helpers and ad-hoc memo maps.
 *
 * Memoization is per instance; engines are constructed per request
 * (`createRequestContainer`), so entries never outlive a request — the same
 * staleness contract the engines' previous per-query join maps had. A
 * rejected table probe is evicted so the next call retries instead of
 * observing a poisoned cache entry.
 */
export function createSearchTokenAvailability(deps: SearchTokenAvailabilityDeps): SearchTokenAvailability {
  const tablePresence = new Map<string, Promise<boolean>>()
  const tokenPresence = new Map<string, Promise<boolean>>()

  const tableExists = (table: string): Promise<boolean> => {
    const cached = tablePresence.get(table)
    if (cached) return cached
    const probe = (async () => {
      const row = await deps.getDb()
        .selectFrom('information_schema.tables')
        .select(sql<number>`1`.as('one'))
        .where('table_name', '=', table)
        .limit(1)
        .executeTakeFirst()
      return !!row
    })()
    tablePresence.set(table, probe)
    probe.catch(() => tablePresence.delete(table))
    return probe
  }

  const probeTokens = async (
    entity: string,
    tenantId: string | null,
    orgScope?: OrganizationScope | null,
  ): Promise<boolean> => {
    let query = deps.getDb()
      .selectFrom('search_tokens')
      .select(sql<number>`1`.as('one'))
      .where('entity_type', '=', entity)
    // Deliberately `= / IS NULL` instead of `IS NOT DISTINCT FROM` (identical semantics
    // for a string|null tenant): the latter cannot serve as an index condition, which is
    // part of why the planner degraded this probe to a seq scan on large tables (#4723).
    // With plain predicates the probe is a pure prefix seek on
    // `search_tokens_presence_idx (entity_type, tenant_id, organization_id)`, making the
    // miss as cheap as the hit.
    query = tenantId == null
      ? query.where('tenant_id', 'is', null)
      : query.where('tenant_id', '=', tenantId)
    if (orgScope) {
      query = deps.applyOrganizationScope(query, 'search_tokens.organization_id', orgScope)
    }
    const row = await query.limit(1).executeTakeFirst()
    return !!row
  }

  const hasTokens = (
    entity: string,
    tenantId: string | null,
    orgScope?: OrganizationScope | null,
  ): Promise<boolean> => {
    const key = `${entity}|${tenantId ?? '__null__'}|${orgScopeKey(orgScope)}`
    const ttlMs = resolvePresenceCacheTtlMs()
    if (ttlMs > 0) {
      const entry = presenceCache.get(key)
      if (entry && entry.expiresAt > Date.now()) return Promise.resolve(entry.value)
    }
    const cached = tokenPresence.get(key)
    if (cached) return cached
    const probe = (async () => {
      try {
        const value = await probeTokens(entity, tenantId, orgScope)
        // Only genuine probe results enter the process-level cache — caching an
        // error-driven `false` would pin degraded search for a full TTL after a
        // transient DB failure.
        if (ttlMs > 0) storePresence(key, value, ttlMs)
        return value
      } catch (err) {
        deps.logDebug('search:has-tokens-error', {
          entity,
          tenantId,
          organizationScope: orgScope,
          error: err instanceof Error ? err.message : String(err),
        })
        return false
      }
    })()
    tokenPresence.set(key, probe)
    return probe
  }

  return {
    staticEnabled: async () => deps.getConfig().enabled && await tableExists('search_tokens'),
    hasTokens,
    anySourceHasTokens: async (sources, tenantId, orgScope) => {
      for (const source of sources) {
        const ok = await hasTokens(source.entity, tenantId, orgScope)
        deps.logDebug('search:source-has-tokens', {
          entity: source.entity,
          recordIdColumn: source.recordIdColumn,
          tenantId,
          organizationScope: orgScope,
          hasTokens: ok,
        })
        if (ok) return true
      }
      return false
    },
  }
}
