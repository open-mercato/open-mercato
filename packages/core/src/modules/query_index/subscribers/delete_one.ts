import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'
import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { sql } from 'kysely'
import { markDeleted } from '../lib/indexer'
import { applyCoverageAdjustments, createCoverageAdjustments } from '../lib/coverage'
import { loadQueryIndexRowScope, resolveQueryIndexRecordScope } from '../lib/subscriber-scope'

export const metadata = { event: 'query_index.delete_one', persistent: false }

export default async function handle(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  // Forked EntityManager — this awaited subscriber runs synchronously on the request
  // `em`; isolating it prevents our queries/writes from resetting the originating CRUD
  // write's UnitOfWork and dropping its pending changes. See upsert_one.ts for detail.
  const baseEm = ctx.resolve<any>('em')
  const em = typeof baseEm?.fork === 'function' ? baseEm.fork() : baseEm
  const entityType = String(payload?.entityType || '')
  const recordId = String(payload?.recordId || '')
  if (!entityType || !recordId) return
  let organizationId: string | null = payload?.organizationId ?? null
  let tenantId: string | null = payload?.tenantId ?? null
  const coverageDelayMs = typeof payload?.coverageDelayMs === 'number' ? payload.coverageDelayMs : undefined
  try {
    const hasPayloadOrganizationId = Object.prototype.hasOwnProperty.call(payload ?? {}, 'organizationId')
    const hasPayloadTenantId = Object.prototype.hasOwnProperty.call(payload ?? {}, 'tenantId')
    const rowScope = await loadQueryIndexRowScope(em, entityType, recordId).catch(() => null)
    const resolvedScope = resolveQueryIndexRecordScope({
      payloadOrganizationId: payload?.organizationId,
      payloadTenantId: payload?.tenantId,
      hasPayloadOrganizationId,
      hasPayloadTenantId,
      rowScope,
    })
    organizationId = resolvedScope.organizationId
    tenantId = resolvedScope.tenantId

    const { wasActive } = await markDeleted(em, { entityType, recordId, organizationId, tenantId })

    let baseDelta = 0
    let baseCheckSucceeded = false
    try {
      const db = (em as any).getKysely()
      const table = resolveEntityTableName(em, entityType)
      const row = await db
        .selectFrom(table as any)
        .select(['deleted_at' as any])
        .where('id' as any, '=', recordId)
        .where('organization_id' as any, organizationId === null ? 'is' : '=', organizationId as any)
        .where(sql`tenant_id is not distinct from ${tenantId}`)
        .executeTakeFirst() as { deleted_at: Date | null } | undefined
      const baseMissing = !row
      const baseDeleted = baseMissing || (row && row.deleted_at != null)
      baseCheckSucceeded = true
      if (baseDeleted) baseDelta = -1
    } catch {}
    if (!baseCheckSucceeded) baseDelta = -1

    const baseDeltaOverride =
      typeof payload?.coverageBaseDelta === 'number' ? payload.coverageBaseDelta : undefined
    const indexDeltaOverride =
      typeof payload?.coverageIndexDelta === 'number' ? payload.coverageIndexDelta : undefined
    let effectiveBaseDelta = baseDeltaOverride ?? baseDelta
    let effectiveIndexDelta = indexDeltaOverride ?? (wasActive ? -1 : 0)

    if (!Number.isFinite(effectiveBaseDelta)) effectiveBaseDelta = 0
    if (!Number.isFinite(effectiveIndexDelta)) effectiveIndexDelta = 0

    if (effectiveBaseDelta !== 0 || effectiveIndexDelta !== 0) {
      const adjustments = createCoverageAdjustments({
        entityType,
        tenantId: tenantId ?? null,
        organizationId: organizationId ?? null,
        baseDelta: effectiveBaseDelta,
        indexDelta: effectiveIndexDelta,
      })
      if (adjustments.length) {
        await applyCoverageAdjustments(em, adjustments)
      }
    }

    // The projection row + token removal above are synchronous (the data engine
    // awaits this subscriber) so list reads are consistent immediately. The coverage
    // recompute (a COUNT, run inline when delayMs is 0) and the fulltext delete are
    // secondary, so defer them fire-and-forget to keep write/bulk-delete latency bounded.
    const shouldRefreshCoverage = coverageDelayMs === undefined || coverageDelayMs >= 0
    const coverageRefreshDelay = coverageDelayMs ?? 0
    void (async () => {
      try {
        const bus = ctx.resolve<any>('eventBus')
        if (shouldRefreshCoverage) {
          await bus.emitEvent('query_index.coverage.refresh', {
            entityType,
            tenantId: tenantId ?? null,
            organizationId: organizationId ?? null,
            delayMs: coverageRefreshDelay,
          })
        }
        await bus.emitEvent('search.delete_record', { entityId: entityType, recordId, organizationId, tenantId })
      } catch (error) {
        await recordIndexerError(
          { em },
          {
            source: 'query_index',
            handler: 'event:query_index.delete_one:coverage_search',
            error,
            entityType,
            recordId,
            tenantId: tenantId ?? null,
            organizationId: organizationId ?? null,
            payload,
          },
        ).catch(() => {})
      }
    })()
  } catch (error) {
    await recordIndexerError(
      { em },
      {
        source: 'query_index',
        handler: 'event:query_index.delete_one',
        error,
        entityType,
        recordId,
        tenantId: tenantId ?? null,
        organizationId: organizationId ?? null,
        payload,
      },
    )
    throw error
  }
}
