import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { upsertIndexRow } from '../lib/indexer'
import { applyCoverageAdjustments } from '../lib/coverage'
import type { CoverageAdjustment } from '../lib/coverage'

export const metadata = { event: 'query_index.upsert_one', persistent: false }

export default async function handle(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  const em = ctx.resolve<any>('em')
  const entityType = String(payload?.entityType || '')
  const recordId = String(payload?.recordId || '')
  if (!entityType || !recordId) return
  let organizationId = payload?.organizationId ?? null
  let tenantId = payload?.tenantId ?? null
  const suppressCoverage = payload?.suppressCoverage === true
  const coverageDelayMs = typeof payload?.coverageDelayMs === 'number' ? payload.coverageDelayMs : undefined
  // Fill missing scope from base table if needed
  if (organizationId == null || tenantId == null) {
    try {
      const knex = (em as any).getConnection().getKnex()
      const table = resolveEntityTableName(em, entityType)
      const row = await knex(table).select(['organization_id', 'tenant_id']).where({ id: recordId }).first()
      if (organizationId == null) organizationId = row?.organization_id ?? organizationId
      if (tenantId == null) tenantId = row?.tenant_id ?? tenantId
    } catch {}
  }
  const result = await upsertIndexRow(em, { entityType, recordId, organizationId, tenantId })
  if (!suppressCoverage) {
    const doc = result.doc
    const isActive = !!doc && (doc.deleted_at == null || doc.deleted_at === null)
    const adjustments: CoverageAdjustment[] = []

    const push = (orgId: string | null, deltaBase: number, deltaIndex: number) => {
      if (deltaBase === 0 && deltaIndex === 0) return
      adjustments.push({
        entityType,
        tenantId: tenantId ?? null,
        organizationId: orgId,
        withDeleted: false,
        deltaBase,
        deltaIndex,
      })
    }

    if (isActive) {
      if (result.created) {
        push(organizationId ?? null, 1, 1)
        if (organizationId != null) push(null, 1, 1)
      } else if (result.revived) {
        push(organizationId ?? null, 1, 1)
        if (organizationId != null) push(null, 1, 1)
      }
    }

    if (adjustments.length) {
      await applyCoverageAdjustments(em, adjustments)
    }
    if (!suppressCoverage && coverageDelayMs !== undefined && coverageDelayMs >= 0) {
      try {
        const bus = ctx.resolve<any>('eventBus')
        await bus.emitEvent('query_index.coverage.refresh', {
          entityType,
          tenantId: tenantId ?? null,
          organizationId,
          delayMs: coverageDelayMs,
        })
        if (organizationId !== null) {
          await bus.emitEvent('query_index.coverage.refresh', {
            entityType,
            tenantId: tenantId ?? null,
            organizationId: null,
            delayMs: coverageDelayMs,
          })
        }
      } catch {}
    }
  }
  // Kick off secondary pass (vectorize) asynchronously
  try {
    const bus = ctx.resolve<any>('eventBus')
    await bus.emitEvent('query_index.vectorize_one', { entityType, recordId, organizationId, tenantId })
  } catch {}
}
