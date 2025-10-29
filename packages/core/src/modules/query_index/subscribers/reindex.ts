import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { upsertIndexRow } from '../lib/indexer'
import { applyCoverageAdjustments, createCoverageAdjustments, writeCoverageCounts, refreshCoverageSnapshot } from '../lib/coverage'
import type { CoverageAdjustment } from '../lib/coverage'

export const metadata = { event: 'query_index.reindex', persistent: true }

const deriveOrgFromId = new Set<string>(['directory:organization'])
const COVERAGE_FLUSH_BATCH = 100
const COVERAGE_REFRESH_THROTTLE_MS = 5 * 60 * 1000
const lastCoverageReset = new Map<string, number>()

export default async function handle(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  const em = ctx.resolve<any>('em')
  const knex = (em as any).getConnection().getKnex()
  const eventBus = ctx.resolve<any>('eventBus')

  const entityType = String(payload?.entityType || '')
  if (!entityType) return
  // Keep undefined to mean "no filter"; null to mean "global-only"
  const tenantId: string | null | undefined = payload?.tenantId
  const forceFull: boolean = Boolean(payload?.force)

  const table = resolveEntityTableName(em, entityType)

  const lockScope = () => {
    let query = knex('entity_index_jobs').where('entity_type', entityType)
    query = query.whereNull('organization_id')
    query = query.whereRaw('tenant_id is not distinct from ?', [tenantId ?? null])
    return query
  }

  // If forced, clear any previous lock for this scope
  if (forceFull) {
    try { await lockScope().del() } catch {}
  }

  // Check existing lock
  const existing = await lockScope().first()

  // Create lock if not resuming
  if (!existing) {
    try {
      await knex('entity_index_jobs').insert({
        entity_type: entityType,
        organization_id: null,
        tenant_id: tenantId ?? null,
        status: 'reindexing',
        started_at: knex.fn.now(),
      })
    } catch {}
  }

  try {
    // Detect optional multi-tenant/deleted columns for the base table
    const hasOrgCol = await knex.schema.hasColumn(table, 'organization_id')
    const hasTenantCol = await knex.schema.hasColumn(table, 'tenant_id')
    const hasDeletedCol = await knex.schema.hasColumn(table, 'deleted_at')
    const coverageScopeKey = (tenantValue: string | null) => `${tenantValue ?? '__null__'}`

    // Build reusable base query for counts and iteration
    const baseWhere = (builder: any) => {
      if (hasDeletedCol) builder.whereNull('b.deleted_at')
      if (tenantId !== undefined && hasTenantCol) {
        if (tenantId === null) builder.whereNull('b.tenant_id')
        else builder.where('b.tenant_id', tenantId)
      }
    }

    const baseCounts = new Map<string | null, number>()
    if (hasTenantCol && tenantId === undefined) {
      const rows = await knex({ b: table })
        .modify(baseWhere)
        .select(knex.raw('b.tenant_id as tenant_id'))
        .count<{ count: unknown }[]>({ count: '*' })
        .groupBy('b.tenant_id')
      for (const row of rows) {
        const tenantValue = row?.tenant_id ?? null
        const count = toNumber((row as any)?.count)
        baseCounts.set(tenantValue, count)
      }
    } else {
      const row = await knex({ b: table })
        .modify(baseWhere)
        .count({ count: '*' })
        .first()
      const key = tenantId === undefined ? null : tenantId ?? null
      baseCounts.set(key, toNumber(row?.count))
    }

    // Reset coverage counts for scopes unless recently refreshed
    const now = Date.now()
    for (const [tenantValue, count] of baseCounts) {
      const key = `${entityType}|${coverageScopeKey(tenantValue)}`
      const last = lastCoverageReset.get(key) ?? 0
      if (now - last < COVERAGE_REFRESH_THROTTLE_MS && !forceFull) continue
      await writeCoverageCounts(em, { entityType, tenantId: tenantValue, organizationId: null, withDeleted: false }, { baseCount: count, indexedCount: 0 })
      lastCoverageReset.set(key, now)
    }

    // Build base query depending on mode; select only columns that exist
    const baseSelect: any[] = ['b.id']
    if (hasOrgCol) baseSelect.push('b.organization_id')
    if (hasTenantCol) baseSelect.push('b.tenant_id')
    let q = knex({ b: table }).select(baseSelect)
    q = q.modify(baseWhere)

    const rows = await q
    const adjustments: CoverageAdjustment[] = []
    const flushAdjustments = async () => {
      if (!adjustments.length) return
      await applyCoverageAdjustments(em, adjustments.splice(0, adjustments.length))
    }

    for (const r of rows) {
      const scopeOrg = hasOrgCol
        ? (r as any).organization_id ?? null
        : (deriveOrgFromId.has(entityType) ? String((r as any).id) : null)
      const scopeTenant = tenantId !== undefined
        ? tenantId ?? null
        : (hasTenantCol ? ((r as any).tenant_id ?? null) : null)

      const result = await upsertIndexRow(em, {
        entityType,
        recordId: String(r.id),
        organizationId: scopeOrg,
        tenantId: scopeTenant,
      })

      const doc = result.doc
      const isActive = !!doc && (doc.deleted_at == null || doc.deleted_at === null)
      if (isActive) {
        adjustments.push(
          ...createCoverageAdjustments({
            entityType,
            tenantId: scopeTenant ?? null,
            organizationId: null,
            baseDelta: 0,
            indexDelta: 1,
          })
        )
        if (adjustments.length >= COVERAGE_FLUSH_BATCH) {
          await flushAdjustments()
        }
      }

      void eventBus
        .emitEvent('query_index.vectorize_one', {
          entityType,
          recordId: String(r.id),
          organizationId: scopeOrg,
          tenantId: scopeTenant,
        })
        .catch(() => undefined)
    }

    await flushAdjustments()

    // Final sync to ensure counts match persisted data
    for (const [tenantValue] of baseCounts) {
      await refreshCoverageSnapshot(em, {
        entityType,
        tenantId: tenantValue,
        organizationId: null,
        withDeleted: false,
      })
    }
  } finally {
    // Always remove the lock record for this scope so a restart is possible
    try { await lockScope().del() } catch {}
  }
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}
