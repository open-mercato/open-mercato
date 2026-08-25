import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'
import { isReadProjectionAlwaysConsistent } from '@open-mercato/shared/lib/data/consistency'
import { sql } from 'kysely'
import { markDeleted } from '../lib/indexer'
import { applyCoverageAdjustments, createCoverageAdjustments } from '../lib/coverage'
import {
  loadQueryIndexRowScope,
  resolveQueryIndexRecordScope,
  resolveQueryIndexSourceMetadata,
} from '../lib/subscriber-scope'

export const metadata = { event: 'query_index.delete_one', persistent: false }

// Mirrors `shouldTriggerCoverageRefresh()` in `@open-mercato/shared/lib/data/engine.ts`
// as a small local throttle so per-record deletes stop firing an unconditional, immediate
// full recount. Note: this Map and the shared engine's own throttle Map are independent,
// so a rare race right after a 5-minute window resets on both could double-fire once —
// harmless (the recompute is idempotent) and far cheaper than today's per-delete cost.
const DELETE_COVERAGE_THROTTLE_MS = 5 * 60 * 1000
const lastDeleteCoverageRefreshAt = new Map<string, number>()

function shouldAllowDeleteCoverageRefresh(entityType: string, tenantId: string | null): boolean {
  if (!entityType) return false
  const key = `${entityType}|${tenantId ?? '__null__'}`
  const now = Date.now()
  const last = lastDeleteCoverageRefreshAt.get(key) ?? 0
  if (now - last < DELETE_COVERAGE_THROTTLE_MS) return false
  lastDeleteCoverageRefreshAt.set(key, now)
  return true
}

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
  const suppressCoverage = payload?.suppressCoverage === true
  const coverageDelayMs = typeof payload?.coverageDelayMs === 'number' ? payload.coverageDelayMs : undefined
  const alwaysConsistent = isReadProjectionAlwaysConsistent()
  try {
    const hasPayloadOrganizationId = Object.prototype.hasOwnProperty.call(payload ?? {}, 'organizationId')
    const hasPayloadTenantId = Object.prototype.hasOwnProperty.call(payload ?? {}, 'tenantId')
    const source = resolveQueryIndexSourceMetadata(em, entityType)
    const sourceScope = await loadQueryIndexRowScope(em, source, recordId)
    const resolvedScope = resolveQueryIndexRecordScope({
      payloadOrganizationId: payload?.organizationId,
      payloadTenantId: payload?.tenantId,
      hasPayloadOrganizationId,
      hasPayloadTenantId,
      sourceScope,
    })
    organizationId = resolvedScope.organizationId
    tenantId = resolvedScope.tenantId

    if (alwaysConsistent) {
      const db = (em as any).getKysely()
      // Coverage-count adjustments hit a handful of hot `entity_index_coverage` rows shared
      // by every writer of this entity type/tenant; computed here (inside the transaction, so
      // it can see `wasActive`/the pre-delete row) but applied afterward, off the request path
      // (#5604), so the delete transaction never holds that row's lock waiting on it.
      let pendingCoverageAdjustments: ReturnType<typeof createCoverageAdjustments> = []
      await db.transaction().execute(async (trx: any) => {
        const { wasActive } = await markDeleted(em, { entityType, recordId, organizationId, tenantId, trx })

        let baseQuery = trx
          .selectFrom(source.table as any)
          .select(['deleted_at' as any])
          .where('id' as any, '=', recordId)
        if (source.organizationColumn) {
          baseQuery = baseQuery.where(
            source.organizationColumn as any,
            organizationId === null ? 'is' : '=',
            organizationId as any,
          )
        }
        if (source.tenantColumn) {
          baseQuery = baseQuery.where(sql`${sql.ref(source.tenantColumn)} is not distinct from ${tenantId}`)
        }
        const row = await baseQuery.executeTakeFirst() as { deleted_at: Date | null } | undefined
        const baseDelta = !row || row.deleted_at != null ? -1 : 0

        const baseDeltaOverride =
          typeof payload?.coverageBaseDelta === 'number' ? payload.coverageBaseDelta : undefined
        const indexDeltaOverride =
          typeof payload?.coverageIndexDelta === 'number' ? payload.coverageIndexDelta : undefined
        let effectiveBaseDelta = baseDeltaOverride ?? baseDelta
        let effectiveIndexDelta = indexDeltaOverride ?? (wasActive ? -1 : 0)

        if (!Number.isFinite(effectiveBaseDelta)) effectiveBaseDelta = 0
        if (!Number.isFinite(effectiveIndexDelta)) effectiveIndexDelta = 0

        if (effectiveBaseDelta !== 0 || effectiveIndexDelta !== 0) {
          pendingCoverageAdjustments = createCoverageAdjustments({
            entityType,
            tenantId: tenantId ?? null,
            organizationId: organizationId ?? null,
            baseDelta: effectiveBaseDelta,
            indexDelta: effectiveIndexDelta,
          })
        }
      })

      if (pendingCoverageAdjustments.length) {
        const coverageAdjustments = pendingCoverageAdjustments
        void applyCoverageAdjustments(em, coverageAdjustments).catch((error) => recordIndexerError(
          { em },
          {
            source: 'query_index',
            handler: 'event:query_index.delete_one:coverage',
            error,
            entityType,
            recordId,
            tenantId: tenantId ?? null,
            organizationId: organizationId ?? null,
            payload,
          },
        ).catch(() => {}))
      }

      const bus = ctx.resolve<any>('eventBus')
      const shouldRefreshCoverage =
        !suppressCoverage && (coverageDelayMs === undefined || coverageDelayMs >= 0)
      const coverageRefreshDelay = coverageDelayMs ?? 0
      if (shouldRefreshCoverage) {
        await bus.emitEvent('query_index.coverage.refresh', {
          entityType,
          tenantId: tenantId ?? null,
          organizationId: organizationId ?? null,
          delayMs: coverageRefreshDelay,
        }, { rethrowHandlerErrors: true })
      }
      await bus.emitEvent('search.delete_record', { entityId: entityType, recordId, organizationId, tenantId }, { rethrowHandlerErrors: true })
      return
    }

    const { wasActive } = await markDeleted(em, { entityType, recordId, organizationId, tenantId })

    let baseDelta = 0
    let baseCheckSucceeded = false
    try {
      const db = (em as any).getKysely()
      let baseQuery = db
        .selectFrom(source.table as any)
        .select(['deleted_at' as any])
        .where('id' as any, '=', recordId)
      if (source.organizationColumn) {
        baseQuery = baseQuery.where(
          source.organizationColumn as any,
          organizationId === null ? 'is' : '=',
          organizationId as any,
        )
      }
      if (source.tenantColumn) {
        baseQuery = baseQuery.where(sql`${sql.ref(source.tenantColumn)} is not distinct from ${tenantId}`)
      }
      const row = await baseQuery.executeTakeFirst() as { deleted_at: Date | null } | undefined
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
        // Off the request path (#5604): every write to this entity type/tenant would
        // otherwise serialize on the same coverage row's lock and bloat it under load.
        void applyCoverageAdjustments(em, adjustments).catch((error) => recordIndexerError(
          { em },
          {
            source: 'query_index',
            handler: 'event:query_index.delete_one:coverage',
            error,
            entityType,
            recordId,
            tenantId: tenantId ?? null,
            organizationId: organizationId ?? null,
            payload,
          },
        ).catch(() => {}))
      }
    }

    // The projection row + token removal above are synchronous (the data engine
    // awaits this subscriber) so list reads are consistent immediately. The coverage
    // recompute (a COUNT, run inline when delayMs is 0) and the fulltext delete are
    // secondary, so defer them fire-and-forget to keep write/bulk-delete latency bounded.
    const explicitDelayRequested = typeof payload?.coverageDelayMs === 'number'
    const shouldRefreshCoverage =
      !suppressCoverage &&
      (coverageDelayMs === undefined || coverageDelayMs >= 0) &&
      (explicitDelayRequested || shouldAllowDeleteCoverageRefresh(entityType, tenantId))
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
