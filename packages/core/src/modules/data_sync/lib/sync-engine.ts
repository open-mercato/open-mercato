import type { EntityManager } from '@mikro-orm/postgresql'
import type { CredentialsService } from '../../integrations/lib/credentials-service'
import type { IntegrationLogService } from '../../integrations/lib/log-service'
import type { IntegrationStateService } from '../../integrations/lib/state-service'
import type { ProgressService } from '../../progress/lib/progressService'
import { STALE_JOB_TIMEOUT_SECONDS } from '../../progress/lib/progressService'
import { refreshCoverageSnapshot } from '../../query_index/lib/coverage'
import { emitDataSyncEvent } from '../events'
import type { DataSyncAdapter, DataMapping, ExportBatch, ImportBatch, RunParameterValue } from './adapter'
import { getDataSyncAdapter, resolveProviderKey } from './adapter-registry'
import type { SyncRunService } from './sync-run-service'
import { SyncRunOwnershipConflictError } from './sync-run-service'
import { forEachBatch } from './batch-stream'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  captureTelemetryTrace,
  type TelemetrySpanAttributes,
} from '@open-mercato/shared/lib/telemetry/runtime'
import type { SyncRun } from '../data/entities'

const logger = createLogger('data_sync').child({ component: 'sync-engine' })

type RunParameters = Record<string, RunParameterValue>

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
  integrationStateService?: IntegrationStateService
  progressService: ProgressService
}

/** Repeated on every batch span so a rooted batch trace identifies its run on its own. */
function runSpanAttributes(run: SyncRun, providerKey: string, scope: SyncScope): TelemetrySpanAttributes {
  return {
    'data_sync.run_id': run.id,
    'data_sync.integration_id': run.integrationId,
    'data_sync.provider_key': providerKey,
    'data_sync.entity_type': run.entityType,
    'data_sync.direction': run.direction,
    'om.tenant_id': scope.tenantId,
    'om.organization_id': scope.organizationId,
  }
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

// Adapter batches can legitimately outlast the stale-job sweep window (slow upstream
// APIs), so the engine must heartbeat while a batch is still being produced. The same
// tick also polls cancellation, so a cancel lands within one interval instead of waiting
// out the batch — sharing this timer rather than adding a second one that would double
// the per-interval round-trips for the whole life of a run.
const HEARTBEAT_TICK_MS = (STALE_JOB_TIMEOUT_SECONDS * 1000) / 4

// Runs `tick` on an interval only while the source iterator is pending, so heartbeats
// stop the moment the producer dies and genuinely stale jobs still get swept. The outer
// finally closes the adapter generator on early exits (cancellation, ownership conflict).
// Our own abort, as opposed to a failure that merely coincided with one. Adapters are told to
// return rather than throw, but `signal.throwIfAborted()` and an aborted `fetch` both surface as
// this, and either is a cancellation rather than a fault.
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

async function* withHeartbeat<T>(source: AsyncIterable<T>, tick: () => void, intervalMs: number): AsyncGenerator<T, void, undefined> {
  const iterator = source[Symbol.asyncIterator]()
  try {
    while (true) {
      const timer = setInterval(tick, intervalMs)
      let result: IteratorResult<T>
      try {
        result = await iterator.next()
      } finally {
        clearInterval(timer)
      }
      if (result.done) return
      yield result.value
    }
  } finally {
    await iterator.return?.()
  }
}

export function createSyncEngine(deps: EngineDeps) {
  const { syncRunService, integrationCredentialsService, integrationLogService, integrationStateService, progressService } = deps

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

  // On redelivery the progress counter must resume where the last delivery left off the
  // same way committedBatches does — updateProgress writes absolute counts, so starting at
  // zero would regress the visible count. The progress job's own processedCount is the only
  // persisted value already in the engine's unit: `batch.processedCount ?? items.length`,
  // i.e. source records. The run's created/updated/skipped/failed counters count emitted
  // items, which adapters may explode several-per-source-record (Akeneo yields a product
  // plus its variants), so seeding from them would overshoot the total and pin the bar.
  async function seedProcessedCount(progressJobId: string | null | undefined, scope: SyncScope): Promise<number> {
    if (!progressJobId) return 0
    const job = await progressService.getJob(progressJobId, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: scope.userId,
    })
    return job?.processedCount ?? 0
  }

  function makeHeartbeatTick(progressJobId: string | null | undefined, scope: SyncScope): () => void {
    const touchJobHeartbeat = progressService.touchJobHeartbeat?.bind(progressService)
    if (!progressJobId || !touchJobHeartbeat) return () => {}
    let inFlight = false
    return () => {
      if (inFlight) return
      inFlight = true
      touchJobHeartbeat(progressJobId, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId: scope.userId,
      })
        .catch((error) => {
          logger.warn('Progress heartbeat failed', {
            progressJobId,
            error: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(() => {
          inFlight = false
        })
    }
  }

  // Rides the heartbeat timer, which is the only thing that runs while the adapter is still
  // producing a batch — the engine's own cancellation check sits in the batch handler and is
  // reached only after a yield. Swallows its own errors because it runs on a timer, where an
  // unhandled rejection is fatal, and stops polling once it has aborted.
  function makeCancellationTick(progressJobId: string | null | undefined, scope: SyncScope, controller: AbortController): () => void {
    if (!progressJobId) return () => {}
    let inFlight = false
    return () => {
      if (inFlight || controller.signal.aborted) return
      inFlight = true
      progressService.isCancellationRequested(progressJobId, scope.tenantId, scope.organizationId)
        .then((cancelled) => {
          if (cancelled) controller.abort()
        })
        .catch((error) => {
          logger.warn('Cancellation poll failed', {
            progressJobId,
            error: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(() => {
          inFlight = false
        })
    }
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
        `Failed to import item ${item.externalId}`,
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

  async function logExportItemFailures(
    runId: string,
    integrationId: string,
    results: ExportBatch['results'],
    scope: SyncScope,
  ): Promise<void> {
    const failedResults = results.filter((result) => result.status === 'error' && result.error)
    for (const result of failedResults) {
      const label = result.externalId ? `${result.externalId} (id: ${result.localId})` : result.localId
      const errorMessage = result.error!.split('\n')[0]
      const message = `Failed to export item ${label}: ${errorMessage}`

      await integrationLogService.write(
        {
          integrationId,
          runId,
          level: 'error',
          message,
          payload: { kind: 'export-item-failure', summary: result.error },
        },
        scope,
      )
    }
  }

  async function writeOperationalLog(params: {
    integrationId: string
    runId: string
    level: 'info' | 'warn' | 'error'
    message: string
    scope: SyncScope
    enabled: boolean
    payload?: Record<string, unknown>
  }): Promise<void> {
    if (!params.enabled) return

    await integrationLogService.write(
      {
        integrationId: params.integrationId,
        runId: params.runId,
        level: params.level,
        message: params.message,
        payload: params.payload,
      },
      params.scope,
    )
  }

  async function updateOperationalState(params: {
    integrationId: string
    status: 'healthy' | 'degraded' | 'unhealthy'
    scope: SyncScope
    enabled: boolean
  }): Promise<void> {
    if (!params.enabled || !integrationStateService) return

    await integrationStateService.upsert(
      params.integrationId,
      {
        lastHealthStatus: params.status,
        lastHealthCheckedAt: new Date(),
      },
      params.scope,
    )
  }

  async function finalizeRun(
    runId: string,
    status: 'completed' | 'failed' | 'cancelled',
    scope: SyncScope,
    error?: string,
    operationalTelemetry = false,
  ): Promise<void> {
    const existingRun = await syncRunService.getRun(runId, scope)
    const alreadyFinalizedWithSameStatus = existingRun?.status === status
      && (status === 'completed' || status === 'failed' || status === 'cancelled')

    const run = await syncRunService.markStatus(runId, status, scope, error)
    if (!run) return

    if (alreadyFinalizedWithSameStatus) {
      return
    }

    if (run.status !== status) {
      // `markStatus` refuses a terminal -> different-terminal transition and
      // returns the row unchanged, so the run is already finished under another
      // delivery of this job. Everything below — the progress job, the
      // operational log and the lifecycle event — would describe the wrong
      // outcome, and `data_sync.run.failed` is dispatched to tenant webhooks.
      // A displaced worker stays silent instead.
      logger.warn('Skipping finalization of a sync run another worker already finalized', {
        runId,
        requestedStatus: status,
        actualStatus: run.status,
      })
      return
    }

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
      await updateOperationalState({
        integrationId: run.integrationId,
        status: 'healthy',
        scope,
        enabled: operationalTelemetry,
      })
      await writeOperationalLog({
        integrationId: run.integrationId,
        runId: run.id,
        level: 'info',
        message: 'Sync run completed',
        scope,
        enabled: operationalTelemetry,
        payload: {
          operationalStatus: 'completed',
          summary: `Sync completed with ${run.createdCount} created, ${run.updatedCount} updated, ${run.failedCount} failed.`,
          createdCount: run.createdCount,
          updatedCount: run.updatedCount,
          skippedCount: run.skippedCount,
          failedCount: run.failedCount,
          batchesCompleted: run.batchesCompleted,
        },
      })
    } else if (status === 'cancelled') {
      await updateOperationalState({
        integrationId: run.integrationId,
        status: 'degraded',
        scope,
        enabled: operationalTelemetry,
      })
      await writeOperationalLog({
        integrationId: run.integrationId,
        runId: run.id,
        level: 'warn',
        message: 'Sync run cancelled',
        scope,
        enabled: operationalTelemetry,
        payload: {
          operationalStatus: 'cancelled',
          summary: 'The sync run was cancelled before completion.',
        },
      })
    } else {
      await updateOperationalState({
        integrationId: run.integrationId,
        status: 'unhealthy',
        scope,
        enabled: operationalTelemetry,
      })
      await writeOperationalLog({
        integrationId: run.integrationId,
        runId: run.id,
        level: 'error',
        message: error ?? 'Sync run failed',
        scope,
        enabled: operationalTelemetry,
        payload: {
          operationalStatus: 'failed',
          summary: error ?? 'The sync run failed.',
        },
      })
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
        logger.warn('Skipping stale import job for missing run', { runId })
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
      const operationalTelemetry = adapter.operationalTelemetry === true
      const persistSharedCursor = adapter.persistsSharedCursor?.(run.entityType) ?? true

      const credentials = await integrationCredentialsService.resolve(run.integrationId, scope)
      if (!credentials) {
        throw new Error(`Integration ${run.integrationId} is missing credentials`)
      }

      // A run already `running` means a stalled job was redelivered, so this is
      // a resume rather than a first start. Consumers see one `started` event per
      // delivery either way; the flag is what lets them tell the two apart.
      const resumed = run.status === 'running'
      const activeRun = await syncRunService.markStatus(run.id, 'running', scope)
      if (!activeRun || activeRun.status !== 'running') {
        return
      }
      await emitDataSyncEvent('data_sync.run.started', {
        runId: run.id,
        integrationId: run.integrationId,
        entityType: run.entityType,
        direction: run.direction,
        resumed,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      await updateOperationalState({
        integrationId: run.integrationId,
        status: 'degraded',
        scope,
        enabled: operationalTelemetry,
      })
      await writeOperationalLog({
        integrationId: run.integrationId,
        runId: run.id,
        level: 'info',
        message: 'Sync run started',
        scope,
        enabled: operationalTelemetry,
        payload: {
          operationalStatus: 'running',
          summary: `Import run started for ${run.entityType}.`,
          entityType: run.entityType,
          direction: run.direction,
        },
      })

      if (run.progressJobId) {
        await progressService.startJob(run.progressJobId, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          userId: scope.userId,
        })
      }

      const mapping = await resolveMapping(adapter, run.entityType, scope)
      let processedCount = await seedProcessedCount(run.progressJobId, scope)
      let totalCount: number | null = null
      let committedBatches = activeRun.batchesCompleted ?? 0
      // Whether the last committed batch said the source was exhausted. Distinguishes a stream that
      // drained from one the adapter stopped early — see the post-stream finalize below.
      let streamReportedDone = false
      // Captured while the triggering job's span is still the active one, so
      // every rooted batch trace can link back to it.
      const runTrace = captureTelemetryTrace()
      const spanAttributes = runSpanAttributes(run, providerKey, scope)
      // Declared outside the try because both the catch and the completion path below read it.
      const cancellation = new AbortController()
      const heartbeat = makeHeartbeatTick(run.progressJobId, scope)
      const pollCancellation = makeCancellationTick(run.progressJobId, scope, cancellation)

      try {
        const streamResult = await forEachBatch(
          withHeartbeat(
            adapter.streamImport({
              entityType: run.entityType,
              cursor: run.cursor ?? undefined,
              batchSize,
              credentials,
              mapping,
              scope: { organizationId: scope.organizationId, tenantId: scope.tenantId },
              runId: run.id,
              parameters: (run.parameters ?? {}) as RunParameters,
              signal: cancellation.signal,
            }),
            // `finally` so a synchronous throw from the heartbeat cannot also stop cancellation
            // from being observed for the rest of the run.
            () => { try { heartbeat() } finally { pollCancellation() } },
            HEARTBEAT_TICK_MS,
          ),
          {
            spanName: 'data_sync.import.batch',
            drainSpanName: 'data_sync.import.drain',
            attributes: spanAttributes,
            linkTo: runTrace,
          },
          async (batch, span) => {
            span.setAttributes({
              'data_sync.batch_index': batch.batchIndex,
              'data_sync.batch_size': batch.items.length,
            })

            if (cancellation.signal.aborted || (run.progressJobId && await progressService.isCancellationRequested(run.progressJobId, scope.tenantId, scope.organizationId))) {
              await finalizeRun(run.id, 'cancelled', scope, undefined, operationalTelemetry)
              return 'stop'
            }

            const delta = applyImportCounters(batch)
            const processedBatchCount = batch.processedCount ?? batch.items.length
            processedCount += processedBatchCount
            totalCount = batch.totalEstimate ?? totalCount

            span.setAttributes({
              'data_sync.processed_count': processedBatchCount,
              'data_sync.created_count': delta.createdCount,
              'data_sync.updated_count': delta.updatedCount,
              'data_sync.skipped_count': delta.skippedCount,
              'data_sync.failed_count': delta.failedCount,
            })

            await syncRunService.commitBatchProgress(
              run.id,
              {
                ...delta,
                batchesCompleted: 1,
              },
              batch.cursor,
              scope,
              { expectedBatchesCompleted: committedBatches, persistSharedCursor },
            )
            committedBatches += 1
            streamReportedDone = batch.hasMore === false

            await updateProgress(run.progressJobId, processedCount, totalCount, scope)
            await refreshCoverageSnapshots(batch.refreshCoverageEntityTypes, scope)
            await logImportItemFailures(run.id, run.integrationId, batch.items, scope)

            await writeOperationalLog({
              integrationId: run.integrationId,
              runId: run.id,
              level: 'info',
              message: batch.message?.trim().length
                ? batch.message.trim()
                : `Processed import batch ${batch.batchIndex}`,
              scope,
              enabled: operationalTelemetry,
              payload: {
                operationalStatus: 'running',
                summary: `Processed ${processedCount}${totalCount ? ` of ${totalCount}` : ''} rows so far.`,
                processedCount,
                batchSize: batch.items.length,
                processedBatchCount,
                cursor: batch.cursor,
              },
            })

            return 'continue'
          },
        )
        if (streamResult === 'stopped') return
      } catch (error) {
        if (error instanceof SyncRunOwnershipConflictError) {
          logger.warn('Yielding import run to a concurrent worker that already advanced it', {
            runId: run.id,
            expectedBatchesCompleted: error.expectedBatchesCompleted,
          })
          return
        }
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
        // An adapter that honours the signal may reject instead of returning, so our own abort is
        // a cancellation rather than a fault. Anything else that merely coincided with the cancel —
        // a rejecting commit, an upstream 500 — is a genuine failure and keeps its message, its
        // `failed` status and its failed lifecycle event.
        if (cancellation.signal.aborted && isAbortError(error)) {
          await finalizeRun(run.id, 'cancelled', scope, undefined, operationalTelemetry)
          return
        }
        await finalizeRun(run.id, 'failed', scope, message, operationalTelemetry)
        return
      }

      // An adapter that honours the signal stops mid-batch and returns WITHOUT yielding, so the
      // batch handler — which owns the only other `cancelled` transition — never runs and the
      // stream reports `completed`.
      //
      // `streamReportedDone` keeps that from swallowing a run that genuinely finished: an adapter
      // that ignores the signal and drains after reporting `hasMore: false` delivered everything it
      // had, even when the cancel landed during the final read. Calling that cancelled would tell
      // the operator a complete sync was partial and leave a finished run resumable.
      if (cancellation.signal.aborted && !streamReportedDone) {
        await finalizeRun(run.id, 'cancelled', scope, undefined, operationalTelemetry)
        return
      }

      await finalizeRun(run.id, 'completed', scope, undefined, operationalTelemetry)
    },

    async runExport(runId: string, batchSize: number, scope: SyncScope): Promise<void> {
      const run = await syncRunService.getRun(runId, scope)
      if (!run) {
        logger.warn('Skipping stale export job for missing run', { runId })
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
      const operationalTelemetry = adapter.operationalTelemetry === true
      const persistSharedCursor = adapter.persistsSharedCursor?.(run.entityType) ?? true

      const credentials = await integrationCredentialsService.resolve(run.integrationId, scope)
      if (!credentials) {
        throw new Error(`Integration ${run.integrationId} is missing credentials`)
      }

      // A run already `running` means a stalled job was redelivered, so this is
      // a resume rather than a first start. Consumers see one `started` event per
      // delivery either way; the flag is what lets them tell the two apart.
      const resumed = run.status === 'running'
      const activeRun = await syncRunService.markStatus(run.id, 'running', scope)
      if (!activeRun || activeRun.status !== 'running') {
        return
      }
      await emitDataSyncEvent('data_sync.run.started', {
        runId: run.id,
        integrationId: run.integrationId,
        entityType: run.entityType,
        direction: run.direction,
        resumed,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      await updateOperationalState({
        integrationId: run.integrationId,
        status: 'degraded',
        scope,
        enabled: operationalTelemetry,
      })
      await writeOperationalLog({
        integrationId: run.integrationId,
        runId: run.id,
        level: 'info',
        message: 'Sync run started',
        scope,
        enabled: operationalTelemetry,
        payload: {
          operationalStatus: 'running',
          summary: `Export run started for ${run.entityType}.`,
          entityType: run.entityType,
          direction: run.direction,
        },
      })

      if (run.progressJobId) {
        await progressService.startJob(run.progressJobId, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          userId: scope.userId,
        })
      }

      const mapping = await resolveMapping(adapter, run.entityType, scope)
      let processedCount = await seedProcessedCount(run.progressJobId, scope)
      let committedBatches = activeRun.batchesCompleted ?? 0
      // Whether the last committed batch said the source was exhausted. Distinguishes a stream that
      // drained from one the adapter stopped early — see the post-stream finalize below.
      let streamReportedDone = false
      // Captured while the triggering job's span is still the active one, so
      // every rooted batch trace can link back to it.
      const runTrace = captureTelemetryTrace()
      const spanAttributes = runSpanAttributes(run, providerKey, scope)
      // Declared outside the try because both the catch and the completion path below read it.
      const cancellation = new AbortController()
      const heartbeat = makeHeartbeatTick(run.progressJobId, scope)
      const pollCancellation = makeCancellationTick(run.progressJobId, scope, cancellation)

      try {
        const streamResult = await forEachBatch(
          withHeartbeat(
            adapter.streamExport({
              entityType: run.entityType,
              cursor: run.cursor ?? undefined,
              batchSize,
              credentials,
              mapping,
              scope: { organizationId: scope.organizationId, tenantId: scope.tenantId },
              runId: run.id,
              parameters: (run.parameters ?? {}) as RunParameters,
              signal: cancellation.signal,
            }),
            // `finally` so a synchronous throw from the heartbeat cannot also stop cancellation
            // from being observed for the rest of the run.
            () => { try { heartbeat() } finally { pollCancellation() } },
            HEARTBEAT_TICK_MS,
          ),
          {
            spanName: 'data_sync.export.batch',
            drainSpanName: 'data_sync.export.drain',
            attributes: spanAttributes,
            linkTo: runTrace,
          },
          async (batch, span) => {
            span.setAttributes({
              'data_sync.batch_index': batch.batchIndex,
              'data_sync.batch_size': batch.results.length,
            })

            if (cancellation.signal.aborted || (run.progressJobId && await progressService.isCancellationRequested(run.progressJobId, scope.tenantId, scope.organizationId))) {
              await finalizeRun(run.id, 'cancelled', scope, undefined, operationalTelemetry)
              return 'stop'
            }

            const delta = applyExportCounters(batch)
            processedCount += delta.processedCount

            span.setAttributes({
              'data_sync.processed_count': delta.processedCount,
              'data_sync.updated_count': delta.updatedCount,
              'data_sync.skipped_count': delta.skippedCount,
              'data_sync.failed_count': delta.failedCount,
            })

            await syncRunService.commitBatchProgress(
              run.id,
              {
                createdCount: 0,
                updatedCount: delta.updatedCount,
                skippedCount: delta.skippedCount,
                failedCount: delta.failedCount,
                batchesCompleted: 1,
              },
              batch.cursor,
              scope,
              { expectedBatchesCompleted: committedBatches, persistSharedCursor },
            )
            committedBatches += 1
            streamReportedDone = batch.hasMore === false
            await updateProgress(run.progressJobId, processedCount, null, scope)
            await logExportItemFailures(run.id, run.integrationId, batch.results, scope)

            await writeOperationalLog({
              integrationId: run.integrationId,
              runId: run.id,
              level: 'info',
              message: `Processed export batch ${batch.batchIndex}`,
              scope,
              enabled: operationalTelemetry,
              payload: {
                operationalStatus: 'running',
                summary: `Processed ${processedCount} export items so far.`,
                processedCount,
                batchSize: batch.results.length,
                cursor: batch.cursor,
              },
            })

            return 'continue'
          },
        )
        if (streamResult === 'stopped') return
      } catch (error) {
        if (error instanceof SyncRunOwnershipConflictError) {
          logger.warn('Yielding export run to a concurrent worker that already advanced it', {
            runId: run.id,
            expectedBatchesCompleted: error.expectedBatchesCompleted,
          })
          return
        }
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
        // An adapter that honours the signal may reject instead of returning, so our own abort is
        // a cancellation rather than a fault. Anything else that merely coincided with the cancel —
        // a rejecting commit, an upstream 500 — is a genuine failure and keeps its message, its
        // `failed` status and its failed lifecycle event.
        if (cancellation.signal.aborted && isAbortError(error)) {
          await finalizeRun(run.id, 'cancelled', scope, undefined, operationalTelemetry)
          return
        }
        await finalizeRun(run.id, 'failed', scope, message, operationalTelemetry)
        return
      }

      // An adapter that honours the signal stops mid-batch and returns WITHOUT yielding, so the
      // batch handler — which owns the only other `cancelled` transition — never runs and the
      // stream reports `completed`.
      //
      // `streamReportedDone` keeps that from swallowing a run that genuinely finished: an adapter
      // that ignores the signal and drains after reporting `hasMore: false` delivered everything it
      // had, even when the cancel landed during the final read. Calling that cancelled would tell
      // the operator a complete sync was partial and leave a finished run resumable.
      if (cancellation.signal.aborted && !streamReportedDone) {
        await finalizeRun(run.id, 'cancelled', scope, undefined, operationalTelemetry)
        return
      }

      await finalizeRun(run.id, 'completed', scope, undefined, operationalTelemetry)
    },
  }
}

export type SyncEngine = ReturnType<typeof createSyncEngine>
