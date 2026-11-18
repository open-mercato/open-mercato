import type { AwilixContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { ProgressJob } from '@open-mercato/core/modules/progress/data/entities'
import { HEARTBEAT_INTERVAL_MS, type ProgressService, type ProgressServiceContext } from '@open-mercato/core/modules/progress/lib/progressService'
import { Booking, Unavailability } from '../data/entities'
import { windowOf } from './availabilityResolver'
import { findClosureBookings, findSubjectUnits } from './unavailabilityImpact'
import { buildTrustedSalesContext } from './salesCommandContext'
import { UNAVAILABILITY_APPLY_QUEUE } from './queues'
import { localNow } from './wallClock'
import type { Scope } from './productUse'

const logger = createLogger('property_management')

export { UNAVAILABILITY_APPLY_QUEUE }
export const UNAVAILABILITY_APPLY_CHUNK = 100
export const UNAVAILABILITY_APPLY_JOB_TYPE = 'property_management.unavailabilities.apply'
export const UNAVAILABILITY_APPLY_MAX_ATTEMPTS = 3
const STALE_APPLY_MINUTES = 15
export const RESUME_APPLY_BATCH = 500
const TERMINAL_PROGRESS_STATUSES: ReadonlySet<string> = new Set(['completed', 'cancelled'])
export const INLINE_CANCELLED_META_KEY = 'inlineCancelled'

export type UnavailabilityApplyJob = {
  unavailabilityId: string
  progressJobId?: string | null
  userId?: string | null
}

export type LegacyUnavailabilityApplyJob = UnavailabilityApplyJob & {
  scope?: { tenantId?: string; organizationId?: string; userId?: string | null }
}

export type UnavailabilityApplyAttempt = { attemptNumber: number; maxAttempts: number }

export type UnavailabilityApplyDeps = { container: AwilixContainer; em: EntityManager; attempt?: UnavailabilityApplyAttempt }

export type UnavailabilityApplySummary = { cancelled: number; skipped: number }

let queue: Queue<UnavailabilityApplyJob> | null = null

export function unavailabilityApplyCoalesceKey(job: UnavailabilityApplyJob): string {
  return `unavailability:${job.unavailabilityId}`
}

export function getUnavailabilityApplyQueue(): Queue<UnavailabilityApplyJob> {
  if (!queue) {
    queue = createModuleQueue<UnavailabilityApplyJob>(UNAVAILABILITY_APPLY_QUEUE, {
      concurrency: 1,
      attempts: UNAVAILABILITY_APPLY_MAX_ATTEMPTS,
      coalesceBy: unavailabilityApplyCoalesceKey,
    })
  }
  return queue
}

export async function enqueueUnavailabilityApply(job: UnavailabilityApplyJob): Promise<boolean> {
  try {
    await getUnavailabilityApplyQueue().enqueue(job)
    return true
  } catch (err) {
    logger.error('Enqueueing an unavailability apply job failed; the booking sweep resumes it', { unavailabilityId: job.unavailabilityId, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.unavailability_enqueue_failed' })
    return false
  }
}

export function resolveProgressService(container: AwilixContainer): ProgressService | null {
  try {
    return container.resolve('progressService') as ProgressService
  } catch {
    return null
  }
}

async function loadRow(em: EntityManager, scope: Scope, id: string): Promise<Unavailability | null> {
  return findOneWithDecryption(em.fork(), Unavailability, { id, ...scope, deletedAt: null }, { refresh: true }, scope)
}

type ChunkRecord = { finished: boolean; progressJobId: string | null }

async function recordChunk(em: EntityManager, scope: Scope, id: string, record: ChunkRecord): Promise<number | null> {
  return em.fork().transactional(async (trx) => {
    const row = await findOneWithDecryption(trx, Unavailability, { id, ...scope }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }, scope)
    if (!row) return null
    const cancelledBookingCount = await trx.count(Booking, { ...scope, unavailabilityId: row.id, cancelReason: 'unavailability', status: 'cancelled' })
    const progress: Partial<Pick<Unavailability, 'cancelledBookingCount' | 'applyStatus' | 'applyHeartbeatAt' | 'progressJobId'>> = {
      cancelledBookingCount,
      applyHeartbeatAt: new Date(),
    }
    if (record.finished) progress.applyStatus = 'applied'
    if (record.progressJobId && !row.progressJobId) progress.progressJobId = record.progressJobId
    await trx.nativeUpdate(Unavailability, { id: row.id, ...scope }, progress)
    return progress.cancelledBookingCount ?? null
  })
}

function errorCodeOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const code = (body as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

function isConfigurationError(body: unknown): boolean {
  return errorCodeOf(body) === 'cancelled_status_missing'
}

async function cancelChunk(
  deps: UnavailabilityApplyDeps,
  scope: Scope,
  row: Unavailability,
  bookingIds: readonly string[],
  skipped: string[],
  heartbeat: () => Promise<void>,
  progressJobId: string | null,
): Promise<{ cancelled: number; persisted: number | null }> {
  const commandBus = deps.container.resolve('commandBus') as CommandBus
  const ctx = buildTrustedSalesContext(deps.container, scope)
  let cancelled = 0
  let failure: unknown = null
  for (const id of bookingIds) {
    const input = { id, reason: 'unavailability' as const, unavailabilityId: row.id, ...scope }
    try {
      await commandBus.execute('property_management.booking.cancel', { input, ctx })
      cancelled += 1
    } catch (err) {
      if (isCrudHttpError(err) && err.status < 500 && !isConfigurationError(err.body)) {
        logger.warn('Skipping a booking the unavailability could not cancel', {
          unavailabilityId: row.id,
          bookingId: id,
          code: errorCodeOf(err.body),
          status: err.status,
        })
        skipped.push(id)
        await heartbeat()
        continue
      }
      failure = err
      break
    }
    await heartbeat()
  }
  const persisted = await recordChunk(deps.em, scope, row.id, { finished: false, progressJobId })
  if (failure) throw failure
  return { cancelled, persisted }
}

function queuedProcessedCount(persisted: number | null, inlineCancelled: number, skipped: number): number {
  return Math.max(0, (persisted ?? inlineCancelled) - inlineCancelled) + skipped
}

function capProcessed(processed: number, total: number | null): number {
  return total === null ? processed : Math.min(processed, total)
}

function totalCountOf(job: Pick<ProgressJob, 'totalCount'>): number | null {
  const value = job.totalCount
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function inlineCancelledOf(meta: Record<string, unknown> | null | undefined): number {
  const value = meta?.[INLINE_CANCELLED_META_KEY]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function throttledJobHeartbeat(progress: ProgressService | null, jobId: string | null, ctx: ProgressServiceContext): () => Promise<void> {
  let lastTouchedAt = 0
  return async () => {
    if (!progress?.touchJobHeartbeat || !jobId) return
    const now = Date.now()
    if (now - lastTouchedAt < HEARTBEAT_INTERVAL_MS) return
    lastTouchedAt = now
    try {
      await progress.touchJobHeartbeat(jobId, ctx)
    } catch (err) {
      logger.warn('Touching the unavailability progress heartbeat failed', { jobId, err })
      getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.unavailability_heartbeat_failed' })
    }
  }
}

const CANCELLED_STATUS_MISSING_MESSAGE =
  'Bookings could not be cancelled: choose the sales order status used for cancelled bookings in the Property Management settings. Cancelling resumes once it is set.'
const APPLY_FAILED_MESSAGE = 'Cancelling the bookings failed. It is retried automatically.'
const APPLY_FAILED_FINAL_MESSAGE =
  'Cancelling the bookings failed and will not be retried right away. The booking sweep tries again within half an hour while the unavailability is still applying.'
const SETTLED_COMPLETE_FAILED_MESSAGE = 'The bookings were handled, but closing this progress entry failed.'

export type ApplyFailureOptions = { willRetry?: boolean; settled?: boolean }

export function willRetryApply(attempt: UnavailabilityApplyAttempt | undefined): boolean {
  return !attempt || attempt.attemptNumber < attempt.maxAttempts
}

function failureMessageOf(err: unknown, willRetry: boolean, settled: boolean): { key: string; fallback: string } {
  if (settled) return { key: 'property_management.availability.progress.settledCompleteFailed', fallback: SETTLED_COMPLETE_FAILED_MESSAGE }
  if (isCrudHttpError(err) && isConfigurationError(err.body)) {
    return { key: 'property_management.availability.progress.cancelledStatusMissing', fallback: CANCELLED_STATUS_MISSING_MESSAGE }
  }
  return willRetry
    ? { key: 'property_management.availability.progress.failed', fallback: APPLY_FAILED_MESSAGE }
    : { key: 'property_management.availability.progress.failedFinal', fallback: APPLY_FAILED_FINAL_MESSAGE }
}

export async function applyFailureMessage(err: unknown, options: ApplyFailureOptions = {}): Promise<string> {
  const message = failureMessageOf(err, options.willRetry ?? true, options.settled ?? false)
  try {
    const { translate } = await resolveTranslations()
    return translate(message.key, message.fallback)
  } catch (translationError) {
    logger.warn('Translating the unavailability failure message failed', { err: translationError })
    getTelemetryRuntime()?.reportError(translationError, { module: 'property_management', code: 'property_management.unavailability_failure_message_failed' })
    return message.fallback
  }
}

async function forgetDeadProgressJob(em: EntityManager, scope: Scope, unavailabilityId: string, progressJobId: string): Promise<void> {
  try {
    await em.fork().nativeUpdate(Unavailability, { id: unavailabilityId, ...scope, progressJobId }, { progressJobId: null })
  } catch (err) {
    logger.error('Clearing the gone unavailability progress job failed', { unavailabilityId, progressJobId, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.unavailability_progress_clear_failed' })
  }
}

async function startTrackedProgressJob(
  deps: UnavailabilityApplyDeps,
  scope: Scope,
  job: UnavailabilityApplyJob,
  progress: ProgressService | null,
  ctx: ProgressServiceContext,
): Promise<{ progress: ProgressService; job: ProgressJob } | null> {
  const progressJobId = job.progressJobId ?? null
  if (!progress || !progressJobId) return null
  let tracked: ProgressJob | null
  try {
    tracked = await progress.getJob(progressJobId, ctx)
  } catch (err) {
    reportProgressFailure('Reading the unavailability progress job failed; cancelling continues without progress', progressJobId, err, 'property_management.unavailability_progress_read_failed')
    return null
  }
  if (!tracked) {
    logger.warn('The unavailability progress job is gone; cancelling continues without progress', { progressJobId })
    await forgetDeadProgressJob(deps.em, scope, job.unavailabilityId, progressJobId)
    return null
  }
  try {
    await progress.startJob(progressJobId, ctx)
  } catch (err) {
    reportProgressFailure('Starting the unavailability progress job failed; cancelling continues', progressJobId, err, 'property_management.unavailability_progress_start_failed')
  }
  return { progress, job: tracked }
}

function reportProgressFailure(message: string, progressJobId: string, err: unknown, code: string): void {
  logger.error(message, { progressJobId, err })
  getTelemetryRuntime()?.reportError(err, { module: 'property_management', code })
}

async function updateApplyProgress(
  progress: ProgressService,
  progressJobId: string,
  update: { totalCount?: number; processedCount: number },
  ctx: ProgressServiceContext,
): Promise<void> {
  try {
    await progress.updateProgress(progressJobId, update, ctx)
  } catch (err) {
    reportProgressFailure('Updating the unavailability progress job failed; cancelling continues', progressJobId, err, 'property_management.unavailability_progress_update_failed')
  }
}

async function completeApplyProgress(
  progress: ProgressService,
  progressJobId: string,
  resultSummary: UnavailabilityApplySummary,
  ctx: ProgressServiceContext,
): Promise<void> {
  try {
    await progress.completeJob(progressJobId, { resultSummary }, ctx)
  } catch (err) {
    reportProgressFailure('Completing the unavailability progress job failed', progressJobId, err, 'property_management.unavailability_progress_complete_failed')
    await failApplyProgressJob(progress, progressJobId, await applyFailureMessage(err, { settled: true }), ctx)
  }
}

async function loadAnyRow(em: EntityManager, scope: Scope, id: string): Promise<Unavailability | null> {
  return findOneWithDecryption(em.fork(), Unavailability, { id, ...scope }, { refresh: true }, scope)
}

function isSettled(row: Unavailability | null): boolean {
  return !row || Boolean(row.deletedAt) || row.applyStatus === 'applied'
}

function queuedCancelledCount(persisted: number | null, inlineCancelled: number, fallback: number): number {
  return persisted === null ? fallback : Math.max(0, persisted - inlineCancelled)
}

async function completeSettledProgressJob(
  progress: ProgressService | null,
  row: Unavailability | null,
  progressJobId: string | null,
  ctx: ProgressServiceContext,
): Promise<void> {
  if (!progress || !progressJobId) return
  try {
    const tracked = await progress.getJob(progressJobId, ctx)
    if (!tracked || TERMINAL_PROGRESS_STATUSES.has(tracked.status)) return
    const cancelled = queuedCancelledCount(row?.cancelledBookingCount ?? null, inlineCancelledOf(tracked.meta), 0)
    await progress.completeJob(progressJobId, { resultSummary: { cancelled, skipped: 0 } }, ctx)
  } catch (err) {
    logger.error('Completing the progress job of a settled unavailability failed', { progressJobId, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.unavailability_progress_complete_failed' })
    throw err
  }
}

async function failApplyProgressJob(progress: ProgressService, progressJobId: string, errorMessage: string, ctx: ProgressServiceContext): Promise<void> {
  try {
    const current = await progress.getJob(progressJobId, ctx)
    if (!current || TERMINAL_PROGRESS_STATUSES.has(current.status)) return
    if (current.status === 'failed') {
      if (current.errorMessage === errorMessage) return
      await progress.startJob(progressJobId, ctx)
    }
    await progress.failJob(progressJobId, { errorMessage }, ctx)
  } catch (failure) {
    logger.error('Failing the unavailability progress job failed', { progressJobId, err: failure })
    getTelemetryRuntime()?.reportError(failure, { module: 'property_management', code: 'property_management.unavailability_progress_fail_failed' })
  }
}

async function resolveRowScope(em: EntityManager, id: string): Promise<Scope | null> {
  const row = await findOneWithDecryption(em.fork(), Unavailability, { id }, { fields: ['id', 'tenantId', 'organizationId'] })
  return row ? { tenantId: row.tenantId, organizationId: row.organizationId } : null
}

export async function runUnavailabilityApply(deps: UnavailabilityApplyDeps, job: LegacyUnavailabilityApplyJob): Promise<UnavailabilityApplySummary> {
  const scope = await resolveRowScope(deps.em, job.unavailabilityId)
  if (!scope) {
    logger.warn('Skipping an apply delivery for an unavailability that no longer exists', { unavailabilityId: job.unavailabilityId })
    return { cancelled: 0, skipped: 0 }
  }
  const progressCtx: ProgressServiceContext = { ...scope, userId: job.userId ?? job.scope?.userId ?? null }
  const progressJobId = job.progressJobId ?? null
  let progress: ProgressService | null = progressJobId ? resolveProgressService(deps.container) : null
  let settled = false
  try {
    const current = await loadAnyRow(deps.em, scope, job.unavailabilityId)
    if (isSettled(current)) {
      logger.info('Skipping an apply delivery for an unavailability that is already settled', { unavailabilityId: job.unavailabilityId })
      settled = true
      await completeSettledProgressJob(progress, current, progressJobId, progressCtx)
      return { cancelled: 0, skipped: 0 }
    }
    const tracked = await startTrackedProgressJob(deps, scope, job, progress, progressCtx)
    progress = tracked?.progress ?? null
    const trackedJobId = tracked ? progressJobId : null
    const heartbeat = throttledJobHeartbeat(progress, progressJobId, progressCtx)
    let cancelled = 0
    const skipped: string[] = []
    let total = tracked ? totalCountOf(tracked.job) : null
    const inlineCancelled = inlineCancelledOf(tracked?.job.meta)
    let reported = capProcessed(tracked?.job.processedCount ?? 0, total)
    let row: Unavailability | null = current
    while (row) {
      const window = windowOf(row)
      if (!window || !window.start) break
      const units = await findSubjectUnits(deps.em.fork(), scope, { type: row.subjectType, id: row.subjectId })
      const unitIds = units.map((unit) => unit.id)
      const chunk = await findClosureBookings(deps.em.fork(), scope, unitIds, { start: window.start, end: window.end }, localNow(row.createdAt), {
        limit: UNAVAILABILITY_APPLY_CHUNK,
        excludeIds: skipped,
      })
      if (!chunk.length) break
      const done = await cancelChunk(deps, scope, row, chunk.map((booking) => booking.id), skipped, heartbeat, trackedJobId)
      cancelled += done.cancelled
      if (progress && progressJobId) {
        const processed = queuedProcessedCount(done.persisted, inlineCancelled, skipped.length)
        const raisedTotal = total !== null && processed > total ? processed : null
        if (raisedTotal !== null) total = raisedTotal
        reported = Math.max(reported, capProcessed(processed, total))
        const update = raisedTotal !== null ? { totalCount: raisedTotal, processedCount: reported } : { processedCount: reported }
        await updateApplyProgress(progress, progressJobId, update, progressCtx)
      }
      row = await loadRow(deps.em, scope, row.id)
    }
    const persisted = await recordChunk(deps.em, scope, job.unavailabilityId, { finished: true, progressJobId: trackedJobId })
    if (progress && progressJobId) {
      const resultSummary = { cancelled: queuedCancelledCount(persisted, inlineCancelled, cancelled), skipped: skipped.length }
      await completeApplyProgress(progress, progressJobId, resultSummary, progressCtx)
    }
    return { cancelled, skipped: skipped.length }
  } catch (err) {
    if (progress && progressJobId) {
      const errorMessage = await applyFailureMessage(err, { willRetry: willRetryApply(deps.attempt), settled })
      await failApplyProgressJob(progress, progressJobId, errorMessage, progressCtx)
    }
    throw err
  }
}

export async function resumeApplyingUnavailabilities(
  em: EntityManager,
  scope: Scope,
  enqueue: (job: UnavailabilityApplyJob) => Promise<unknown> = enqueueUnavailabilityApply,
): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_APPLY_MINUTES * 60 * 1000)
  const rows = await findWithDecryption(
    em.fork(),
    Unavailability,
    {
      ...scope,
      applyStatus: 'applying',
      deletedAt: null,
      $or: [{ applyHeartbeatAt: { $lt: staleBefore } }, { applyHeartbeatAt: null, updatedAt: { $lt: staleBefore } }],
    },
    { fields: ['id', 'progressJobId'], orderBy: { createdAt: 'asc', id: 'asc' }, limit: RESUME_APPLY_BATCH },
    scope,
  )
  if (rows.length >= RESUME_APPLY_BATCH) {
    logger.warn('More unavailabilities are stale while applying than the sweep resumes at once; the rest resume on the next run', {
      limit: RESUME_APPLY_BATCH,
      organizationId: scope.organizationId,
    })
  }
  for (const row of rows) await enqueue({ unavailabilityId: row.id, progressJobId: row.progressJobId ?? null })
  if (rows.length) logger.info('Resumed unavailabilities still applying', { count: rows.length })
  return rows.length
}
