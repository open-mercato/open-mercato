import type { EntityManager } from '@mikro-orm/postgresql'
import { type Kysely, sql } from 'kysely'
import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'

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
  db: Kysely<any>,
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
  db: Kysely<any>,
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

async function upsertCoverageRow(
  db: Kysely<any>,
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

export async function applyCoverageAdjustments(
  em: EntityManager,
  adjustments: CoverageAdjustment[]
): Promise<void> {
  if (!adjustments.length) return
  const db = (em as any).getKysely() as Kysely<any>
  const aggregated = aggregateAdjustments(adjustments)
  for (const entry of aggregated) {
    const scope = entry.scope
    const existing = await fetchCoverageRow(db, scope)
    const currentBase = existing ? toCount(existing.base_count) : 0
    const currentIndex = existing ? toCount(existing.indexed_count) : 0
    const currentVector = existing ? toCount(existing.vector_indexed_count) : 0
    const nextBase = Math.max(currentBase + entry.deltaBase, 0)
    const nextIndex = Math.max(currentIndex + entry.deltaIndex, 0)
    const nextVector = Math.max(currentVector + entry.deltaVector, 0)

    await upsertCoverageRow(db, scope, {
      baseCount: nextBase,
      indexedCount: nextIndex,
      vectorIndexedCount: nextVector,
    })
  }
}

export async function deleteCoverageForEntity(db: Kysely<any>, entityType: string): Promise<void> {
  if (!entityType) return
  await db
    .deleteFrom('entity_index_coverage' as any)
    .where('entity_type' as any, '=', entityType)
    .execute()
}

async function tableHasColumn(db: Kysely<any>, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`
  if (COLUMN_CACHE.has(key)) return COLUMN_CACHE.get(key)!
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
}

export async function refreshCoverageSnapshot(
  em: EntityManager,
  scope: CoverageScope,
): Promise<void> {
  const entityType = String(scope.entityType || '')
  if (!entityType) return
  const tenantId = scope.tenantId ?? null
  const organizationId = scope.organizationId ?? null
  const withDeleted = scope.withDeleted === true

  const db = (em as any).getKysely() as Kysely<any>
  const baseTable = resolveEntityTableName(em, entityType)

  const hasOrg = await tableHasColumn(db, baseTable, 'organization_id')
  const hasTenant = await tableHasColumn(db, baseTable, 'tenant_id')
  const hasDeleted = await tableHasColumn(db, baseTable, 'deleted_at')

  if (organizationId !== null && !hasOrg) return
  if (tenantId !== null && !hasTenant) return

  let baseQuery = db
    .selectFrom(`${baseTable} as b` as any)
    .select(sql`count(*)`.as('count'))
  if (organizationId !== null && hasOrg) baseQuery = baseQuery.where('b.organization_id' as any, '=', organizationId)
  if (tenantId !== null && hasTenant) baseQuery = baseQuery.where('b.tenant_id' as any, '=', tenantId)
  if (!withDeleted && hasDeleted) baseQuery = baseQuery.where('b.deleted_at' as any, 'is', null as any)

  const baseRow = await baseQuery.executeTakeFirst() as { count: unknown } | undefined
  const baseCount = toCount(baseRow?.count)

  let indexQuery = db
    .selectFrom('entity_indexes as ei' as any)
    .select(sql`count(*)`.as('count'))
    .where('ei.entity_type' as any, '=', entityType)
  if (organizationId !== null) indexQuery = indexQuery.where('ei.organization_id' as any, '=', organizationId)
  if (tenantId !== null) indexQuery = indexQuery.where('ei.tenant_id' as any, '=', tenantId)
  if (!withDeleted) indexQuery = indexQuery.where('ei.deleted_at' as any, 'is', null as any)

  const indexRow = await indexQuery.executeTakeFirst() as { count: unknown } | undefined
  const indexCount = toCount(indexRow?.count)

  // Count vector entries directly from database
  let vectorCount: number | undefined
  const hasVectorTable = await tableHasColumn(db, 'vector_search', 'entity_id')
  if (hasVectorTable && typeof tenantId === 'string' && tenantId.length > 0) {
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
      vectorCount = toCount(vectorRow?.count)
    } catch (err) {
      console.warn('[query_index] Failed to resolve vector count for coverage snapshot', {
        entityType,
        tenantId,
        organizationId,
        error: err instanceof Error ? err.message : err,
      })
      vectorCount = undefined
    }
  }

  await writeCoverageCounts(em, { entityType, tenantId, organizationId, withDeleted }, {
    baseCount,
    indexedCount: indexCount,
    vectorCount,
  })
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
