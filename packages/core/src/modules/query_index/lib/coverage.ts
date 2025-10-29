import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
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
  refreshed_at: Date | string | null
}

export type CoverageAdjustment = {
  entityType: string
  tenantId: string | null
  organizationId: string | null
  withDeleted?: boolean
  deltaBase: number
  deltaIndex: number
}

const COLUMN_CACHE = new Map<string, boolean>()
const GLOBAL_ORGANIZATION_PLACEHOLDER = '00000000-0000-0000-0000-000000000000'

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

function applyOrganizationCondition(
  qb: Knex.QueryBuilder<any, any>,
  column: string,
  organizationId: string | null | undefined
) {
  const stored = normalizeOrganizationForStore(organizationId ?? null)
  if (stored === GLOBAL_ORGANIZATION_PLACEHOLDER) {
    qb.andWhere((sub) => {
      sub.whereNull(column).orWhere(column, GLOBAL_ORGANIZATION_PLACEHOLDER)
    })
  } else {
    qb.andWhere(column, stored)
  }
}

async function fetchCoverageRow(
  knex: Knex,
  scope: CoverageScope
): Promise<(CoverageRow & { organization_id: string | null }) | null> {
  const { entityType, tenantId, organizationId, withDeleted } = scope
  const row = await knex('entity_index_coverage')
    .select(['base_count', 'indexed_count', 'refreshed_at', 'organization_id'])
    .where('entity_type', entityType)
    .where('tenant_id', tenantId ?? null)
    .where('with_deleted', withDeleted === true)
    .modify((qb) => applyOrganizationCondition(qb, 'organization_id', organizationId ?? null))
    .orderBy('refreshed_at', 'desc')
    .first<CoverageRow & { organization_id: string | null }>()
  return row ?? null
}

async function upsertCoverageRow(
  knex: Knex,
  scope: CoverageScope,
  counts: { baseCount: number; indexedCount: number }
) {
  const storedOrgId = normalizeOrganizationForStore(scope.organizationId ?? null)
  if (scope.organizationId == null) {
    await knex('entity_index_coverage')
      .where('entity_type', scope.entityType)
      .where('tenant_id', scope.tenantId ?? null)
      .where('with_deleted', scope.withDeleted === true)
      .whereNull('organization_id')
      .del()
  }

  await knex('entity_index_coverage')
    .insert({
      entity_type: scope.entityType,
      tenant_id: scope.tenantId ?? null,
      organization_id: storedOrgId,
      with_deleted: scope.withDeleted === true,
      base_count: counts.baseCount,
      indexed_count: counts.indexedCount,
      refreshed_at: knex.fn.now(),
    })
    .onConflict(['entity_type', 'tenant_id', 'organization_id', 'with_deleted'])
    .merge({
      base_count: counts.baseCount,
      indexed_count: counts.indexedCount,
      refreshed_at: knex.fn.now(),
    })
}

export async function readCoverageSnapshot(
  knex: Knex,
  scope: CoverageScope
): Promise<(CoverageRow & { baseCount: number; indexedCount: number }) | null> {
  const entityType = String(scope.entityType || '')
  if (!entityType) return null
  const row = await fetchCoverageRow(knex, {
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
    refreshed_at: refreshedAt ?? null,
    baseCount: toCount(row.base_count),
    indexedCount: toCount(row.indexed_count),
  }
}

export async function applyCoverageAdjustments(
  em: EntityManager,
  adjustments: CoverageAdjustment[]
): Promise<void> {
  if (!adjustments.length) return
  const knex = (em as any).getConnection().getKnex() as Knex

  console.log('Applying coverage adjustments', adjustments);
  for (const adj of adjustments) {
    if (!adj.entityType) continue
    const withDeleted = adj.withDeleted === true
    const deltaBase = Number.isFinite(adj.deltaBase) ? adj.deltaBase : 0
    const deltaIndex = Number.isFinite(adj.deltaIndex) ? adj.deltaIndex : 0
    if (deltaBase === 0 && deltaIndex === 0) continue

    const scope: CoverageScope = {
      entityType: adj.entityType,
      tenantId: adj.tenantId ?? null,
      organizationId: adj.organizationId ?? null,
      withDeleted,
    }
    const existing = await fetchCoverageRow(knex, scope)
    const currentBase = existing ? toCount(existing.base_count) : 0
    const currentIndex = existing ? toCount(existing.indexed_count) : 0
    const nextBase = Math.max(currentBase + deltaBase, 0)
    const nextIndex = Math.max(currentIndex + deltaIndex, 0)

    await upsertCoverageRow(knex, scope, { baseCount: nextBase, indexedCount: nextIndex })
  }
}

export async function deleteCoverageForEntity(knex: Knex, entityType: string): Promise<void> {
  if (!entityType) return
  await knex('entity_index_coverage').where({ entity_type: entityType }).del()
}

async function tableHasColumn(knex: Knex, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`
  if (COLUMN_CACHE.has(key)) return COLUMN_CACHE.get(key)!
  const exists = await knex('information_schema.columns')
    .where({ table_schema: 'public', table_name: table, column_name: column })
    .first()
  const present = !!exists
  COLUMN_CACHE.set(key, present)
  return present
}

export async function refreshCoverageSnapshot(em: EntityManager, scope: CoverageScope): Promise<void> {
  const entityType = String(scope.entityType || '')
  if (!entityType) return
  const tenantId = scope.tenantId ?? null
  const organizationId = scope.organizationId ?? null
  const withDeleted = scope.withDeleted === true

  const knex = (em as any).getConnection().getKnex() as Knex
  const baseTable = resolveEntityTableName(em, entityType)

  const hasOrg = await tableHasColumn(knex, baseTable, 'organization_id')
  const hasTenant = await tableHasColumn(knex, baseTable, 'tenant_id')
  const hasDeleted = await tableHasColumn(knex, baseTable, 'deleted_at')

  if (organizationId !== null && !hasOrg) return
  if (tenantId !== null && !hasTenant) return

  let baseQuery = knex({ b: baseTable }).count({ count: '*' })
  if (organizationId !== null && hasOrg) baseQuery = baseQuery.where('b.organization_id', organizationId)
  if (tenantId !== null && hasTenant) baseQuery = baseQuery.where('b.tenant_id', tenantId)
  if (!withDeleted && hasDeleted) baseQuery = baseQuery.whereNull('b.deleted_at')

  const baseRow = await baseQuery.first()
  const baseCount = toCount(baseRow?.count)

  let indexQuery = knex({ ei: 'entity_indexes' })
    .count({ count: '*' })
    .where('ei.entity_type', entityType)
  if (organizationId !== null) indexQuery = indexQuery.where('ei.organization_id', organizationId)
  if (tenantId !== null) indexQuery = indexQuery.where('ei.tenant_id', tenantId)
  if (!withDeleted) indexQuery = indexQuery.whereNull('ei.deleted_at')

  const indexRow = await indexQuery.first()
  const indexCount = toCount(indexRow?.count)

  await upsertCoverageRow(knex, { entityType, tenantId, organizationId, withDeleted }, { baseCount, indexedCount: indexCount })
}
