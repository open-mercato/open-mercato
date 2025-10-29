import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { upsertIndexRow } from '../lib/indexer'
import { applyCoverageAdjustments, createCoverageAdjustments } from '../lib/coverage'

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
    let baseDelta: number | undefined =
      typeof payload?.coverageBaseDelta === 'number' ? payload.coverageBaseDelta : undefined
    let indexDelta: number | undefined =
      typeof payload?.coverageIndexDelta === 'number' ? payload.coverageIndexDelta : undefined
    const crudAction = typeof payload?.crudAction === 'string' ? payload.crudAction : undefined

    if (baseDelta === undefined) {
      if (result.revived) baseDelta = 1
      else if (crudAction === 'created') baseDelta = 1
      else baseDelta = 0
    }

    if (indexDelta === undefined) {
      if (isActive && (result.created || result.revived)) indexDelta = 1
      else indexDelta = 0
    }

    if (!isActive && baseDelta > 0) baseDelta = 0
    if (!isActive && indexDelta > 0) indexDelta = 0
    if (!Number.isFinite(baseDelta)) baseDelta = 0
    if (!Number.isFinite(indexDelta)) indexDelta = 0

    const adjustments = createCoverageAdjustments({
      entityType,
      tenantId: tenantId ?? null,
      organizationId: organizationId ?? null,
      baseDelta,
      indexDelta,
    })
    if (adjustments.length) {
      await applyCoverageAdjustments(em, adjustments)
    }
    if (coverageDelayMs !== undefined && coverageDelayMs >= 0) {
      try {
        const bus = ctx.resolve<any>('eventBus')
        await bus.emitEvent('query_index.coverage.refresh', {
          entityType,
          tenantId: tenantId ?? null,
          organizationId: null,
          delayMs: coverageDelayMs,
        })
      } catch {}
    }
  }
  // Kick off secondary pass (vectorize) asynchronously
  try {
    const bus = ctx.resolve<any>('eventBus')
    await bus.emitEvent('query_index.vectorize_one', { entityType, recordId, organizationId, tenantId })
  } catch {}
}
