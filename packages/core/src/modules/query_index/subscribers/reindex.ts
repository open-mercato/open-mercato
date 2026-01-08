import type { EntityManager } from '@mikro-orm/postgresql'
import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'
import { recordIndexerLog } from '@open-mercato/shared/lib/indexers/status-log'
import { reindexEntity } from '../lib/reindexer'
import type { VectorIndexService } from '@open-mercato/vector'

export const metadata = { event: 'query_index.reindex', persistent: true }

export default async function handle(payload: any, ctx: { resolve: <T=any>(name: string) => T }) {
  const em = ctx.resolve<EntityManager>('em')
  const eventBus = ctx.resolve<any>('eventBus')
  let vectorService: VectorIndexService | null = null
  try {
    vectorService = ctx.resolve<VectorIndexService>('vectorIndexService')
  } catch {
    vectorService = null
  }
  const entityType = String(payload?.entityType || '')
  if (!entityType) return
  // Keep undefined to mean "no filter"; null to mean "global-only"
  const tenantId: string | null | undefined = payload?.tenantId
  const organizationId: string | null | undefined = payload?.organizationId
  const forceFull: boolean = Boolean(payload?.force)
  const batchSize = Number.isFinite(payload?.batchSize) ? Number(payload.batchSize) : undefined
  const partitionCount = Number.isFinite(payload?.partitionCount) ? Math.max(1, Math.trunc(payload.partitionCount)) : undefined
  const partitionIndex = Number.isFinite(payload?.partitionIndex) ? Math.max(0, Math.trunc(payload.partitionIndex)) : undefined
  const resetCoverage = typeof payload?.resetCoverage === 'boolean' ? payload.resetCoverage : undefined

  try {
    await recordIndexerLog(
      { em },
      {
        source: 'query_index',
        handler: 'event:query_index.reindex',
        message: `Reindex started for ${entityType}`,
        entityType,
        tenantId: tenantId ?? null,
        organizationId: organizationId ?? null,
        details: {
          force: forceFull,
          batchSize: batchSize ?? null,
          partitionCount: partitionCount ?? null,
          partitionIndex: partitionIndex ?? null,
          resetCoverage: resetCoverage ?? null,
        },
      },
    )
    const result = await reindexEntity(em, {
      entityType,
      tenantId,
      organizationId,
      force: forceFull,
      batchSize,
      eventBus,
      emitVectorizeEvents: true,
      partitionCount,
      partitionIndex,
      resetCoverage,
      vectorService,
    })
    await recordIndexerLog(
      { em },
      {
        source: 'query_index',
        handler: 'event:query_index.reindex',
        message: `Reindex completed for ${entityType}`,
        entityType,
        tenantId: tenantId ?? null,
        organizationId: organizationId ?? null,
        details: {
          processed: result.processed,
          total: result.total,
          tenantScopes: result.tenantScopes,
          scopes: result.scopes,
        },
      },
    )
  } catch (error) {
    await recordIndexerLog(
      { em },
      {
        source: 'query_index',
        handler: 'event:query_index.reindex',
        level: 'warn',
        message: `Reindex failed for ${entityType}`,
        entityType,
        tenantId: tenantId ?? null,
        organizationId: organizationId ?? null,
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      },
    ).catch(() => undefined)
    await recordIndexerError(
      { em },
      {
        source: 'query_index',
        handler: 'event:query_index.reindex',
        error,
        entityType,
        tenantId: tenantId ?? null,
        organizationId: organizationId ?? null,
        payload,
      },
    )
    throw error
  }
}
