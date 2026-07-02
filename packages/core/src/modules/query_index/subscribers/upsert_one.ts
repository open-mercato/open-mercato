import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'
import { isReadProjectionAlwaysConsistent } from '@open-mercato/shared/lib/data/consistency'
import { upsertIndexRow, reindexSearchTokensForRecord, type UpsertIndexResult } from '../lib/indexer'
import { applyCoverageAdjustments, createCoverageAdjustments } from '../lib/coverage'
import { loadQueryIndexRowScope, resolveQueryIndexRecordScope } from '../lib/subscriber-scope'

export const metadata = { event: 'query_index.upsert_one', persistent: false }

export default async function handle(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  // Run index maintenance on a FORKED EntityManager (fresh identity map + UnitOfWork)
  // so it can never disturb the originating CRUD write's `em`. The data engine awaits
  // this emit for read-your-writes consistency, which means the subscriber runs
  // synchronously on the request `em`; sharing it would let our `em.find` / raw
  // `getKysely()` queries reset the caller's UoW change-tracking and silently drop the
  // caller's pending write (e.g. the deal's `setCustomFields` insert). The fork reads
  // the same committed DB rows via the shared connection but keeps its own UoW.
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

    const searchTokenDoc = typeof payload?.searchTokenDoc === 'object' && payload.searchTokenDoc && !Array.isArray(payload.searchTokenDoc)
      ? (payload.searchTokenDoc as Record<string, unknown>)
      : null
    if (alwaysConsistent) {
      const db = (em as any).getKysely()
      let result: UpsertIndexResult | null = null
      await db.transaction().execute(async (trx: any) => {
        result = await upsertIndexRow(em, {
          entityType,
          recordId,
          organizationId,
          tenantId,
          searchTokenDoc,
          deferSearchTokens: false,
          trx,
        })
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
            await applyCoverageAdjustments(em, adjustments, { trx })
          }
        }
      })

      const bus = ctx.resolve<any>('eventBus')
      const eventScope = { entityType, recordId, organizationId, tenantId }
      await bus.emitEvent('query_index.vectorize_one', eventScope, { rethrowHandlerErrors: true })
      await bus.emitEvent('search.index_record', { entityId: entityType, recordId, organizationId, tenantId }, { rethrowHandlerErrors: true })
      if (!suppressCoverage && coverageDelayMs !== undefined && coverageDelayMs >= 0) {
        await bus.emitEvent('query_index.coverage.refresh', {
          entityType,
          tenantId: tenantId ?? null,
          organizationId: organizationId ?? null,
          delayMs: coverageDelayMs,
        }, { rethrowHandlerErrors: true })
      }
      return
    }
    // Update the projection row synchronously so list reads (`customValues`) are
    // consistent the moment the write returns; defer the heavy search-token rebuild.
    const result = await upsertIndexRow(em, {
      entityType,
      recordId,
      organizationId,
      tenantId,
      searchTokenDoc,
      deferSearchTokens: true,
    })
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
            organizationId: organizationId ?? null,
            delayMs: coverageDelayMs,
          })
        } catch {}
      }
    }
    // Defer the heavy, eventually-consistent tail: search-token rebuild + vectorize +
    // fulltext indexing. The data engine awaits this subscriber for projection
    // consistency, so this work runs fire-and-forget to keep write latency bounded.
    const deferredScope = { entityType, recordId, organizationId, tenantId }
    const resolvedDoc = result.doc
    void (async () => {
      try {
        await reindexSearchTokensForRecord(em, { ...deferredScope, doc: resolvedDoc, searchTokenDoc })
        const bus = ctx.resolve<any>('eventBus')
        await bus.emitEvent('query_index.vectorize_one', deferredScope)
        await bus.emitEvent('search.index_record', { entityId: entityType, recordId, organizationId, tenantId })
      } catch (error) {
        await recordIndexerError(
          { em },
          {
            source: 'query_index',
            handler: 'event:query_index.upsert_one:search_tokens',
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
        handler: 'event:query_index.upsert_one',
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
