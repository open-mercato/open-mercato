import { setTimeout as sleep } from 'node:timers/promises'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ProgressJob } from '@open-mercato/core/modules/progress/data/entities'
import type { ProgressService, ProgressServiceContext } from '@open-mercato/core/modules/progress/lib/progressService'
import type { SyncRunService } from '@open-mercato/core/modules/data_sync/lib/sync-run-service'
import { startDataSyncRun } from '@open-mercato/core/modules/data_sync/lib/start-run'

export const AKENEO_FIRST_IMPORT_QUEUE = 'sync-akeneo-first-import'

const FIRST_IMPORT_STEPS = ['categories', 'attributes', 'products'] as const

type FirstImportStep = (typeof FIRST_IMPORT_STEPS)[number]

export type AkeneoFirstImportScope = {
  organizationId: string
  tenantId: string
  userId?: string | null
}

export type AkeneoFirstImportJobPayload = {
  progressJobId: string
  scope: AkeneoFirstImportScope
}

export type FirstImportSequenceStatus = {
  progressJobId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  currentStep: FirstImportStep | null
  currentRunId: string | null
  currentRunProgressJobId: string | null
  currentRunStatus: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | null
  progressPercent: number | null
  processedCount: number | null
  totalCount: number | null
  errorMessage: string | null
}

function buildProgressContext(scope: AkeneoFirstImportScope): ProgressServiceContext {
  return {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    userId: scope.userId,
  }
}

function buildSequenceMeta(input?: Partial<{
  currentStep: FirstImportStep | null
  currentRunId: string | null
  currentRunProgressJobId: string | null
  currentRunStatus: string | null
  currentRunProgressPercent: number | null
  currentRunProcessedCount: number | null
  currentRunTotalCount: number | null
}>): Record<string, unknown> {
  return {
    integrationId: 'sync_akeneo',
    workflow: 'first_import',
    hiddenFromTopBar: true,
    currentStep: input?.currentStep ?? null,
    currentRunId: input?.currentRunId ?? null,
    currentRunProgressJobId: input?.currentRunProgressJobId ?? null,
    currentRunStatus: input?.currentRunStatus ?? null,
    currentRunProgressPercent: input?.currentRunProgressPercent ?? null,
    currentRunProcessedCount: input?.currentRunProcessedCount ?? null,
    currentRunTotalCount: input?.currentRunTotalCount ?? null,
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function buildSequenceStatus(job: ProgressJob): FirstImportSequenceStatus {
  const meta = (job.meta && typeof job.meta === 'object') ? job.meta : null
  const currentStep = readString(meta?.currentStep)
  const currentRunStatus = readString(meta?.currentRunStatus)
  return {
    progressJobId: job.id,
    status: job.status,
    currentStep: currentStep === 'categories' || currentStep === 'attributes' || currentStep === 'products'
      ? currentStep
      : null,
    currentRunId: readString(meta?.currentRunId),
    currentRunProgressJobId: readString(meta?.currentRunProgressJobId),
    currentRunStatus: currentRunStatus === 'pending'
      || currentRunStatus === 'running'
      || currentRunStatus === 'completed'
      || currentRunStatus === 'failed'
      || currentRunStatus === 'cancelled'
      ? currentRunStatus
      : null,
    progressPercent: readNumber(meta?.currentRunProgressPercent),
    processedCount: readNumber(meta?.currentRunProcessedCount),
    totalCount: readNumber(meta?.currentRunTotalCount),
    errorMessage: job.errorMessage ?? null,
  }
}

export async function findLatestAkeneoFirstImportJob(
  em: EntityManager,
  scope: Pick<AkeneoFirstImportScope, 'organizationId' | 'tenantId'>,
): Promise<ProgressJob | null> {
  const [job] = await findWithDecryption(
    em,
    ProgressJob,
    {
      jobType: 'sync_akeneo.first_import',
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      status: { $in: ['pending', 'running', 'failed'] },
    },
    {
      limit: 1,
      orderBy: { createdAt: 'DESC' },
    },
    scope,
  )

  return job ?? null
}

export async function getAkeneoFirstImportStatus(params: {
  container: AwilixContainer
  scope: Pick<AkeneoFirstImportScope, 'organizationId' | 'tenantId'>
}): Promise<FirstImportSequenceStatus | null> {
  const em = params.container.resolve('em') as EntityManager
  const job = await findLatestAkeneoFirstImportJob(em, params.scope)
  return job ? buildSequenceStatus(job) : null
}

export async function runAkeneoFirstImportSequence(params: {
  container: AwilixContainer
  progressJobId: string
  scope: AkeneoFirstImportScope
}): Promise<void> {
  const { container, progressJobId, scope } = params
  const em = container.resolve('em') as EntityManager
  const progressService = container.resolve('progressService') as ProgressService
  const syncRunService = container.resolve('dataSyncRunService') as SyncRunService
  const progressContext = buildProgressContext(scope)

  await progressService.startJob(progressJobId, progressContext)
  await progressService.updateProgress(
    progressJobId,
    {
      totalCount: FIRST_IMPORT_STEPS.length,
      processedCount: 0,
      meta: buildSequenceMeta(),
    },
    progressContext,
  )

  for (const [stepIndex, entityType] of FIRST_IMPORT_STEPS.entries()) {
    const overlap = await syncRunService.findRunningOverlap('sync_akeneo', entityType, 'import', scope)
    const run = overlap ?? (await startDataSyncRun({
      syncRunService,
      progressService,
      scope,
      input: {
        integrationId: 'sync_akeneo',
        entityType,
        direction: 'import',
        triggeredBy: scope.userId ?? null,
        batchSize: 100,
      },
    })).run

    await progressService.updateProgress(
      progressJobId,
      {
        totalCount: FIRST_IMPORT_STEPS.length,
        processedCount: stepIndex,
        meta: buildSequenceMeta({
          currentStep: entityType,
          currentRunId: run.id,
          currentRunProgressJobId: run.progressJobId ?? null,
          currentRunStatus: run.status,
          currentRunProgressPercent: null,
          currentRunProcessedCount: 0,
          currentRunTotalCount: null,
        }),
      },
      progressContext,
    )

    while (true) {
      em.clear()
      const currentRun = await syncRunService.getRun(run.id, scope)
      if (!currentRun) {
        throw new Error(`Sync run ${run.id} could not be loaded`)
      }

      const currentRunJob = currentRun.progressJobId
        ? await progressService.getJob(currentRun.progressJobId, progressContext)
        : null

      await progressService.updateProgress(
        progressJobId,
        {
          totalCount: FIRST_IMPORT_STEPS.length,
          processedCount: stepIndex,
          meta: buildSequenceMeta({
            currentStep: entityType,
            currentRunId: currentRun.id,
            currentRunProgressJobId: currentRun.progressJobId ?? null,
            currentRunStatus: currentRun.status,
            currentRunProgressPercent: currentRunJob?.totalCount ? currentRunJob.progressPercent : null,
            currentRunProcessedCount: currentRunJob?.processedCount ?? null,
            currentRunTotalCount: currentRunJob?.totalCount ?? null,
          }),
        },
        progressContext,
      )

      if (currentRun.status === 'completed') {
        break
      }

      if (currentRun.status === 'failed') {
        throw new Error(currentRun.lastError ?? `${entityType} sync failed`)
      }

      if (currentRun.status === 'cancelled') {
        throw new Error(`${entityType} sync was cancelled`)
      }

      await sleep(1500)
    }

    await progressService.updateProgress(
      progressJobId,
      {
        totalCount: FIRST_IMPORT_STEPS.length,
        processedCount: stepIndex + 1,
        meta: buildSequenceMeta({
          currentStep: entityType,
          currentRunId: run.id,
          currentRunProgressJobId: run.progressJobId ?? null,
          currentRunStatus: 'completed',
          currentRunProgressPercent: 100,
          currentRunProcessedCount: null,
          currentRunTotalCount: null,
        }),
      },
      progressContext,
    )
  }

  await progressService.completeJob(
    progressJobId,
    {
      resultSummary: {
        message: 'The first full Akeneo import finished successfully.',
      },
    },
    progressContext,
  )
}
