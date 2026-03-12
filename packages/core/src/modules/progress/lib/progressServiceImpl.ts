import type { EntityManager } from '@mikro-orm/core'
import { ProgressJob } from '../data/entities'
import type { ProgressService } from './progressService'
import { calculateEta, calculateProgressPercent, STALE_JOB_TIMEOUT_SECONDS } from './progressService'
import { PROGRESS_EVENTS } from './events'

function buildJobPayload(job: ProgressJob): Record<string, unknown> {
  return {
    jobId: job.id,
    jobType: job.jobType,
    name: job.name,
    description: job.description ?? null,
    status: job.status,
    progressPercent: job.progressPercent,
    processedCount: job.processedCount,
    totalCount: job.totalCount ?? null,
    etaSeconds: job.etaSeconds ?? null,
    cancellable: job.cancellable,
    meta: job.meta ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  }
}

export function createProgressService(em: EntityManager, eventBus: { emit: (event: string, payload: Record<string, unknown>) => Promise<void> }): ProgressService {
  return {
    async createJob(input, ctx) {
      const job = em.create(ProgressJob, {
        jobType: input.jobType,
        name: input.name,
        description: input.description,
        totalCount: input.totalCount,
        cancellable: input.cancellable ?? false,
        meta: input.meta,
        parentJobId: input.parentJobId,
        partitionIndex: input.partitionIndex,
        partitionCount: input.partitionCount,
        startedByUserId: ctx.userId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        status: 'pending',
      })

      await em.persistAndFlush(job)

      await eventBus.emit(PROGRESS_EVENTS.JOB_CREATED, {
        ...buildJobPayload(job),
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })

      return job
    },

    async startJob(jobId, ctx) {
      const job = await em.findOneOrFail(ProgressJob, { id: jobId, tenantId: ctx.tenantId })
      if (job.status === 'cancelled') {
        return job
      }

      job.status = 'running'
      job.startedAt = new Date()
      job.heartbeatAt = new Date()

      await em.flush()

      await eventBus.emit(PROGRESS_EVENTS.JOB_STARTED, {
        ...buildJobPayload(job),
        tenantId: ctx.tenantId,
        organizationId: job.organizationId ?? null,
      })

      return job
    },

    async updateProgress(jobId, input, ctx) {
      const job = await em.findOneOrFail(ProgressJob, { id: jobId, tenantId: ctx.tenantId })
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        return job
      }

      if (input.processedCount !== undefined) {
        job.processedCount = input.processedCount
      }
      if (input.totalCount !== undefined) {
        job.totalCount = input.totalCount
      }
      if (input.meta !== undefined) {
        job.meta = { ...job.meta, ...input.meta }
      }

      if (input.progressPercent !== undefined) {
        job.progressPercent = input.progressPercent
      } else if (job.totalCount) {
        job.progressPercent = calculateProgressPercent(job.processedCount, job.totalCount)
      }

      if (input.etaSeconds !== undefined) {
        job.etaSeconds = input.etaSeconds
      } else if (job.startedAt && job.totalCount) {
        job.etaSeconds = calculateEta(job.processedCount, job.totalCount, job.startedAt)
      }

      job.heartbeatAt = new Date()

      await em.flush()

      await eventBus.emit(PROGRESS_EVENTS.JOB_UPDATED, {
        ...buildJobPayload(job),
        tenantId: ctx.tenantId,
        organizationId: job.organizationId ?? null,
      })

      return job
    },

    async incrementProgress(jobId, delta, ctx) {
      const job = await em.findOneOrFail(ProgressJob, { id: jobId, tenantId: ctx.tenantId })
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        return job
      }

      job.processedCount += delta
      job.heartbeatAt = new Date()

      if (job.totalCount) {
        job.progressPercent = calculateProgressPercent(job.processedCount, job.totalCount)
        if (job.startedAt) {
          job.etaSeconds = calculateEta(job.processedCount, job.totalCount, job.startedAt)
        }
      }

      await em.flush()

      await eventBus.emit(PROGRESS_EVENTS.JOB_UPDATED, {
        ...buildJobPayload(job),
        tenantId: ctx.tenantId,
        organizationId: job.organizationId ?? null,
      })

      return job
    },

    async completeJob(jobId, input, ctx) {
      const job = await em.findOne(ProgressJob, { id: jobId, tenantId: ctx.tenantId })
      if (!job) throw new Error(`Job ${jobId} not found`)
      if (job.status === 'cancelled') {
        return job
      }

      job.status = 'completed'
      job.finishedAt = new Date()
      job.progressPercent = 100
      job.etaSeconds = 0
      if (input?.resultSummary) {
        job.resultSummary = input.resultSummary
      }

      await em.flush()

      await eventBus.emit(PROGRESS_EVENTS.JOB_COMPLETED, {
        ...buildJobPayload(job),
        resultSummary: job.resultSummary,
        tenantId: ctx.tenantId,
        organizationId: job.organizationId ?? null,
      })

      return job
    },

    async failJob(jobId, input, ctx) {
      const job = await em.findOne(ProgressJob, { id: jobId, tenantId: ctx.tenantId })
      if (!job) throw new Error(`Job ${jobId} not found`)
      if (job.status === 'cancelled') {
        return job
      }

      job.status = 'failed'
      job.finishedAt = new Date()
      job.errorMessage = input.errorMessage
      job.errorStack = input.errorStack

      await em.flush()

      await eventBus.emit(PROGRESS_EVENTS.JOB_FAILED, {
        ...buildJobPayload(job),
        errorMessage: job.errorMessage,
        tenantId: ctx.tenantId,
        organizationId: job.organizationId ?? null,
      })

      return job
    },

    async cancelJob(jobId, ctx) {
      const job = await em.findOneOrFail(ProgressJob, {
        id: jobId,
        tenantId: ctx.tenantId,
        cancellable: true,
        status: { $in: ['pending', 'running'] },
      })

      job.cancelRequestedAt = new Date()
      job.cancelledByUserId = ctx.userId

      if (job.status === 'pending') {
        job.status = 'cancelled'
        job.finishedAt = new Date()
      }

      await em.flush()

      await eventBus.emit(PROGRESS_EVENTS.JOB_CANCELLED, {
        ...buildJobPayload(job),
        tenantId: ctx.tenantId,
        organizationId: job.organizationId ?? null,
      })

      return job
    },

    async markCancelled(jobId, ctx) {
      const job = await em.findOne(ProgressJob, { id: jobId, tenantId: ctx.tenantId })
      if (!job) throw new Error(`Job ${jobId} not found`)
      if (job.status === 'cancelled') {
        return job
      }

      job.cancelRequestedAt = job.cancelRequestedAt ?? new Date()
      job.cancelledByUserId = ctx.userId
      job.status = 'cancelled'
      job.finishedAt = job.finishedAt ?? new Date()
      job.etaSeconds = 0

      await em.flush()

      await eventBus.emit(PROGRESS_EVENTS.JOB_CANCELLED, {
        ...buildJobPayload(job),
        tenantId: ctx.tenantId,
        organizationId: job.organizationId ?? null,
      })

      return job
    },

    async isCancellationRequested(jobId) {
      const job = await em.findOne(ProgressJob, { id: jobId })
      return job?.cancelRequestedAt != null
    },

    async getActiveJobs(ctx) {
      return em.find(ProgressJob, {
        tenantId: ctx.tenantId,
        ...(ctx.organizationId ? { organizationId: ctx.organizationId } : {}),
        status: { $in: ['pending', 'running'] },
        parentJobId: null,
      }, {
        orderBy: { createdAt: 'DESC' },
        limit: 50,
      })
    },

    async getRecentlyCompletedJobs(ctx, sinceSeconds = 30) {
      const cutoff = new Date(Date.now() - sinceSeconds * 1000)
      return em.find(ProgressJob, {
        tenantId: ctx.tenantId,
        ...(ctx.organizationId ? { organizationId: ctx.organizationId } : {}),
        status: { $in: ['completed', 'failed'] },
        finishedAt: { $gte: cutoff },
        parentJobId: null,
      }, {
        orderBy: { finishedAt: 'DESC' },
        limit: 10,
      })
    },

    async getJob(jobId, ctx) {
      return em.findOne(ProgressJob, {
        id: jobId,
        tenantId: ctx.tenantId,
      })
    },

    async markStaleJobsFailed(tenantId: string, timeoutSeconds = STALE_JOB_TIMEOUT_SECONDS) {
      const cutoff = new Date(Date.now() - timeoutSeconds * 1000)

      const staleJobs = await em.find(ProgressJob, {
        tenantId,
        status: 'running',
        $or: [
          { heartbeatAt: { $lt: cutoff } },
          {
            heartbeatAt: null,
            startedAt: { $lt: cutoff },
          },
        ],
      })

      for (const job of staleJobs) {
        job.status = 'failed'
        job.finishedAt = new Date()
        job.errorMessage = `Job stale: no heartbeat for ${timeoutSeconds} seconds`

        await eventBus.emit(PROGRESS_EVENTS.JOB_FAILED, {
          ...buildJobPayload(job),
          errorMessage: job.errorMessage,
          tenantId: job.tenantId,
          stale: true,
          organizationId: job.organizationId ?? null,
        })
      }

      await em.flush()
      return staleJobs.length
    },
  }
}
