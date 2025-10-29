import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { markDeleted } from '../lib/indexer'
import { applyCoverageAdjustments } from '../lib/coverage'
import type { CoverageAdjustment } from '../lib/coverage'

export const metadata = { event: 'query_index.delete_one', persistent: false }

export default async function handle(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  const em = ctx.resolve<any>('em')
  const entityType = String(payload?.entityType || '')
  const recordId = String(payload?.recordId || '')
  if (!entityType || !recordId) return
  let organizationId = payload?.organizationId ?? null
  let tenantId = payload?.tenantId ?? null
  const coverageDelayMs = typeof payload?.coverageDelayMs === 'number' ? payload.coverageDelayMs : undefined
  // Fill missing org from base table if needed
  if (organizationId == null || tenantId == null) {
    try {
      const knex = (em as any).getConnection().getKnex()
      const table = resolveEntityTableName(em, entityType)
      const row = await knex(table).select(['organization_id', 'tenant_id']).where({ id: recordId }).first()
      if (organizationId == null) organizationId = row?.organization_id ?? organizationId
      if (tenantId == null) tenantId = row?.tenant_id ?? tenantId
    } catch {}
  }
  const { wasActive } = await markDeleted(em, { entityType, recordId, organizationId, tenantId })

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

  let baseDelta = 0
  let baseCheckSucceeded = false
  try {
    const knex = (em as any).getConnection().getKnex()
    const table = resolveEntityTableName(em, entityType)
    const row = await knex(table).select(['deleted_at']).where({ id: recordId }).first()
    const baseMissing = !row
    const baseDeleted = baseMissing || (row && row.deleted_at != null)
    baseCheckSucceeded = true
    if (baseDeleted) baseDelta = -1
  } catch {}
  if (!baseCheckSucceeded) baseDelta = -1

  const indexDelta = wasActive ? -1 : 0
  if (baseDelta !== 0 || indexDelta !== 0) {
    push(organizationId ?? null, baseDelta, indexDelta)
    if (organizationId != null) push(null, baseDelta, indexDelta)
    await applyCoverageAdjustments(em, adjustments)
  }

  const shouldRefreshCoverage = coverageDelayMs === undefined || coverageDelayMs >= 0
  if (shouldRefreshCoverage) {
    const delay = coverageDelayMs ?? 0
    try {
      const bus = ctx.resolve<any>('eventBus')
      await bus.emitEvent('query_index.coverage.refresh', {
        entityType,
        tenantId: tenantId ?? null,
        organizationId,
        delayMs: delay,
      })
      if (organizationId !== null) {
        await bus.emitEvent('query_index.coverage.refresh', {
          entityType,
          tenantId: tenantId ?? null,
          organizationId: null,
          delayMs: delay,
        })
      }
    } catch {}
  }
}
