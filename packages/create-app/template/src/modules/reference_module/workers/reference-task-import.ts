import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { ProgressService, ProgressServiceContext } from '@open-mercato/core/modules/progress/lib/progressService'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitReferenceModuleEvent } from '../events'
import { ReferenceTask } from '../data/entities'
import { invalidateReferenceTaskCache } from '../lib/task-cache'
import {
  parseReferenceImportCsv,
  referenceImportRowId,
  REFERENCE_TASK_IMPORT_QUEUE,
  validateReferenceImportRow,
  type ReferenceTaskImportJobPayload,
  type ReferenceTaskImportSummary,
} from '../lib/task-import'

type HandlerContext = JobContext & { resolve: <T = unknown>(name: string) => T }

export const metadata: WorkerMeta = {
  queue: REFERENCE_TASK_IMPORT_QUEUE,
  id: 'reference_module:reference-task-import',
  concurrency: 3,
}

function commandContext(job: ReferenceTaskImportJobPayload, ctx: HandlerContext): CommandRuntimeContext {
  return {
    container: { resolve: ctx.resolve.bind(ctx) } as CommandRuntimeContext['container'],
    auth: {
      sub: job.scope.userId ?? 'system',
      tenantId: job.scope.tenantId,
      orgId: job.scope.organizationId,
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: job.scope.organizationId,
    organizationIds: [job.scope.organizationId],
    syncOrigin: `reference_module.import:${job.idempotencyKeyHash}`,
  }
}

export default async function handle(
  job: QueuedJob<ReferenceTaskImportJobPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const payload = job.payload
  const rows = parseReferenceImportCsv(payload.csv)
  const progressService = ctx.resolve<ProgressService>('progressService')
  const progressContext: ProgressServiceContext = payload.scope
  const commandBus = ctx.resolve<CommandBus>('commandBus')
  const em = (ctx.resolve<EntityManager>('em')).fork()
  const summary: ReferenceTaskImportSummary = {
    totalCount: rows.length,
    processedCount: 0,
    succeededCount: 0,
    failedCount: 0,
    skippedCount: 0,
    status: 'completed',
  }

  try {
    await progressService.startJob(payload.progressJobId, progressContext)
    for (const [rowIndex, row] of rows.entries()) {
      if (await progressService.isCancellationRequested(
        payload.progressJobId,
        payload.scope.tenantId,
        payload.scope.organizationId,
      )) {
        summary.status = 'cancelled'
        summary.skippedCount += rows.length - rowIndex
        await progressService.updateProgress(payload.progressJobId, {
          totalCount: rows.length,
          processedCount: summary.processedCount,
          meta: {
            succeededCount: summary.succeededCount,
            failedCount: summary.failedCount,
            skippedCount: summary.skippedCount,
            status: summary.status,
          },
        }, progressContext)
        await progressService.markCancelled(payload.progressJobId, progressContext)
        break
      }

      const taskId = referenceImportRowId(payload.scope, payload.idempotencyKeyHash, rowIndex)
      try {
        const existing = await findOneWithDecryption(em, ReferenceTask, {
          id: taskId,
          tenantId: payload.scope.tenantId,
          organizationId: payload.scope.organizationId,
        }, undefined, payload.scope)
        if (existing) {
          summary.skippedCount += 1
        } else {
          const parsed = validateReferenceImportRow(row)
          await commandBus.execute('reference_module.reference_task.create', {
            input: {
              ...parsed.task,
              importId: taskId,
              importLink: parsed.target,
            },
            ctx: commandContext(payload, ctx),
          })
          summary.succeededCount += 1
        }
      } catch (error) {
        if (isUniqueViolation(error)) {
          summary.skippedCount += 1
        } else if (error instanceof Error && error.name === 'ZodError') {
          summary.failedCount += 1
        } else if (isCrudHttpError(error) && error.status >= 400 && error.status < 500) {
          summary.failedCount += 1
        } else {
          throw error
        }
      }
      summary.processedCount += 1
      await progressService.updateProgress(payload.progressJobId, {
        totalCount: rows.length,
        processedCount: summary.processedCount,
        meta: {
          succeededCount: summary.succeededCount,
          failedCount: summary.failedCount,
          skippedCount: summary.skippedCount,
        },
      }, progressContext)
    }

    if (summary.status !== 'cancelled') {
      summary.status = summary.failedCount === rows.length
        ? 'failed'
        : summary.failedCount > 0 ? 'partial' : 'completed'
      if (summary.status === 'failed') {
        await progressService.updateProgress(payload.progressJobId, { meta: summary }, progressContext)
        await progressService.failJob(payload.progressJobId, { errorMessage: 'All reference import rows failed validation' }, progressContext)
      } else {
        await progressService.completeJob(payload.progressJobId, { resultSummary: summary }, progressContext)
      }
    }
    await Promise.allSettled([
      invalidateReferenceTaskCache(commandContext(payload, ctx).container, payload.scope),
      emitReferenceModuleEvent('reference_module.import.completed', {
        jobId: payload.progressJobId,
        ...summary,
        tenantId: payload.scope.tenantId,
        organizationId: payload.scope.organizationId,
        recipientUserId: payload.scope.userId ?? null,
      }),
    ])
  } catch (error) {
    summary.status = 'failed'
    await progressService.failJob(payload.progressJobId, { errorMessage: 'Reference task import failed' }, progressContext)
    await Promise.allSettled([
      invalidateReferenceTaskCache(commandContext(payload, ctx).container, payload.scope),
      emitReferenceModuleEvent('reference_module.import.completed', {
        jobId: payload.progressJobId,
        ...summary,
        tenantId: payload.scope.tenantId,
        organizationId: payload.scope.organizationId,
        recipientUserId: payload.scope.userId ?? null,
      }),
    ])
    throw error
  }
}
