import type { Kysely } from 'kysely'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import type { EventBus } from '@open-mercato/events/types'
import { flattenSystemEntityIds } from '@open-mercato/shared/lib/entities/system-entities'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { readCoverageSnapshots, primeColumnCache, type ColumnCheck } from '../lib/coverage'

export const metadata = { event: 'query_index.coverage.warmup', persistent: false }

type Payload = {
  tenantId?: string | null
}

const DEFAULT_WARMUP_THROTTLE_MS = 5 * 60 * 1000
const DEFAULT_WARMUP_REFRESH_CONCURRENCY = 10
const DEFAULT_WARMUP_STAGGER_MS = 0
const lastWarmupAt = new Map<string, number>()

function scopeKey(entityType: string, tenantId: string | null): string {
  return `${entityType}|${tenantId ?? '__null__'}`
}

function isWarmupEnabled(): boolean {
  return parseBooleanWithDefault(process.env.QUERY_INDEX_WARMUP_ENABLED, true)
}

function resolveWarmupThrottleMs(): number {
  const raw = Number.parseInt(process.env.QUERY_INDEX_WARMUP_THROTTLE_MS ?? '', 10)
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_WARMUP_THROTTLE_MS
}

function resolveWarmupConcurrency(): number {
  const raw = Number.parseInt(process.env.QUERY_INDEX_WARMUP_CONCURRENCY ?? '', 10)
  return Number.isFinite(raw) && raw >= 1 ? raw : DEFAULT_WARMUP_REFRESH_CONCURRENCY
}

function resolveWarmupStaggerMs(): number {
  const raw = Number.parseInt(process.env.QUERY_INDEX_WARMUP_STAGGER_MS ?? '', 10)
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_WARMUP_STAGGER_MS
}

function getEntityIdList(): string[] {
  return flattenSystemEntityIds(getEntityIds() as Record<string, Record<string, string>>)
}

// Durable staleness check against `entity_index_coverage.refreshed_at`. The in-memory
// `lastWarmupAt` Map only throttles within one process, so a fresh restart forgets
// every scope and re-runs the full sweep even for entity types whose persisted snapshot
// was refreshed moments earlier (by a prior warmup, a lazy query-engine refresh, or an
// incremental CRUD delta via `applyCoverageAdjustments`, which also bumps `refreshed_at`).
// This check is batched (one query for all candidates) and replaces process memory with
// the same source of truth the query engine itself reads.
async function filterStaleEntityTypes(
  db: Kysely<any> | null,
  candidates: string[],
  tenantId: string | null,
  throttleMs: number,
  now: number,
): Promise<string[]> {
  if (!db) {
    for (const entityType of candidates) lastWarmupAt.set(scopeKey(entityType, tenantId), now)
    return candidates
  }

  const snapshots = await readCoverageSnapshots(db, {
    entityTypes: candidates,
    tenantId,
    organizationId: null,
    withDeleted: false,
  }).catch(() => new Map())

  const stale: string[] = []
  for (const entityType of candidates) {
    const snapshot = snapshots.get(entityType)
    const refreshedAt = snapshot?.refreshed_at instanceof Date ? snapshot.refreshed_at.getTime() : null
    if (refreshedAt !== null && now - refreshedAt < throttleMs) {
      lastWarmupAt.set(scopeKey(entityType, tenantId), refreshedAt)
      continue
    }
    lastWarmupAt.set(scopeKey(entityType, tenantId), now)
    stale.push(entityType)
  }
  return stale
}

export default async function handle(payload: Payload, ctx: { resolve: <T = any>(name: string) => T }) {
  if (!isWarmupEnabled()) {
    return
  }

  const entityIds = getEntityIdList()
  if (!entityIds.length) {
    return
  }

  const tenantId = payload?.tenantId ?? null
  let eventBus: EventBus | null = null
  try {
    eventBus = ctx.resolve<EventBus>('eventBus')
  } catch {
    eventBus = null
  }

  if (!eventBus) {
    return
  }

  let em: any = null
  let db: Kysely<any> | null = null
  try {
    em = ctx.resolve<any>('em')
    db = typeof em?.getKysely === 'function' ? em.getKysely() : null
  } catch {
    em = null
    db = null
  }

  const throttleMs = resolveWarmupThrottleMs()
  const now = Date.now()

  // First pass: cheap in-process throttle so back-to-back warmups within the same
  // process (e.g. rapid logins, or entities still pending a staggered refresh) don't
  // even reach the DB.
  const candidates: string[] = []
  for (const entityType of entityIds) {
    const key = scopeKey(entityType, tenantId)
    const last = lastWarmupAt.get(key) ?? 0
    if (now - last < throttleMs) {
      continue
    }
    candidates.push(entityType)
  }
  if (!candidates.length) {
    return
  }

  // Second pass: durable check against the persisted coverage snapshot (see
  // `filterStaleEntityTypes`) — this is what actually fixes the "every restart repeats
  // the full sweep" problem, since the in-memory Map above is empty after a restart.
  const staleEntityTypes = await filterStaleEntityTypes(db, candidates, tenantId, throttleMs, now)
  if (!staleEntityTypes.length) {
    return
  }

  // Pre-warm the shared column-existence cache (`lib/coverage.ts`'s `COLUMN_CACHE`) for
  // every table this batch is about to check, in one query, before dispatching any
  // `coverage.refresh` events. Without this, each of the (possibly many) concurrently
  // dispatched refreshes independently asks `information_schema.columns` about its own
  // table's org/tenant/deleted columns plus the shared `vector_search.entity_id` check —
  // the latter identical across every entity type, so on a cold cache they'd otherwise
  // all race and each fire the same redundant introspection query.
  if (db && em) {
    const checks: ColumnCheck[] = [{ table: 'vector_search', column: 'entity_id' }]
    for (const entityType of staleEntityTypes) {
      const table = resolveEntityTableName(em, entityType)
      checks.push(
        { table, column: 'organization_id' },
        { table, column: 'tenant_id' },
        { table, column: 'deleted_at' },
      )
    }
    await primeColumnCache(db, checks).catch(() => undefined)
  }

  // Spread the burst: give each chunk an increasing `delayMs` and fire every chunk's
  // emissions up front instead of blocking per chunk. `coverage_refresh.ts` already defers
  // `delayMs > 0` work via `setTimeout(...).unref()`, so this only lowers the peak concurrent
  // count of in-flight forked EntityManagers/connections — the total query count is unchanged.
  // A suggested non-zero `QUERY_INDEX_WARMUP_STAGGER_MS` (e.g. 2000) de-spikes memory-constrained
  // dev/staging; the default stays 0 so no deployment's behavior silently changes.
  const staggerMs = resolveWarmupStaggerMs()
  const concurrency = resolveWarmupConcurrency()
  const chunkPromises: Promise<unknown>[] = []
  for (let i = 0; i < staleEntityTypes.length; i += concurrency) {
    const chunkIndex = i / concurrency
    const chunk = staleEntityTypes.slice(i, i + concurrency)
    const delayMs = chunkIndex * staggerMs
    chunkPromises.push(
      Promise.allSettled(
        chunk.map((entityType) =>
          eventBus.emit('query_index.coverage.refresh', {
            entityType,
            tenantId,
            organizationId: null,
            delayMs,
          }).catch(() => undefined)
        )
      )
    )
  }
  await Promise.allSettled(chunkPromises)
}
