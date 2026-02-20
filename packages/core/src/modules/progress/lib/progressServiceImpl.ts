import type { EntityManager } from '@mikro-orm/core'
import { ProgressJob } from '../data/entities'
import type { ProgressService } from './progressService'
import { calculateEta, calculateProgressPercent, STALE_JOB_TIMEOUT_SECONDS } from './progressService'
import { PROGRESS_EVENTS } from './events'

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
        jobId: job.id,
        jobType: job.jobType,
        name: job.name,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })

      return job
    },

    async startJob(jobId, ctx) {
      const job = await em.findOneOrFail(ProgressJob, { id: jobId, tenantId: ctx.tenantId })

      job.status = 'running'
      job.startedAt = new Date()
      job.heartbeatAt = new Date()

      await em.flush()

      await eventBus.emit(PROGRESS_EVENTS.JOB_STARTED, {
        jobId: job.id,
        jobType: job.jobType,
        tenantId: ctx.tenantId,
      })

      return job
    },

    async updateProgress(jobId, input, ctx) {
      const job = await em.findOneOrFail(ProgressJob, { id: jobId, tenantId: ctx.tenantId })

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
        jobId: job.id,
        jobType: job.jobType,
        progressPercent: job.progressPercent,
        processedCount: job.processedCount,
        totalCount: job.totalCount,
        etaSeconds: job.etaSeconds,
        tenantId: ctx.tenantId,
      })

      return job
    },

    async incrementProgress(jobId, delta, ctx) {
      const job = await em.findOneOrFail(ProgressJob, { id: jobId, tenantId: ctx.tenantId })

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
        jobId: job.id,
        progressPercent: job.progressPercent,
        processedCount: job.processedCount,
        tenantId: ctx.tenantId,
      })

      return job
    },

    async completeJob(jobId, input) {
      const job = await em.findOne(ProgressJob, { id: jobId })
      if (!job) throw new Error(`Job ${jobId} not found`)

      job.status = 'completed'
      job.finishedAt = new Date()
      job.progressPercent = 100
      job.etaSeconds = 0
      if (input?.resultSummary) {
        job.resultSummary = input.resultSummary
      }

      await em.flush()

      await eventBus.emit(PROGRESS_EVENTS.JOB_COMPLETED, {
        jobId: job.id,
        jobType: job.jobType,
        resultSummary: job.resultSummary,
        tenantId: job.tenantId,
      })

      return job
    },

    async failJob(jobId, input) {
      const job = await em.findOne(ProgressJob, { id: jobId })
      if (!job) throw new Error(`Job ${jobId} not found`)

      job.status = 'failed'
      job.finishedAt = new Date()
      job.errorMessage = input.errorMessage
      job.errorStack = input.errorStack

      await em.flush()

      await eventBus.emit(PROGRESS_EVENTS.JOB_FAILED, {
        jobId: job.id,
        jobType: job.jobType,
        errorMessage: job.errorMessage,
        tenantId: job.tenantId,
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
        jobId: job.id,
        jobType: job.jobType,
        tenantId: ctx.tenantId,
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
        organizationId: ctx.organizationId ?? null,
        status: { $in: ['pending', 'running'] },
        parentJobId: null,
      }, {
        orderBy: { createdAt: 'DESC' },
      })
    },

    async getJob(jobId, ctx) {
      return em.findOne(ProgressJob, {
        id: jobId,
        tenantId: ctx.tenantId,
      })
    },

    async markStaleJobsFailed(timeoutSeconds = STALE_JOB_TIMEOUT_SECONDS) {
      const cutoff = new Date(Date.now() - timeoutSeconds * 1000)

      const staleJobs = await em.find(ProgressJob, {
        status: 'running',
        heartbeatAt: { $lt: cutoff },
      })

      for (const job of staleJobs) {
        job.status = 'failed'
        job.finishedAt = new Date()
        job.errorMessage = `Job stale: no heartbeat for ${timeoutSeconds} seconds`

        await eventBus.emit(PROGRESS_EVENTS.JOB_FAILED, {
          jobId: job.id,
          jobType: job.jobType,
          errorMessage: job.errorMessage,
          tenantId: job.tenantId,
          stale: true,
        })
      }

      await em.flush()
      return staleJobs.length
    },
  }
}
