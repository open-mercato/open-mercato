import type { EntityManager } from '@mikro-orm/postgresql'
import { raw } from '@mikro-orm/core'
import type { EntityData, FilterQuery } from '@mikro-orm/core'
import { ProgressJob, type ProgressJobStatus } from '../data/entities'
import type { ProgressService, ProgressServiceContext } from './progressService'
import {
  calculateEta,
  calculateProgressPercent,
  HEARTBEAT_INTERVAL_MS,
  STALE_JOB_TIMEOUT_SECONDS,
  STALE_PENDING_TIMEOUT_SECONDS,
  STALE_SWEEP_ERROR_PREFIX,
} from './progressService'
import { PROGRESS_EVENTS } from './events'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const DEFAULT_BROADCAST_MIN_INTERVAL_MS = 250

// Minimum elapsed time between coalesced `progress.job.updated` broadcasts for a
// single job. Bulk workers call updateProgress/incrementProgress once per record, and
// every emit of the `clientBroadcast: true` event pays a serialized pg_notify roundtrip
// plus a tenant-wide SSE fan-out. Setting the knob to 0 restores per-record emission.
// Persistence is throttled separately: heartbeats hit the database at least every
// HEARTBEAT_INTERVAL_MS regardless of this knob, so a high broadcast interval can
// never starve the stale-job sweep of heartbeats.
function resolveBroadcastMinIntervalMs(): number {
  const rawValue = process.env.OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS
  if (rawValue == null || rawValue.trim() === '') return DEFAULT_BROADCAST_MIN_INTERVAL_MS
  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_BROADCAST_MIN_INTERVAL_MS
  return parsed
}

// Statuses a given transition is allowed to move FROM. Every write below is a
// compare-and-swap (`nativeUpdate` guarded on status), so concurrent writers in other
// processes can never resurrect a terminal job or double-apply a transition — the
// UPDATE that matches zero rows simply lost the race and must not emit events.
const TERMINAL_STATUSES: readonly ProgressJobStatus[] = ['completed', 'failed', 'cancelled']
const PROGRESS_WRITABLE_STATUSES: readonly ProgressJobStatus[] = ['pending', 'running']
// `failed` is restartable/completable so a job wrongly swept as stale (worker alive but
// slow) or retried by an at-least-once queue converges to its true outcome.
const START_FROM_STATUSES: readonly ProgressJobStatus[] = ['pending', 'failed']
const COMPLETE_FROM_STATUSES: readonly ProgressJobStatus[] = ['pending', 'running', 'failed']
const FAIL_FROM_STATUSES: readonly ProgressJobStatus[] = ['pending', 'running']
const CANCEL_FROM_STATUSES: readonly ProgressJobStatus[] = ['pending', 'running', 'failed']

type JobUpdateThrottleEntry = {
  job: ProgressJob
  lastBroadcastAt: number
  lastPersistedAt: number
  lastBroadcastPercent: number
  pendingDelta: number
  absoluteCountsPending: boolean
}

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
  const broadcastMinIntervalMs = resolveBroadcastMinIntervalMs()
  // Per-job coalescing state, scoped to this service instance (request/worker scope).
  // The cached entity is a DETACHED snapshot (loaded with disableIdentityMap) that doubles
  // as the in-memory buffer: intermediate updates mutate it without touching the shared
  // identity map or UnitOfWork, so an unrelated em.flush() elsewhere can never write the
  // buffered values. Persistence happens exclusively through the CAS nativeUpdate below.
  const jobUpdateThrottle = new Map<string, JobUpdateThrottleEntry>()

  function jobScopeFilter(jobId: string, ctx: ProgressServiceContext) {
    return {
      id: jobId,
      tenantId: ctx.tenantId,
      ...(ctx.organizationId ? { organizationId: ctx.organizationId } : {}),
    }
  }

  async function loadFreshJob(jobId: string, ctx: ProgressServiceContext): Promise<ProgressJob | null> {
    return em.findOne(ProgressJob, jobScopeFilter(jobId, ctx), { disableIdentityMap: true })
  }

  async function ensureThrottleEntry(jobId: string, ctx: ProgressServiceContext): Promise<JobUpdateThrottleEntry> {
    const cached = jobUpdateThrottle.get(jobId)
    if (cached) return cached
    const job = await em.findOneOrFail(ProgressJob, jobScopeFilter(jobId, ctx), { disableIdentityMap: true })
    const entry: JobUpdateThrottleEntry = {
      job,
      lastBroadcastAt: 0,
      lastPersistedAt: 0,
      lastBroadcastPercent: job.progressPercent,
      pendingDelta: 0,
      absoluteCountsPending: false,
    }
    jobUpdateThrottle.set(jobId, entry)
    return entry
  }

  function forgetJobThrottle(jobId: string) {
    jobUpdateThrottle.delete(jobId)
  }

  function buildBufferedCountData(entry: JobUpdateThrottleEntry): EntityData<ProgressJob> {
    if (entry.absoluteCountsPending || !Number.isSafeInteger(entry.pendingDelta)) {
      return { processedCount: entry.job.processedCount }
    }
    if (entry.pendingDelta !== 0) {
      const processedCount = raw(`processed_count + ${entry.pendingDelta}`)
      const totalCount = entry.job.totalCount
      if (Number.isSafeInteger(totalCount) && totalCount != null && totalCount > 0) {
        return {
          processedCount,
          progressPercent: raw(
            `least(100, round(((processed_count + ${entry.pendingDelta})::numeric / ${totalCount}) * 100))`,
          ),
        }
      }
      return { processedCount }
    }
    return {}
  }

  // The start transition (START_FROM_STATUSES) doubles as the recovery path for jobs a
  // stale sweep flipped to `failed` while their producer was alive but slow. Callers pass
  // the EM to run against so the forked heartbeat path can reuse the same CAS.
  //
  // `staleSweptOnly` is for the revive paths: a live write proves the producer is alive,
  // but it does NOT prove the recorded failure was the sweep's. Narrowing the CAS to rows
  // the sweep tagged keeps a genuine failure's message and stack intact instead of
  // resurrecting the job and erasing why it died. `startJob` stays unrestricted so an
  // at-least-once queue can still retry a genuinely failed job from the top.
  async function startJobViaCas(
    targetEm: EntityManager,
    job: ProgressJob,
    ctx: ProgressServiceContext,
    options: { staleSweptOnly?: boolean } = {},
  ): Promise<ProgressJob | null> {
    const now = new Date()
    // Progress counts are absolute and survive across deliveries, so the elapsed window
    // calculateEta divides them by has to survive too. Resetting it on every revive makes
    // a job with hours of work left report seconds remaining.
    const startedAt = job.startedAt ?? now
    const filter: Record<string, unknown> = {
      ...jobScopeFilter(job.id, ctx),
      status: { $in: START_FROM_STATUSES as ProgressJobStatus[] },
    }
    if (options.staleSweptOnly) filter.errorMessage = { $like: `${STALE_SWEEP_ERROR_PREFIX}%` }
    const affected = await targetEm.nativeUpdate(ProgressJob, filter as FilterQuery<ProgressJob>, {
      status: 'running',
      startedAt,
      heartbeatAt: now,
      finishedAt: null,
      errorMessage: null,
      errorStack: null,
      updatedAt: now,
    })
    if (affected === 0) return null

    job.status = 'running'
    job.startedAt = startedAt
    job.heartbeatAt = now
    job.finishedAt = null
    job.errorMessage = null
    job.errorStack = null

    await eventBus.emit(PROGRESS_EVENTS.JOB_STARTED, {
      ...buildJobPayload(job),
      tenantId: ctx.tenantId,
      organizationId: job.organizationId ?? null,
    })

    return job
  }

  async function persistAndMaybeBroadcast(entry: JobUpdateThrottleEntry, ctx: ProgressServiceContext): Promise<ProgressJob> {
    const job = entry.job
    const now = Date.now()
    const shouldBroadcast =
      broadcastMinIntervalMs <= 0 ||
      now - entry.lastBroadcastAt >= broadcastMinIntervalMs ||
      Math.abs(job.progressPercent - entry.lastBroadcastPercent) >= 1
    const shouldPersist = shouldBroadcast || now - entry.lastPersistedAt >= HEARTBEAT_INTERVAL_MS

    if (!shouldPersist) return job

    const usesAtomicIncrement =
      !entry.absoluteCountsPending && Number.isSafeInteger(entry.pendingDelta) && entry.pendingDelta !== 0
    const data: EntityData<ProgressJob> = {
      progressPercent: job.progressPercent,
      totalCount: job.totalCount ?? null,
      etaSeconds: job.etaSeconds ?? null,
      meta: job.meta ?? null,
      heartbeatAt: job.heartbeatAt ?? new Date(),
      updatedAt: new Date(),
      ...buildBufferedCountData(entry),
    }
    const writableFilter = {
      ...jobScopeFilter(job.id, ctx),
      status: { $in: PROGRESS_WRITABLE_STATUSES as ProgressJobStatus[] },
    } as FilterQuery<ProgressJob>
    let affected = await em.nativeUpdate(ProgressJob, writableFilter, data)

    if (affected === 0) {
      // A stale sweep may have flipped a live job to `failed` between writes. Revive it
      // through the start CAS and retry once so the buffered delta isn't silently dropped.
      const fresh = await loadFreshJob(job.id, ctx)
      let revived = false
      if (fresh && fresh.status === 'failed' && (await startJobViaCas(em, fresh, ctx, { staleSweptOnly: true }))) {
        revived = true
        job.status = 'running'
        job.startedAt = fresh.startedAt
        job.finishedAt = null
        job.errorMessage = null
        job.errorStack = null
        affected = await em.nativeUpdate(ProgressJob, writableFilter, data)
      }
      if (affected === 0) {
        // The job reached a genuinely terminal state in another process; stop writing to it.
        forgetJobThrottle(job.id)
        const latest = revived ? await loadFreshJob(job.id, ctx) : fresh
        return latest ?? job
      }
    }

    const persistedJob = usesAtomicIncrement ? (await loadFreshJob(job.id, ctx)) ?? job : job
    entry.job = persistedJob
    entry.pendingDelta = 0
    entry.absoluteCountsPending = false
    entry.lastPersistedAt = now

    if (shouldBroadcast) {
      await eventBus.emit(PROGRESS_EVENTS.JOB_UPDATED, {
        ...buildJobPayload(persistedJob),
        tenantId: ctx.tenantId,
        organizationId: persistedJob.organizationId ?? null,
      })
      entry.lastBroadcastAt = now
      entry.lastBroadcastPercent = persistedJob.progressPercent
    }

    return persistedJob
  }

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

      await em.persist(job).flush()

      await eventBus.emit(PROGRESS_EVENTS.JOB_CREATED, {
        ...buildJobPayload(job),
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })

      return job
    },

    async startJob(jobId, ctx) {
      const job = await em.findOneOrFail(ProgressJob, jobScopeFilter(jobId, ctx), { disableIdentityMap: true })
      if (job.status === 'running' || job.status === 'cancelled' || job.status === 'completed') {
        return job
      }

      const started = await startJobViaCas(em, job, ctx)
      if (started) return started

      const fresh = await loadFreshJob(jobId, ctx)
      return fresh ?? job
    },

    async touchJobHeartbeat(jobId, ctx) {
      // Forked EM: keepalive timers call this while the shared EM may be mid-transaction
      // inside a producer's own writes, so the heartbeat must not join that unit of work.
      const fork = em.fork()
      const now = new Date()
      const affected = await fork.nativeUpdate(ProgressJob, {
        ...jobScopeFilter(jobId, ctx),
        status: { $in: PROGRESS_WRITABLE_STATUSES as ProgressJobStatus[] },
      } as FilterQuery<ProgressJob>, {
        heartbeatAt: now,
        updatedAt: now,
      })
      if (affected > 0) return

      const job = await fork.findOne(ProgressJob, jobScopeFilter(jobId, ctx), { disableIdentityMap: true })
      if (!job || job.status !== 'failed') return
      // A live producer heartbeating a `failed` job means a stale sweep false-positived;
      // revive through the start CAS so the card recovers without waiting for a batch boundary.
      await startJobViaCas(fork, job, ctx, { staleSweptOnly: true })
    },

    async updateProgress(jobId, input, ctx) {
      const entry = await ensureThrottleEntry(jobId, ctx)
      const job = entry.job
      if (TERMINAL_STATUSES.includes(job.status)) {
        // `failed` may be a false-positive stale sweep on a slow-but-alive producer; the
        // fact that this write is happening proves the producer is alive, so revive and
        // apply the update. `completed`/`cancelled` stay terminal, and a failure the sweep
        // did not write keeps its diagnostics (see startJobViaCas).
        const revived = job.status === 'failed' && (await startJobViaCas(em, job, ctx, { staleSweptOnly: true }))
        if (!revived) {
          forgetJobThrottle(jobId)
          return job
        }
        entry.lastPersistedAt = 0
      }

      if (input.processedCount !== undefined) {
        job.processedCount = input.processedCount
        entry.absoluteCountsPending = true
        entry.pendingDelta = 0
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

      return persistAndMaybeBroadcast(entry, ctx)
    },

    async incrementProgress(jobId, delta, ctx) {
      const entry = await ensureThrottleEntry(jobId, ctx)
      const job = entry.job
      if (TERMINAL_STATUSES.includes(job.status)) {
        const revived = job.status === 'failed' && (await startJobViaCas(em, job, ctx, { staleSweptOnly: true }))
        if (!revived) {
          forgetJobThrottle(jobId)
          return job
        }
        entry.lastPersistedAt = 0
      }

      job.processedCount += delta
      entry.pendingDelta += delta
      job.heartbeatAt = new Date()

      if (job.totalCount) {
        job.progressPercent = calculateProgressPercent(job.processedCount, job.totalCount)
        if (job.startedAt) {
          job.etaSeconds = calculateEta(job.processedCount, job.totalCount, job.startedAt)
        }
      }

      return persistAndMaybeBroadcast(entry, ctx)
    },

    async completeJob(jobId, input, ctx) {
      const job = await loadFreshJob(jobId, ctx)
      if (!job) throw new Error(`Job ${jobId} not found`)
      if (job.status === 'cancelled' || job.status === 'completed') {
        forgetJobThrottle(jobId)
        return job
      }

      const entry = jobUpdateThrottle.get(jobId)
      const snapshot = entry?.job ?? job
      const now = new Date()
      const data: EntityData<ProgressJob> = {
        status: 'completed',
        finishedAt: now,
        etaSeconds: 0,
        updatedAt: now,
        ...(input?.resultSummary ? { resultSummary: input.resultSummary } : {}),
        ...(entry
          ? {
              totalCount: snapshot.totalCount ?? null,
              meta: snapshot.meta ?? null,
              ...buildBufferedCountData(entry),
            }
          : {}),
        progressPercent: 100,
      }

      const affected = await em.nativeUpdate(ProgressJob, {
        ...jobScopeFilter(jobId, ctx),
        status: { $in: COMPLETE_FROM_STATUSES as ProgressJobStatus[] },
      } as FilterQuery<ProgressJob>, data)
      forgetJobThrottle(jobId)

      if (affected === 0) {
        const fresh = await loadFreshJob(jobId, ctx)
        return fresh ?? job
      }

      snapshot.status = 'completed'
      snapshot.finishedAt = now
      snapshot.progressPercent = 100
      snapshot.etaSeconds = 0
      if (input?.resultSummary) {
        snapshot.resultSummary = input.resultSummary
      }

      const persistedJob = (await loadFreshJob(jobId, ctx)) ?? snapshot

      await eventBus.emit(PROGRESS_EVENTS.JOB_COMPLETED, {
        ...buildJobPayload(persistedJob),
        resultSummary: persistedJob.resultSummary,
        tenantId: ctx.tenantId,
        organizationId: persistedJob.organizationId ?? null,
      })

      return persistedJob
    },

    async failJob(jobId, input, ctx) {
      const job = await loadFreshJob(jobId, ctx)
      if (!job) throw new Error(`Job ${jobId} not found`)
      if (TERMINAL_STATUSES.includes(job.status)) {
        forgetJobThrottle(jobId)
        return job
      }

      const entry = jobUpdateThrottle.get(jobId)
      const snapshot = entry?.job ?? job
      const now = new Date()
      const data: EntityData<ProgressJob> = {
        status: 'failed',
        finishedAt: now,
        errorMessage: input.errorMessage,
        errorStack: input.errorStack,
        ...(input.resultSummary ? { resultSummary: input.resultSummary } : {}),
        updatedAt: now,
        ...(entry
          ? {
              totalCount: snapshot.totalCount ?? null,
              meta: snapshot.meta ?? null,
              ...buildBufferedCountData(entry),
            }
          : {}),
      }

      const affected = await em.nativeUpdate(ProgressJob, {
        ...jobScopeFilter(jobId, ctx),
        status: { $in: FAIL_FROM_STATUSES as ProgressJobStatus[] },
      } as FilterQuery<ProgressJob>, data)
      forgetJobThrottle(jobId)

      if (affected === 0) {
        const fresh = await loadFreshJob(jobId, ctx)
        return fresh ?? job
      }

      snapshot.status = 'failed'
      snapshot.finishedAt = now
      snapshot.errorMessage = input.errorMessage
      snapshot.errorStack = input.errorStack
      if (input.resultSummary) {
        snapshot.resultSummary = input.resultSummary
      }

      const persistedJob = (await loadFreshJob(jobId, ctx)) ?? snapshot

      await eventBus.emit(PROGRESS_EVENTS.JOB_FAILED, {
        ...buildJobPayload(persistedJob),
        errorMessage: persistedJob.errorMessage,
        tenantId: ctx.tenantId,
        organizationId: persistedJob.organizationId ?? null,
      })

      return persistedJob
    },

    async cancelJob(jobId, ctx) {
      const job = await em.findOneOrFail(ProgressJob, jobScopeFilter(jobId, ctx), { disableIdentityMap: true })
      if (TERMINAL_STATUSES.includes(job.status)) {
        // The job finished while the user clicked cancel — a benign race, not an error.
        return job
      }
      if (!job.cancellable) {
        throw new Error(`Job ${jobId} is not cancellable`)
      }

      const now = new Date()
      const cancelledNow = await em.nativeUpdate(ProgressJob, {
        ...jobScopeFilter(jobId, ctx),
        cancellable: true,
        status: 'pending',
      } as FilterQuery<ProgressJob>, {
        status: 'cancelled',
        cancelRequestedAt: now,
        cancelledByUserId: ctx.userId ?? null,
        finishedAt: now,
        etaSeconds: 0,
        updatedAt: now,
      })

      let requested = 0
      if (cancelledNow === 0) {
        requested = await em.nativeUpdate(ProgressJob, {
          ...jobScopeFilter(jobId, ctx),
          cancellable: true,
          status: 'running',
        } as FilterQuery<ProgressJob>, {
          cancelRequestedAt: now,
          cancelledByUserId: ctx.userId ?? null,
          updatedAt: now,
        })
      }

      if (cancelledNow === 0 && requested === 0) {
        // Raced into a terminal state between the read and the CAS.
        const fresh = await loadFreshJob(jobId, ctx)
        return fresh ?? job
      }

      forgetJobThrottle(jobId)
      if (cancelledNow > 0) {
        job.status = 'cancelled'
        job.finishedAt = now
        job.etaSeconds = 0
      }
      job.cancelRequestedAt = now
      job.cancelledByUserId = ctx.userId ?? null

      await eventBus.emit(PROGRESS_EVENTS.JOB_CANCELLED, {
        ...buildJobPayload(job),
        tenantId: ctx.tenantId,
        organizationId: job.organizationId ?? null,
      })

      return job
    },

    async markCancelled(jobId, ctx) {
      const job = await loadFreshJob(jobId, ctx)
      if (!job) throw new Error(`Job ${jobId} not found`)
      if (job.status === 'cancelled' || job.status === 'completed') {
        forgetJobThrottle(jobId)
        return job
      }

      const now = new Date()
      const cancelRequestedAt = job.cancelRequestedAt ?? now
      const cancelledByUserId = job.cancelledByUserId ?? ctx.userId ?? null
      const finishedAt = job.finishedAt ?? now

      // Flush the throttled entry the way completeJob and failJob do. Without this a producer
      // that writes its partial result through updateProgress immediately before cancelling
      // loses it whenever that write landed inside the persistence throttle window, because
      // forgetJobThrottle below discards the only copy that ever existed.
      const entry = jobUpdateThrottle.get(jobId)
      const snapshot = entry?.job
      const affected = await em.nativeUpdate(ProgressJob, {
        ...jobScopeFilter(jobId, ctx),
        status: { $in: CANCEL_FROM_STATUSES as ProgressJobStatus[] },
      } as FilterQuery<ProgressJob>, {
        status: 'cancelled',
        cancelRequestedAt,
        cancelledByUserId,
        finishedAt,
        etaSeconds: 0,
        updatedAt: now,
        ...(entry && snapshot
          ? {
              totalCount: snapshot.totalCount ?? null,
              meta: snapshot.meta ?? null,
              ...buildBufferedCountData(entry),
            }
          : {}),
      })
      forgetJobThrottle(jobId)

      if (affected === 0) {
        const fresh = await loadFreshJob(jobId, ctx)
        return fresh ?? job
      }

      job.status = 'cancelled'
      job.cancelRequestedAt = cancelRequestedAt
      job.cancelledByUserId = cancelledByUserId
      job.finishedAt = finishedAt
      job.etaSeconds = 0

      await eventBus.emit(PROGRESS_EVENTS.JOB_CANCELLED, {
        ...buildJobPayload(job),
        tenantId: ctx.tenantId,
        organizationId: job.organizationId ?? null,
      })

      return job
    },

    async isCancellationRequested(jobId, tenantId, organizationId) {
      // disableIdentityMap forces a fresh read: a managed copy of the job in this
      // EntityManager (loaded by updateProgress) must never mask a cancellation
      // requested from another process.
      const job = await findOneWithDecryption(em, ProgressJob, {
        id: jobId,
        tenantId,
        ...(organizationId ? { organizationId } : {}),
      }, { disableIdentityMap: true })
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
        ...(ctx.organizationId ? { organizationId: ctx.organizationId } : {}),
      })
    },

    async markStaleJobsFailed(tenantId: string, timeoutSeconds = STALE_JOB_TIMEOUT_SECONDS, organizationId?: string | null) {
      const now = new Date()
      const cutoff = new Date(now.getTime() - timeoutSeconds * 1000)
      const scope = {
        tenantId,
        ...(organizationId ? { organizationId } : {}),
      }
      let failedCount = 0

      const staleFilter = {
        status: 'running' as ProgressJobStatus,
        $or: [
          { heartbeatAt: { $lt: cutoff } },
          {
            heartbeatAt: null,
            startedAt: { $lt: cutoff },
          },
        ],
      }
      const staleRunning = await em.find(ProgressJob, { ...scope, ...staleFilter }, { disableIdentityMap: true })

      for (const job of staleRunning) {
        const errorMessage = `${STALE_SWEEP_ERROR_PREFIX} no heartbeat for ${timeoutSeconds} seconds`
        // Per-row CAS (re-checking the staleness condition): exactly one concurrent
        // sweeper wins, and a heartbeat that landed after the SELECT aborts the failure.
        const affected = await em.nativeUpdate(ProgressJob, {
          id: job.id,
          tenantId: job.tenantId,
          ...staleFilter,
        } as FilterQuery<ProgressJob>, {
          status: 'failed',
          finishedAt: now,
          errorMessage,
          updatedAt: now,
        })
        if (affected === 0) continue

        failedCount += 1
        job.status = 'failed'
        job.finishedAt = now
        job.errorMessage = errorMessage

        await eventBus.emit(PROGRESS_EVENTS.JOB_FAILED, {
          ...buildJobPayload(job),
          errorMessage: job.errorMessage,
          tenantId: job.tenantId,
          stale: true,
          organizationId: job.organizationId ?? null,
        })
      }

      // Jobs stuck in `pending` (enqueue failed, worker died before startJob) have no
      // heartbeat, so they need their own sweep or they stay in the active list forever.
      // A late queue delivery still recovers such a job: startJob transitions failed → running.
      const pendingCutoff = new Date(now.getTime() - STALE_PENDING_TIMEOUT_SECONDS * 1000)
      const stalePendingFilter = {
        status: 'pending' as ProgressJobStatus,
        createdAt: { $lt: pendingCutoff },
      }
      const stalePending = await em.find(ProgressJob, { ...scope, ...stalePendingFilter }, { disableIdentityMap: true })

      for (const job of stalePending) {
        const errorMessage = `${STALE_SWEEP_ERROR_PREFIX} never started within ${STALE_PENDING_TIMEOUT_SECONDS} seconds`
        const affected = await em.nativeUpdate(ProgressJob, {
          id: job.id,
          tenantId: job.tenantId,
          ...stalePendingFilter,
        } as FilterQuery<ProgressJob>, {
          status: 'failed',
          finishedAt: now,
          errorMessage,
          updatedAt: now,
        })
        if (affected === 0) continue

        failedCount += 1
        job.status = 'failed'
        job.finishedAt = now
        job.errorMessage = errorMessage

        await eventBus.emit(PROGRESS_EVENTS.JOB_FAILED, {
          ...buildJobPayload(job),
          errorMessage: job.errorMessage,
          tenantId: job.tenantId,
          stale: true,
          organizationId: job.organizationId ?? null,
        })
      }

      return failedCount
    },
  }
}
