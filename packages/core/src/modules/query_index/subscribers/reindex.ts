import type { EntityManager } from '@mikro-orm/postgresql'
import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'
import { recordIndexerLog } from '@open-mercato/shared/lib/indexers/status-log'
import { reindexEntity } from '../lib/reindexer'
import type { VectorIndexService } from '@open-mercato/search/vector'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'

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
  const requestedByUserId = typeof payload?.requestedByUserId === 'string' ? payload.requestedByUserId : null

  const progressTenantId = typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : null
  const progressOrganizationId = typeof organizationId === 'string' && organizationId.length > 0 ? organizationId : null
  const progressPartitionIndex = Number.isFinite(partitionIndex) ? partitionIndex : null
  const progressPartitionCount = Number.isFinite(partitionCount) ? partitionCount : null
  let progressService: ProgressService | null = null
  let progressJobId: string | null = null
  let progressEnabled = false
  try {
    progressService = ctx.resolve<ProgressService>('progressService')
    progressEnabled = progressService != null && progressTenantId != null
  } catch {
    progressService = null
    progressEnabled = false
  }

  const updateProgress = async (
    info: { processed: number; total: number },
    options?: { complete?: boolean; failed?: boolean; errorMessage?: string },
  ): Promise<void> => {
    if (!progressEnabled || !progressService || !progressTenantId) return
    const progressCtx = {
      tenantId: progressTenantId,
      organizationId: progressOrganizationId,
      userId: requestedByUserId,
    }
    const totalCount = Number.isFinite(info.total) ? Math.max(0, info.total) : 0
    const processedCount = Number.isFinite(info.processed) ? Math.max(0, info.processed) : 0
    const progressPercent = totalCount > 0 ? Math.min(100, Math.round((processedCount / totalCount) * 100)) : 0
    try {
      if (!progressJobId) {
        const created = await progressService.createJob({
          jobType: 'query_index.reindex',
          name: `Query index reindex: ${entityType}`,
          description: progressPartitionCount && progressPartitionCount > 1
            ? `Partition ${((progressPartitionIndex ?? 0) + 1).toString()} of ${progressPartitionCount.toString()}`
            : undefined,
          totalCount: totalCount > 0 ? totalCount : undefined,
          cancellable: false,
          meta: {
            entityType,
            partitionIndex: progressPartitionIndex,
            partitionCount: progressPartitionCount,
          },
          partitionIndex: progressPartitionIndex ?? undefined,
          partitionCount: progressPartitionCount ?? undefined,
        }, progressCtx)
        progressJobId = created.id
        await progressService.startJob(progressJobId, progressCtx)
      }

      await progressService.updateProgress(
        progressJobId,
        {
          processedCount,
          totalCount: totalCount > 0 ? totalCount : undefined,
          progressPercent,
        },
        progressCtx,
      )

      if (options?.complete) {
        await progressService.completeJob(
          progressJobId,
          {
            resultSummary: {
              entityType,
              processed: processedCount,
              total: totalCount,
            },
          },
          progressCtx,
        )
      } else if (options?.failed) {
        await progressService.failJob(
          progressJobId,
          {
            errorMessage: options.errorMessage ?? `Reindex failed for ${entityType}`,
          },
          progressCtx,
        )
      }
    } catch {
      // Never block query_index subscriber execution because of progress tracking.
    }
  }

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
      onProgress: (info) => {
        void updateProgress(info)
      },
    })
    await updateProgress(
      { processed: result.processed, total: result.total },
      { complete: true },
    )
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
    await updateProgress(
      { processed: 0, total: 0 },
      { failed: true, errorMessage: error instanceof Error ? error.message : String(error) },
    )
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
