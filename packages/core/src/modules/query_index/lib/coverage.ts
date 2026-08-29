import type { EntityManager } from '@mikro-orm/postgresql'
import { type Kysely, type Transaction, sql } from 'kysely'
import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('query_index').child({ component: 'coverage' })

type CoverageExecutor = Kysely<any> | Transaction<any>

export type CoverageScope = {
  entityType: string
  tenantId?: string | null
  organizationId?: string | null
  withDeleted?: boolean
}

type CoverageRow = {
  base_count: unknown
  indexed_count: unknown
  vector_indexed_count: unknown
  refreshed_at: Date | string | null
}

export type CoverageSnapshot = CoverageRow & {
  baseCount: number
  indexedCount: number
  vectorIndexedCount: number
}

export type CoverageBatchScope = {
  entityTypes: readonly string[]
  tenantId?: string | null
  organizationId?: string | null
  withDeleted?: boolean
}

export type CoverageAdjustment = {
  entityType: string
  tenantId: string | null
  organizationId: string | null
  withDeleted?: boolean
  deltaBase: number
  deltaIndex: number
  deltaVector?: number
}

export type CoverageDeltaInput = {
  entityType: string
  tenantId: string | null
  organizationId: string | null
  withDeleted?: boolean
  baseDelta: number
  indexDelta: number
  vectorDelta?: number
}

const COLUMN_CACHE = new Map<string, boolean>()
// In-flight de-dup: without this, N concurrent `tableHasColumn` callers for the same
// (table, column) — e.g. every entity type's `refreshCoverageSnapshot` asking about
// `vector_search.entity_id` — would each see a cold cache and fire their own identical
// `information_schema.columns` query, since the cache is only populated after a query
// resolves. Tracking the in-flight promise lets late arrivals await the first one instead.
const COLUMN_CACHE_PENDING = new Map<string, Promise<boolean>>()
const GLOBAL_ORGANIZATION_PLACEHOLDER = '00000000-0000-0000-0000-000000000000'
export const COVERAGE_ORG_PLACEHOLDER = GLOBAL_ORGANIZATION_PLACEHOLDER

function toCount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (value != null && typeof (value as { valueOf: () => number }).valueOf === 'function') {
    const parsed = Number((value as { valueOf: () => number }).valueOf())
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function normalizeOrganizationForStore(orgId: string | null | undefined): string {
  return orgId ?? GLOBAL_ORGANIZATION_PLACEHOLDER
}

function applyOrganizationCondition<QB extends { where: (...args: any[]) => QB }>(
  qb: QB,
  column: string,
  organizationId: string | null | undefined,
): QB {
  const stored = normalizeOrganizationForStore(organizationId ?? null)
  if (stored === GLOBAL_ORGANIZATION_PLACEHOLDER) {
    return qb.where((eb: any) => eb.or([
      eb(column as any, 'is', null),
      eb(column as any, '=', GLOBAL_ORGANIZATION_PLACEHOLDER),
    ]))
  }
  return qb.where(column as any, '=', stored)
}

async function fetchCoverageRow(
  db: CoverageExecutor,
  scope: CoverageScope
): Promise<(CoverageRow & { organization_id: string | null }) | null> {
  const { entityType, tenantId, organizationId, withDeleted } = scope
  let query = db
    .selectFrom('entity_index_coverage' as any)
    .select([
      'base_count' as any,
      'indexed_count' as any,
      'vector_indexed_count' as any,
      'refreshed_at' as any,
      'organization_id' as any,
    ])
    .where('entity_type' as any, '=', entityType)
    .where('with_deleted' as any, '=', withDeleted === true)
    .orderBy('refreshed_at' as any, 'desc')
  query = tenantId == null
    ? query.where('tenant_id' as any, 'is', null as any)
    : query.where('tenant_id' as any, '=', tenantId)
  query = applyOrganizationCondition(query as any, 'organization_id', organizationId ?? null)
  const row = await query.executeTakeFirst() as (CoverageRow & { organization_id: string | null }) | undefined
  return row ?? null
}

async function pruneDuplicateCoverageRows(
  db: CoverageExecutor,
  scope: CoverageScope,
  keepId: string | null
): Promise<void> {
  let query = db
    .deleteFrom('entity_index_coverage' as any)
    .where('entity_type' as any, '=', scope.entityType)
    .where('with_deleted' as any, '=', scope.withDeleted === true)
  query = scope.tenantId == null
    ? query.where('tenant_id' as any, 'is', null as any)
    : query.where('tenant_id' as any, '=', scope.tenantId)
  query = applyOrganizationCondition(query as any, 'organization_id', scope.organizationId ?? null)
  if (keepId) {
    query = query.where('id' as any, '!=', keepId)
  }
  await query.execute()
}

function coverageInitializationLockKey(scope: CoverageScope): string {
  return [
    scope.entityType,
    scope.tenantId ?? '__null_tenant__',
    normalizeOrganizationForStore(scope.organizationId ?? null),
    scope.withDeleted === true ? 'with_deleted' : 'active_only',
  ].join('|')
}

async function lockCoverageInitialization(db: CoverageExecutor, scope: CoverageScope): Promise<void> {
  await sql`
    select pg_advisory_xact_lock(
      hashtextextended(${coverageInitializationLockKey(scope)}, 0)
    )
  `.execute(db)
}

async function updateCoverageRows(
  db: CoverageExecutor,
  scope: CoverageScope,
  deltas: { deltaBase: number; deltaIndex: number; deltaVector: number },
): Promise<Array<{ id: string }>> {
  let update = db
    .updateTable('entity_index_coverage' as any)
    .set({
      base_count: sql`greatest(${sql.ref('base_count')} + ${deltas.deltaBase}, 0)`,
      indexed_count: sql`greatest(${sql.ref('indexed_count')} + ${deltas.deltaIndex}, 0)`,
      vector_indexed_count: sql`greatest(${sql.ref('vector_indexed_count')} + ${deltas.deltaVector}, 0)`,
      refreshed_at: sql`now()`,
    } as any)
    .where('entity_type' as any, '=', scope.entityType)
    .where('with_deleted' as any, '=', scope.withDeleted === true)
  update = scope.tenantId == null
    ? update.where('tenant_id' as any, 'is', null as any)
    : update.where('tenant_id' as any, '=', scope.tenantId)
  update = applyOrganizationCondition(update as any, 'organization_id', scope.organizationId ?? null)
  return update.returning(['id' as any]).execute() as Promise<Array<{ id: string }>>
}

// Applies a coverage delta by incrementing the stored columns in SQL (#5604). The obvious
// alternative — read the row, add the delta in JavaScript, write the total back — is a
// read-modify-write: two adjustments for the same scope that overlap both read the same row
// and both write the same total, so one of them is silently lost. Incrementing in SQL makes
// overlapping adjustments compose, and drops the `SELECT` (and the window between it and the
// write) that made the coverage row a contention point in the first place.
//
// In steady state that is one statement. The extra statements are recovery paths that do not
// fire once a scope has settled: the legacy NULL-organization fold below runs only for
// global-organization scopes, the insert only until the scope's row exists, and the duplicate
// prune only when the scope somehow holds more than one row.
//
// The statement is an `UPDATE` rather than an `INSERT … ON CONFLICT DO UPDATE`, because the
// conflict target cannot see every scope this table stores: `entity_index_coverage_scope_idx`
// is a plain `UNIQUE` constraint, and Postgres treats NULLs in one as distinct. For a scope
// whose tenant is NULL — `resolveQueryIndexRecordScope`'s `global` branch, or any source row
// with a NULL tenant column — the conflict branch would never fire, so every adjustment would
// insert a fresh row carrying only its own delta and `pruneDuplicateCoverageRows` would then
// delete the accumulated one. A NULL-aware `UPDATE` matches those rows, and it still adds the
// delta to the column's own value, so it composes exactly the way the conflict branch does.
async function incrementCoverageRow(
  db: CoverageExecutor,
  scope: CoverageScope,
  deltas: { deltaBase: number; deltaIndex: number; deltaVector: number }
): Promise<void> {
  const storedOrgId = normalizeOrganizationForStore(scope.organizationId ?? null)
  let deltaBase = deltas.deltaBase
  let deltaIndex = deltas.deltaIndex
  let deltaVector = deltas.deltaVector

  if (scope.organizationId == null) {
    // Legacy rows stored the global scope as a NULL organization; they are replaced by the
    // placeholder-organization row. `RETURNING` carries their counts into this delta so the
    // migration does not reset the counters (the read-modify-write this replaced folded them
    // in via its `SELECT`, which matched NULL and placeholder alike).
    let purge = db
      .deleteFrom('entity_index_coverage' as any)
      .where('entity_type' as any, '=', scope.entityType)
      .where('with_deleted' as any, '=', scope.withDeleted === true)
      .where('organization_id' as any, 'is', null as any)
    purge = scope.tenantId == null
      ? purge.where('tenant_id' as any, 'is', null as any)
      : purge.where('tenant_id' as any, '=', scope.tenantId)
    const purged = await purge
      .returning(['base_count' as any, 'indexed_count' as any, 'vector_indexed_count' as any])
      .execute() as Array<CoverageRow>
    for (const row of purged ?? []) {
      deltaBase += toCount(row.base_count)
      deltaIndex += toCount(row.indexed_count)
      deltaVector += toCount(row.vector_indexed_count)
    }
  }

  let updated = await updateCoverageRows(db, scope, { deltaBase, deltaIndex, deltaVector })

  if (updated.length === 0 && scope.tenantId == null) {
    // The unique constraint cannot serialize a first insert whose tenant is NULL. Take a
    // transaction-scoped lock only on this rowless branch, then repeat the UPDATE: a creator
    // that won while we waited has committed its row, so this adjustment composes into it.
    await lockCoverageInitialization(db, scope)
    updated = await updateCoverageRows(db, scope, { deltaBase, deltaIndex, deltaVector })
  }

  if (updated.length > 0) {
    // In steady state the scope holds exactly the row just incremented, so the adjustment is
    // the single statement it is described as. Only a scope that somehow accumulated more than
    // one row — a legacy import, or a concurrent first insert on a NULL-tenant scope, which the
    // unique constraint cannot prevent — pays for the collapse, and only until it is collapsed.
    if (updated.length > 1) await pruneDuplicateCoverageRows(db, scope, updated[0]!.id)
    return
  }

  // No row for this scope yet. `ON CONFLICT` closes the insert race for scopes the unique
  // constraint can see. NULL-tenant initialization reaches here only while holding the scoped
  // transaction advisory lock above, so it has the same single-creator guarantee.
  const rows = await db
    .insertInto('entity_index_coverage' as any)
    .values({
      entity_type: scope.entityType,
      tenant_id: scope.tenantId ?? null,
      organization_id: storedOrgId,
      with_deleted: scope.withDeleted === true,
      base_count: Math.max(deltaBase, 0),
      indexed_count: Math.max(deltaIndex, 0),
      vector_indexed_count: Math.max(deltaVector, 0),
      refreshed_at: sql`now()`,
    } as any)
    .onConflict((oc: any) => oc
      .columns(['entity_type', 'tenant_id', 'organization_id', 'with_deleted'])
      .doUpdateSet({
        base_count: sql`greatest(${sql.ref('entity_index_coverage.base_count')} + ${deltaBase}, 0)`,
        indexed_count: sql`greatest(${sql.ref('entity_index_coverage.indexed_count')} + ${deltaIndex}, 0)`,
        vector_indexed_count: sql`greatest(${sql.ref('entity_index_coverage.vector_indexed_count')} + ${deltaVector}, 0)`,
        refreshed_at: sql`now()`,
      } as any))
    .returning(['id' as any])
    .execute() as Array<{ id: string }>

  const keepId = rows?.[0]?.id ?? null
  await pruneDuplicateCoverageRows(db, scope, keepId)
}

async function upsertCoverageRow(
  db: CoverageExecutor,
  scope: CoverageScope,
  counts: { baseCount: number; indexedCount: number; vectorIndexedCount: number }
): Promise<void> {
  const storedOrgId = normalizeOrganizationForStore(scope.organizationId ?? null)
  if (scope.organizationId == null) {
    let purge = db
      .deleteFrom('entity_index_coverage' as any)
      .where('entity_type' as any, '=', scope.entityType)
      .where('with_deleted' as any, '=', scope.withDeleted === true)
      .where('organization_id' as any, 'is', null as any)
    purge = scope.tenantId == null
      ? purge.where('tenant_id' as any, 'is', null as any)
      : purge.where('tenant_id' as any, '=', scope.tenantId)
    await purge.execute()
  }

  const rows = await db
    .insertInto('entity_index_coverage' as any)
    .values({
      entity_type: scope.entityType,
      tenant_id: scope.tenantId ?? null,
      organization_id: storedOrgId,
      with_deleted: scope.withDeleted === true,
      base_count: counts.baseCount,
      indexed_count: counts.indexedCount,
      vector_indexed_count: counts.vectorIndexedCount,
      refreshed_at: sql`now()`,
    } as any)
    .onConflict((oc: any) => oc
      .columns(['entity_type', 'tenant_id', 'organization_id', 'with_deleted'])
      .doUpdateSet({
        base_count: counts.baseCount,
        indexed_count: counts.indexedCount,
        vector_indexed_count: counts.vectorIndexedCount,
        refreshed_at: sql`now()`,
      } as any))
    .returning(['id' as any])
    .execute() as Array<{ id: string }>

  const keepId = rows?.[0]?.id ?? null
  await pruneDuplicateCoverageRows(db, scope, keepId)
}

export async function readCoverageSnapshot(
  db: Kysely<any>,
  scope: CoverageScope
): Promise<(CoverageRow & { baseCount: number; indexedCount: number; vectorIndexedCount: number }) | null> {
  const entityType = String(scope.entityType || '')
  if (!entityType) return null
  const row = await fetchCoverageRow(db, {
    entityType,
    tenantId: scope.tenantId ?? null,
    organizationId: scope.organizationId ?? null,
    withDeleted: scope.withDeleted === true,
  })
  if (!row) return null
  const refreshedAt = row.refreshed_at instanceof Date ? row.refreshed_at : (row.refreshed_at ? new Date(row.refreshed_at) : null)
  return {
    base_count: row.base_count,
    indexed_count: row.indexed_count,
    vector_indexed_count: row.vector_indexed_count,
    refreshed_at: refreshedAt ?? null,
    baseCount: toCount(row.base_count),
    indexedCount: toCount(row.indexed_count),
    vectorIndexedCount: toCount(row.vector_indexed_count),
  }
}

export async function readCoverageSnapshots(
  db: Kysely<any>,
  batch: CoverageBatchScope
): Promise<Map<string, CoverageSnapshot>> {
  const entityTypes = Array.from(
    new Set((batch.entityTypes ?? []).map((id) => String(id || '')).filter((id) => id.length > 0))
  )
  const result = new Map<string, CoverageSnapshot>()
  if (entityTypes.length === 0) return result

  const withDeleted = batch.withDeleted === true
  let query = db
    .selectFrom('entity_index_coverage' as any)
    .select([
      'entity_type' as any,
      'base_count' as any,
      'indexed_count' as any,
      'vector_indexed_count' as any,
      'refreshed_at' as any,
      'organization_id' as any,
    ])
    .where('entity_type' as any, 'in', entityTypes)
    .where('with_deleted' as any, '=', withDeleted)
    .orderBy('refreshed_at' as any, 'desc')
  query = batch.tenantId == null
    ? query.where('tenant_id' as any, 'is', null as any)
    : query.where('tenant_id' as any, '=', batch.tenantId)
  query = applyOrganizationCondition(query as any, 'organization_id', batch.organizationId ?? null)

  const rows = await query.execute() as Array<CoverageRow & { entity_type: string }>
  for (const row of rows ?? []) {
    const entityType = String(row.entity_type || '')
    // Rows are ordered by refreshed_at desc, so the first row seen per entity is the latest.
    if (!entityType || result.has(entityType)) continue
    const refreshedAt = row.refreshed_at instanceof Date
      ? row.refreshed_at
      : (row.refreshed_at ? new Date(row.refreshed_at) : null)
    result.set(entityType, {
      base_count: row.base_count,
      indexed_count: row.indexed_count,
      vector_indexed_count: row.vector_indexed_count,
      refreshed_at: refreshedAt ?? null,
      baseCount: toCount(row.base_count),
      indexedCount: toCount(row.indexed_count),
      vectorIndexedCount: toCount(row.vector_indexed_count),
    })
  }
  return result
}

export async function applyCoverageAdjustments(
  em: EntityManager,
  adjustments: CoverageAdjustment[],
  options?: { trx?: CoverageExecutor },
): Promise<void> {
  if (!adjustments.length) return
  const db = (em as any).getKysely() as Kysely<any>
  const aggregated = aggregateAdjustments(adjustments)
  for (const entry of aggregated) {
    const deltas = {
      deltaBase: entry.deltaBase,
      deltaIndex: entry.deltaIndex,
      deltaVector: entry.deltaVector,
    }
    if (options?.trx) {
      await incrementCoverageRow(options.trx, entry.scope, deltas)
    } else if (entry.scope.tenantId == null) {
      await db.transaction().execute((trx) => incrementCoverageRow(trx, entry.scope, deltas))
    } else {
      await incrementCoverageRow(db, entry.scope, deltas)
    }
  }
}

export async function deleteCoverageForEntity(db: Kysely<any>, entityType: string): Promise<void> {
  if (!entityType) return
  await db
    .deleteFrom('entity_index_coverage' as any)
    .where('entity_type' as any, '=', entityType)
    .execute()
}

async function deleteCoverageScope(db: Kysely<any>, scope: CoverageScope): Promise<void> {
  const { entityType, tenantId, organizationId, withDeleted } = scope
  if (!entityType) return
  let query = db
    .deleteFrom('entity_index_coverage' as any)
    .where('entity_type' as any, '=', entityType)
    .where('with_deleted' as any, '=', withDeleted === true)
  query = tenantId == null
    ? query.where('tenant_id' as any, 'is', null as any)
    : query.where('tenant_id' as any, '=', tenantId)
  await applyOrganizationCondition(query as any, 'organization_id', organizationId ?? null).execute()
}

async function tableHasColumn(db: Kysely<any>, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`
  if (COLUMN_CACHE.has(key)) return COLUMN_CACHE.get(key)!
  const pending = COLUMN_CACHE_PENDING.get(key)
  if (pending) return pending
  const promise = (async () => {
    const exists = await db
      .selectFrom('information_schema.columns' as any)
      .select(sql<number>`1`.as('present'))
      .where(sql<boolean>`table_schema = current_schema()`)
      .where('table_name' as any, '=', table)
      .where('column_name' as any, '=', column)
      .executeTakeFirst()
    const present = !!exists
    COLUMN_CACHE.set(key, present)
    return present
  })()
  COLUMN_CACHE_PENDING.set(key, promise)
  try {
    return await promise
  } finally {
    COLUMN_CACHE_PENDING.delete(key)
  }
}

export type ColumnCheck = { table: string; column: string }

// Batches the `information_schema.columns` introspection used by `refreshCoverageSnapshot`
// into a single query for a whole set of (table, column) pairs, and pre-populates
// `COLUMN_CACHE_PENDING` for every pair before that query even runs. Callers of
// `coverage_warmup.ts` use this so its many concurrently-dispatched `coverage.refresh`
// subscribers hit an already-primed (or in-flight) cache instead of each doing their own
// per-table introspection round trip.
export async function primeColumnCache(db: Kysely<any>, checks: ColumnCheck[]): Promise<void> {
  const missing: Array<{ table: string; column: string; key: string }> = []
  const seen = new Set<string>()
  for (const check of checks) {
    const table = String(check?.table || '')
    const column = String(check?.column || '')
    if (!table || !column) continue
    const key = `${table}.${column}`
    if (seen.has(key)) continue
    seen.add(key)
    if (COLUMN_CACHE.has(key) || COLUMN_CACHE_PENDING.has(key)) continue
    missing.push({ table, column, key })
  }
  if (!missing.length) return

  const tables = Array.from(new Set(missing.map((entry) => entry.table)))
  const columns = Array.from(new Set(missing.map((entry) => entry.column)))

  const batchPromise = (async (): Promise<Set<string>> => {
    const rows = await db
      .selectFrom('information_schema.columns' as any)
      .select(['table_name' as any, 'column_name' as any])
      .where(sql<boolean>`table_schema = current_schema()`)
      .where('table_name' as any, 'in', tables)
      .where('column_name' as any, 'in', columns)
      .execute() as Array<{ table_name: string; column_name: string }>
    return new Set(rows.map((row) => `${row.table_name}.${row.column_name}`))
  })()

  for (const entry of missing) {
    const entryPromise = batchPromise.then((present) => {
      const value = present.has(entry.key)
      COLUMN_CACHE.set(entry.key, value)
      return value
    })
    // Mark the stored promise as handled: when the batch query fails and no
    // `tableHasColumn` caller has adopted this entry yet (the common case — the warmup
    // awaits priming before dispatching any refresh), an orphaned rejection would
    // otherwise crash a plain-Node event worker via unhandledRejection. Awaiting
    // callers still observe the rejection through the stored reference.
    entryPromise.catch(() => undefined)
    COLUMN_CACHE_PENDING.set(entry.key, entryPromise)
  }

  try {
    await batchPromise
  } finally {
    for (const entry of missing) COLUMN_CACHE_PENDING.delete(entry.key)
  }
}

export async function refreshCoverageSnapshot(
  em: EntityManager,
  scope: CoverageScope,
): Promise<{ baseCount: number; indexedCount: number } | null> {
  const entityType = String(scope.entityType || '')
  if (!entityType) return null
  const tenantId = scope.tenantId ?? null
  const organizationId = scope.organizationId ?? null
  const withDeleted = scope.withDeleted === true

  const db = (em as any).getKysely() as Kysely<any>
  const baseTable = resolveEntityTableName(em, entityType)

  const hasOrg = await tableHasColumn(db, baseTable, 'organization_id')
  const hasTenant = await tableHasColumn(db, baseTable, 'tenant_id')
  const hasDeleted = await tableHasColumn(db, baseTable, 'deleted_at')

  // A scope the base table cannot express must not narrow the index side either. Index rows
  // can carry an organization the base table has no column for — `organizations` has no
  // `organization_id` yet its index rows derive one from the record id. Filtering only the
  // index side compares two different populations and reports a gap no reindex can close;
  // returning early instead of recounting left the previous snapshot frozen, which is what
  // surfaced as a permanent "out of sync" row for `directory:organization`.
  //
  // Tenant is different: a base table without `tenant_id` (`user_roles`) cannot be counted
  // per tenant at all, and writing the cross-tenant total into one tenant's row would leak
  // another tenant's volume into it. Drop the unusable scoped row instead, leaving only the
  // global row — which is the one that can be true — rather than freezing a stale count.
  const scopeOrg = organizationId !== null && hasOrg
  if (tenantId !== null && !hasTenant) {
    await deleteCoverageScope(db, { entityType, tenantId, organizationId, withDeleted })
    return null
  }
  const scopeTenant = tenantId !== null && hasTenant

  let baseQuery = db
    .selectFrom(`${baseTable} as b` as any)
    .select(sql`count(*)`.as('count'))
  if (scopeOrg) baseQuery = baseQuery.where('b.organization_id' as any, '=', organizationId)
  if (scopeTenant) baseQuery = baseQuery.where('b.tenant_id' as any, '=', tenantId)
  if (!withDeleted && hasDeleted) baseQuery = baseQuery.where('b.deleted_at' as any, 'is', null as any)

  let indexQuery = db
    .selectFrom('entity_indexes as ei' as any)
    .select(sql`count(*)`.as('count'))
    .where('ei.entity_type' as any, '=', entityType)
  if (scopeOrg) indexQuery = indexQuery.where('ei.organization_id' as any, '=', organizationId)
  if (scopeTenant) indexQuery = indexQuery.where('ei.tenant_id' as any, '=', tenantId)
  if (!withDeleted) indexQuery = indexQuery.where('ei.deleted_at' as any, 'is', null as any)

  const vectorCountPromise = (async (): Promise<number | undefined> => {
    const hasVectorTable = await tableHasColumn(db, 'vector_search', 'entity_id')
    if (!hasVectorTable || typeof tenantId !== 'string' || tenantId.length === 0) return undefined

    try {
      let vectorQuery = db
        .selectFrom('vector_search' as any)
        .select(sql`count(*)`.as('count'))
        .where('entity_id' as any, '=', entityType)
        .where('tenant_id' as any, '=', tenantId)
      if (organizationId !== null) {
        vectorQuery = vectorQuery.where('organization_id' as any, '=', organizationId)
      }
      const vectorRow = await vectorQuery.executeTakeFirst() as { count: unknown } | undefined
      return toCount(vectorRow?.count)
    } catch (err) {
      logger.warn('Failed to resolve vector count for coverage snapshot', {
        entityType,
        tenantId,
        organizationId,
        error: err instanceof Error ? err.message : err,
      })
      return undefined
    }
  })()

  const [baseRow, indexRow, vectorCount] = await Promise.all([
    baseQuery.executeTakeFirst() as Promise<{ count: unknown } | undefined>,
    indexQuery.executeTakeFirst() as Promise<{ count: unknown } | undefined>,
    vectorCountPromise,
  ])

  const baseCount = toCount(baseRow?.count)
  const indexCount = toCount(indexRow?.count)

  await writeCoverageCounts(em, { entityType, tenantId, organizationId, withDeleted }, {
    baseCount,
    indexedCount: indexCount,
    vectorCount,
  })

  return { baseCount, indexedCount: indexCount }
}

export async function writeCoverageCounts(
  em: EntityManager,
  scope: CoverageScope,
  counts: { baseCount?: number; indexedCount?: number; vectorCount?: number }
): Promise<void> {
  const entityType = String(scope.entityType || '')
  if (!entityType) return
  const db = (em as any).getKysely() as Kysely<any>
  const tenantId = scope.tenantId ?? null
  const organizationId = scope.organizationId ?? null
  const withDeleted = scope.withDeleted === true
  const existing = await fetchCoverageRow(db, {
    entityType,
    tenantId,
    organizationId,
    withDeleted,
  })
  const baseCount = counts.baseCount !== undefined
    ? Math.max(0, Math.trunc(toCount(counts.baseCount)))
    : Math.max(0, Math.trunc(toCount(existing?.base_count)))
  const indexCount = counts.indexedCount !== undefined
    ? Math.max(0, Math.trunc(toCount(counts.indexedCount)))
    : Math.max(0, Math.trunc(toCount(existing?.indexed_count)))
  const vectorCount = counts.vectorCount !== undefined
    ? Math.max(0, Math.trunc(toCount(counts.vectorCount)))
    : Math.max(0, Math.trunc(toCount(existing?.vector_indexed_count)))
  await upsertCoverageRow(db, { entityType, tenantId, organizationId, withDeleted }, {
    baseCount,
    indexedCount: indexCount,
    vectorIndexedCount: vectorCount,
  })
}

type AggregatedAdjustment = {
  scope: CoverageScope
  deltaBase: number
  deltaIndex: number
  deltaVector: number
}

function aggregateAdjustments(adjustments: CoverageAdjustment[]): AggregatedAdjustment[] {
  const map = new Map<string, AggregatedAdjustment>()
  for (const adj of adjustments) {
    if (!adj?.entityType) continue
    const deltaBase = Number.isFinite(adj.deltaBase) ? adj.deltaBase : 0
    const deltaIndex = Number.isFinite(adj.deltaIndex) ? adj.deltaIndex : 0
    const deltaVector = Number.isFinite(adj.deltaVector) ? adj.deltaVector! : 0
    if (deltaBase === 0 && deltaIndex === 0 && deltaVector === 0) continue
    const scope: CoverageScope = {
      entityType: adj.entityType,
      tenantId: adj.tenantId ?? null,
      organizationId: adj.organizationId ?? null,
      withDeleted: adj.withDeleted === true,
    }
    const key = scopeKey(scope)
    const existing = map.get(key)
    if (existing) {
      existing.deltaBase += deltaBase
      existing.deltaIndex += deltaIndex
      existing.deltaVector += deltaVector
    } else {
      map.set(key, { scope, deltaBase, deltaIndex, deltaVector })
    }
  }
  return Array.from(map.values())
}

function scopeKey(scope: CoverageScope): string {
  const tenant = scope.tenantId ?? '__tenant_null__'
  const org = normalizeOrganizationForStore(scope.organizationId ?? null)
  const deleted = scope.withDeleted === true ? '1' : '0'
  return `${scope.entityType}|${tenant}|${org}|${deleted}`
}

export function createCoverageAdjustments(input: CoverageDeltaInput): CoverageAdjustment[] {
  const entityType = String(input.entityType || '')
  if (!entityType) return []
  const baseDelta = Number.isFinite(input.baseDelta) ? input.baseDelta : 0
  const indexDelta = Number.isFinite(input.indexDelta) ? input.indexDelta : 0
  const vectorDelta = Number.isFinite(input.vectorDelta) ? input.vectorDelta! : 0
  if (baseDelta === 0 && indexDelta === 0 && vectorDelta === 0) return []
  const withDeleted = input.withDeleted === true
  const tenantId = input.tenantId ?? null
  const organizationId = input.organizationId ?? null
  return [
    {
      entityType,
      tenantId,
      organizationId,
      withDeleted,
      deltaBase: baseDelta,
      deltaIndex: indexDelta,
      deltaVector: vectorDelta,
    },
  ]
}
