import type { EntityManager } from '@mikro-orm/postgresql'
import { getIntegration } from '@open-mercato/shared/modules/integrations/types'
import type { CredentialsService } from '../../integrations/lib/credentials-service'
import type { IntegrationLogService } from '../../integrations/lib/log-service'
import type { ProgressService } from '../../progress/lib/progressService'
import { refreshCoverageSnapshot } from '../../query_index/lib/coverage'
import { emitDataSyncEvent } from '../events'
import type { DataSyncAdapter, DataMapping, ExportBatch, ImportBatch } from './adapter'
import { getDataSyncAdapter } from './adapter-registry'
import type { SyncRunService } from './sync-run-service'

type SyncScope = {
  organizationId: string
  tenantId: string
  userId?: string | null
}

type EngineDeps = {
  em: EntityManager
  syncRunService: SyncRunService
  integrationCredentialsService: CredentialsService
  integrationLogService: IntegrationLogService
  progressService: ProgressService
}

function resolveProviderKey(integrationId: string): string {
  return getIntegration(integrationId)?.providerKey ?? integrationId
}

function applyImportCounters(batch: ImportBatch): Pick<Required<SyncCounterDelta>, 'createdCount' | 'updatedCount' | 'skippedCount' | 'failedCount'> {
  let createdCount = 0
  let updatedCount = 0
  let skippedCount = 0
  let failedCount = 0

  for (const item of batch.items) {
    if (item.action === 'create') createdCount += 1
    else if (item.action === 'update') updatedCount += 1
    else if (item.action === 'failed') failedCount += 1
    else skippedCount += 1
  }

  return { createdCount, updatedCount, skippedCount, failedCount }
}

type SyncCounterDelta = {
  createdCount?: number
  updatedCount?: number
  skippedCount?: number
  failedCount?: number
  processedCount: number
}

function applyExportCounters(batch: ExportBatch): SyncCounterDelta {
  let failedCount = 0
  let skippedCount = 0
  let updatedCount = 0

  for (const result of batch.results) {
    if (result.status === 'error') failedCount += 1
    else if (result.status === 'skipped') skippedCount += 1
    else updatedCount += 1
  }

  return {
    failedCount,
    skippedCount,
    updatedCount,
    processedCount: batch.results.length,
  }
}

export function createSyncEngine(deps: EngineDeps) {
  const { syncRunService, integrationCredentialsService, integrationLogService, progressService } = deps

  async function resolveMapping(adapter: DataSyncAdapter, entityType: string, scope: SyncScope): Promise<DataMapping> {
    return adapter.getMapping({
      entityType,
      scope: { organizationId: scope.organizationId, tenantId: scope.tenantId },
    })
  }

  async function updateProgress(progressJobId: string | null | undefined, processedCount: number, totalCount: number | null, scope: SyncScope): Promise<void> {
    if (!progressJobId) return

    await progressService.updateProgress(
      progressJobId,
      {
        processedCount,
        totalCount: totalCount ?? undefined,
      },
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId: scope.userId,
      },
    )
  }

  async function refreshCoverageSnapshots(entityTypes: string[] | undefined, scope: SyncScope): Promise<void> {
    if (!entityTypes || entityTypes.length === 0) return

    await Promise.allSettled(
      Array.from(new Set(entityTypes.filter((value) => typeof value === 'string' && value.trim().length > 0)))
        .map((entityType) => refreshCoverageSnapshot(deps.em, {
          entityType,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })),
    )
  }

  async function logImportItemFailures(
    runId: string,
    integrationId: string,
    items: ImportBatch['items'],
    scope: SyncScope,
  ): Promise<void> {
    const failedItems = items.filter((item) => item.action === 'failed')
    for (const item of failedItems) {
      const errorMessage = typeof item.data.errorMessage === 'string' && item.data.errorMessage.trim().length > 0
        ? item.data.errorMessage.trim()
        : 'Import item failed'
      const sourceProductUuid = typeof item.data.sourceProductUuid === 'string' && item.data.sourceProductUuid.trim().length > 0
        ? item.data.sourceProductUuid.trim()
        : null
      const sourceIdentifier = typeof item.data.sourceIdentifier === 'string' && item.data.sourceIdentifier.trim().length > 0
        ? item.data.sourceIdentifier.trim()
        : null
      const message = [
        `Failed to import Akeneo product ${item.externalId}`,
        sourceProductUuid ? `(uuid: ${sourceProductUuid})` : null,
        sourceIdentifier ? `(identifier: ${sourceIdentifier})` : null,
        `: ${errorMessage}`,
      ].filter((part) => part !== null).join(' ')

      await integrationLogService.write(
        {
          integrationId,
          runId,
          level: 'error',
          message,
          payload: item.data,
        },
        scope,
      )
    }
  }

  async function finalizeRun(runId: string, status: 'completed' | 'failed' | 'cancelled', scope: SyncScope, error?: string): Promise<void> {
    const run = await syncRunService.markStatus(runId, status, scope, error)
    if (!run) return

    if (run.progressJobId) {
      if (status === 'completed') {
        await progressService.completeJob(
          run.progressJobId,
          {
            resultSummary: {
              createdCount: run.createdCount,
              updatedCount: run.updatedCount,
              skippedCount: run.skippedCount,
              failedCount: run.failedCount,
              batchesCompleted: run.batchesCompleted,
            },
          },
          {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            userId: scope.userId,
          },
        )
      } else if (status === 'failed') {
        await progressService.failJob(
          run.progressJobId,
          {
            errorMessage: error ?? 'Sync run failed',
          },
          {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            userId: scope.userId,
          },
        )
      } else if (status === 'cancelled') {
        await progressService.markCancelled(
          run.progressJobId,
          {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            userId: scope.userId,
          },
        )
      }
    }

    if (status === 'completed') {
      await emitDataSyncEvent('data_sync.run.completed', {
        runId,
        integrationId: run.integrationId,
        entityType: run.entityType,
        direction: run.direction,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      return
    }

    if (status === 'cancelled') {
      await emitDataSyncEvent('data_sync.run.cancelled', {
        runId,
        integrationId: run.integrationId,
        entityType: run.entityType,
        direction: run.direction,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      return
    }

    await emitDataSyncEvent('data_sync.run.failed', {
      runId,
      integrationId: run.integrationId,
      entityType: run.entityType,
      direction: run.direction,
      error: error ?? null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  }

  return {
    async runImport(runId: string, batchSize: number, scope: SyncScope): Promise<void> {
      const run = await syncRunService.getRun(runId, scope)
      if (!run) {
        console.warn(`[data-sync] Skipping stale import job for missing run ${runId}`)
        return
      }
      if (run.status === 'cancelled') {
        if (run.progressJobId) {
          await progressService.markCancelled(run.progressJobId, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            userId: scope.userId,
          })
        }
        return
      }

      const providerKey = resolveProviderKey(run.integrationId)
      const adapter = getDataSyncAdapter(providerKey)
      if (!adapter?.streamImport) {
        throw new Error(`No import adapter registered for provider ${providerKey}`)
      }

      const credentials = await integrationCredentialsService.resolve(run.integrationId, scope)
      if (!credentials) {
        throw new Error(`Integration ${run.integrationId} is missing credentials`)
      }

      const activeRun = await syncRunService.markStatus(run.id, 'running', scope)
      if (!activeRun || activeRun.status !== 'running') {
        if (run.progressJobId) {
          await progressService.markCancelled(run.progressJobId, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            userId: scope.userId,
          })
        }
        return
      }
      await emitDataSyncEvent('data_sync.run.started', {
        runId: run.id,
        integrationId: run.integrationId,
        entityType: run.entityType,
        direction: run.direction,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })

      if (run.progressJobId) {
        await progressService.startJob(run.progressJobId, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          userId: scope.userId,
        })
      }

      const mapping = await resolveMapping(adapter, run.entityType, scope)
      let processedCount = 0
      let totalCount: number | null = null

      try {
        for await (const batch of adapter.streamImport({
          entityType: run.entityType,
          cursor: run.cursor ?? undefined,
          batchSize,
          credentials,
          mapping,
          scope: { organizationId: scope.organizationId, tenantId: scope.tenantId },
        })) {
          if (run.progressJobId && await progressService.isCancellationRequested(run.progressJobId)) {
            await finalizeRun(run.id, 'cancelled', scope)
            return
          }

          const delta = applyImportCounters(batch)
          const processedBatchCount = batch.processedCount ?? batch.items.length
          processedCount += processedBatchCount
          totalCount = batch.totalEstimate ?? totalCount

          await syncRunService.updateCounts(
            run.id,
            {
              ...delta,
              batchesCompleted: 1,
            },
            scope,
          )
          await syncRunService.updateCursor(run.id, batch.cursor, scope)

          await updateProgress(run.progressJobId, processedCount, totalCount, scope)
          await refreshCoverageSnapshots(batch.refreshCoverageEntityTypes, scope)
          await logImportItemFailures(run.id, run.integrationId, batch.items, scope)

          await integrationLogService.write(
            {
              integrationId: run.integrationId,
              runId: run.id,
              level: 'info',
              message: batch.message?.trim().length
                ? batch.message.trim()
                : `Processed import batch ${batch.batchIndex}`,
              payload: {
                processedCount,
                batchSize: batch.items.length,
                processedBatchCount,
                cursor: batch.cursor,
              },
            },
            scope,
          )
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Sync import failed'
        await integrationLogService.write(
          {
            integrationId: run.integrationId,
            runId: run.id,
            level: 'error',
            message,
          },
          scope,
        )
        await finalizeRun(run.id, 'failed', scope, message)
        return
      }

      await finalizeRun(run.id, 'completed', scope)
    },

    async runExport(runId: string, batchSize: number, scope: SyncScope): Promise<void> {
      const run = await syncRunService.getRun(runId, scope)
      if (!run) {
        console.warn(`[data-sync] Skipping stale export job for missing run ${runId}`)
        return
      }
      if (run.status === 'cancelled') {
        if (run.progressJobId) {
          await progressService.markCancelled(run.progressJobId, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            userId: scope.userId,
          })
        }
        return
      }

      const providerKey = resolveProviderKey(run.integrationId)
      const adapter = getDataSyncAdapter(providerKey)
      if (!adapter?.streamExport) {
        throw new Error(`No export adapter registered for provider ${providerKey}`)
      }

      const credentials = await integrationCredentialsService.resolve(run.integrationId, scope)
      if (!credentials) {
        throw new Error(`Integration ${run.integrationId} is missing credentials`)
      }

      const activeRun = await syncRunService.markStatus(run.id, 'running', scope)
      if (!activeRun || activeRun.status !== 'running') {
        if (run.progressJobId) {
          await progressService.markCancelled(run.progressJobId, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            userId: scope.userId,
          })
        }
        return
      }
      await emitDataSyncEvent('data_sync.run.started', {
        runId: run.id,
        integrationId: run.integrationId,
        entityType: run.entityType,
        direction: run.direction,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })

      if (run.progressJobId) {
        await progressService.startJob(run.progressJobId, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          userId: scope.userId,
        })
      }

      const mapping = await resolveMapping(adapter, run.entityType, scope)
      let processedCount = 0

      try {
        for await (const batch of adapter.streamExport({
          entityType: run.entityType,
          cursor: run.cursor ?? undefined,
          batchSize,
          credentials,
          mapping,
          scope: { organizationId: scope.organizationId, tenantId: scope.tenantId },
        })) {
          if (run.progressJobId && await progressService.isCancellationRequested(run.progressJobId)) {
            await finalizeRun(run.id, 'cancelled', scope)
            return
          }

          const delta = applyExportCounters(batch)
          processedCount += delta.processedCount

          await syncRunService.updateCounts(
            run.id,
            {
              createdCount: 0,
              updatedCount: delta.updatedCount,
              skippedCount: delta.skippedCount,
              failedCount: delta.failedCount,
              batchesCompleted: 1,
            },
            scope,
          )

          await syncRunService.updateCursor(run.id, batch.cursor, scope)
          await updateProgress(run.progressJobId, processedCount, null, scope)

          await integrationLogService.write(
            {
              integrationId: run.integrationId,
              runId: run.id,
              level: 'info',
              message: `Processed export batch ${batch.batchIndex}`,
              payload: {
                processedCount,
                batchSize: batch.results.length,
                cursor: batch.cursor,
              },
            },
            scope,
          )
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Sync export failed'
        await integrationLogService.write(
          {
            integrationId: run.integrationId,
            runId: run.id,
            level: 'error',
            message,
          },
          scope,
        )
        await finalizeRun(run.id, 'failed', scope, message)
        return
      }

      await finalizeRun(run.id, 'completed', scope)
    },
  }
}

export type SyncEngine = ReturnType<typeof createSyncEngine>
