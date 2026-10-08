import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type { ProgressService, ProgressServiceContext } from '@open-mercato/core/modules/progress/lib/progressService'
import { getProcessRegistry, type ProcessRegistrySnapshot } from '../process/registry'
import { describeXrayError } from './errors'
import {
  XRAY_KEY_MISMATCH_ERROR,
  XRAY_LEASE_MS,
  XRAY_PRUNE_BATCH,
  XRAY_SETTLE_MS,
  runIngestSlice,
  runScanSlice,
  shiftIso,
  type XraySliceResult,
} from './ingest'
import { isXrayIngestEnabled } from './killSwitch'
import { createActorPseudonymizer } from './pseudonym'
import {
  XRAY_BACKFILL_JOB_TYPE,
  enqueueXrayBackfill,
  enqueueXrayIngest,
  ensureXrayIngestSchedule,
  type XrayBackfillJobPayload,
} from './queue'
import {
  createLeaseOwner,
  createServiceResolver,
  createXrayIngestDeps,
  createXrayStore,
  type XrayContainer,
} from './runtime'
import { loadXraySettings, type XraySettingsSnapshot } from './settings'
import type { ProjectionCounts, ProjectionCursor, ProjectionStore } from './store'
import type { ProjectionScope } from './types'

const logger = createLogger('insights').child({ component: 'xray-jobs' })

const DAY_MS = 24 * 60 * 60_000
const LEASE_BUSY_RETRY_MS = 5000
const LEASE_LOST_RETRY_MS = 1000
const CLEAR_BATCH = 5000
const XRAY_ABANDONED_ERROR = '[internal] The queue abandoned the X-Ray backfill job after its retries'

export type XrayUnavailableReason = 'no_processes' | 'disabled' | 'rebuild_required' | 'lease_busy'

export type XrayIngestJobResult = XraySliceResult | { status: 'disabled' | 'no_processes' }

export type XrayBackfillStart =
  | { ok: true; scanId: string; chainId: string; progressJobId: string | null; scheduleRegistered: boolean }
  | { ok: false; reason: XrayUnavailableReason }

export type XrayStatus = {
  scope: ProjectionScope
  ingestEnabled: boolean
  settings: XraySettingsSnapshot
  registry: { ready: boolean; contractHash: string; processes: Array<{ processKey: string; labelKey: string; moduleId: string }>; rejected: number }
  cursor: ProjectionCursor | null
  counts: ProjectionCounts[]
}

export class XrayErasureIncompleteError extends Error {
  constructor() {
    super('[internal] Process X-Ray erasure could not reach organizations written under another pseudonym key')
    this.name = 'XrayErasureIncompleteError'
  }
}

function resolveEm(container: XrayContainer): EntityManager {
  return (container.resolve('em') as EntityManager).fork()
}

function resolveProgress(container: XrayContainer): ProgressService | undefined {
  return createServiceResolver(container)<ProgressService>('progressService')
}

async function safely(action: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run()
  } catch (error) {
    logger.warn('[internal] X-Ray progress update failed', { action, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_progress_failed', attributes: { action } })
  }
}

function hasProcesses(registry: ProcessRegistrySnapshot): boolean {
  return registry.ready && registry.processes.length > 0
}

async function isIngestAllowed(container: XrayContainer, scope: ProjectionScope, em: EntityManager): Promise<{ allowed: boolean; settings: XraySettingsSnapshot }> {
  const settings = await loadXraySettings(em, scope)
  if (!settings.enabled) return { allowed: false, settings }
  const toggled = await isXrayIngestEnabled(createServiceResolver(container), scope.tenantId)
  return { allowed: toggled, settings }
}

async function recordCursorError(store: ProjectionStore, scope: ProjectionScope, error: unknown): Promise<void> {
  try {
    const cursor = await store.readCursor(scope)
    if (cursor) await store.recordError(cursor, describeXrayError(error))
  } catch (recordFailure) {
    logger.warn('[internal] Could not record the X-Ray ingest error', { err: recordFailure })
    getTelemetryRuntime()?.reportError(recordFailure, { module: 'insights', code: 'insights.xray_error_record_failed' })
  }
}

function reportUndecryptable(scope: ProjectionScope, result: XraySliceResult): void {
  if (result.undecryptable <= 0) return
  logger.warn('[internal] X-Ray skipped audit rows whose encrypted columns could not be opened', {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    rows: result.undecryptable,
  })
}

/**
 * The scheduled ingest tick of one organization. Skips silently when no process is
 * declared, the kill switch is off or the organization disabled X-Ray. Enqueues the range
 * scan it started or the chain it handed a stalled scan to, and a follow-up tick when the
 * budget ran out.
 */
export async function runXrayIngestJob(container: XrayContainer, scope: ProjectionScope): Promise<XrayIngestJobResult> {
  const registry = getProcessRegistry()
  if (!hasProcesses(registry)) return { status: 'no_processes' }
  const em = resolveEm(container)
  const gate = await isIngestAllowed(container, scope, em)
  if (!gate.allowed) return { status: 'disabled' }
  const store = createXrayStore(em)
  let result: XraySliceResult
  try {
    const { deps } = await createXrayIngestDeps(container, scope, registry)
    result = await runIngestSlice(deps, scope, { retentionDays: gate.settings.retentionDays })
  } catch (error) {
    await recordCursorError(store, scope, error)
    throw error
  }
  reportUndecryptable(scope, result)
  if (result.scanStarted) {
    await enqueueXrayBackfill({ scope, scanId: result.scanStarted.scanId, chainId: result.scanStarted.chainId, progressJobId: null })
  }
  if (result.scanResumed) {
    await enqueueXrayBackfill({
      scope,
      scanId: result.scanResumed.scanId,
      chainId: result.scanResumed.chainId,
      progressJobId: result.scanResumed.progressJobId,
    })
  }
  if (result.status === 'budget_exhausted') await enqueueXrayIngest(scope)
  return result
}

/**
 * Starts (or restarts) a full backfill of the organization's retention window as a resumable
 * range scan tracked by a ProgressJob, and makes sure the ingest schedule exists. A previous
 * scan of the organization is superseded and its progress job cancelled. The backfill reads up
 * to the current time (no settle lag): rows committed later are caught by incremental ingest.
 */
export async function startXrayBackfill(
  container: XrayContainer,
  scope: ProjectionScope,
  options: { userId: string | null; name: string; description: string; enqueue?: boolean },
): Promise<XrayBackfillStart> {
  const registry = getProcessRegistry()
  if (!hasProcesses(registry)) return { ok: false, reason: 'no_processes' }
  const em = resolveEm(container)
  const gate = await isIngestAllowed(container, scope, em)
  if (!gate.allowed) return { ok: false, reason: 'disabled' }
  const store = createXrayStore(em)
  const cursor = await store.ensureCursor(scope, registry.contractHash, XRAY_SETTLE_MS)
  if (cursor.contractHash !== registry.contractHash) {
    if (cursor.status !== 'rebuild_required') await store.markRebuildRequired(cursor)
    return { ok: false, reason: 'rebuild_required' }
  }
  if (cursor.status === 'rebuild_required') return { ok: false, reason: 'rebuild_required' }
  const dbNow = await store.now()
  const scanId = randomUUID()
  const chainId = randomUUID()
  const progress = resolveProgress(container)
  const progressContext: ProgressServiceContext = { tenantId: scope.tenantId, organizationId: scope.organizationId, userId: options.userId }
  const progressJob = progress
    ? await progress.createJob({
      jobType: XRAY_BACKFILL_JOB_TYPE,
      name: options.name,
      description: options.description,
      cancellable: true,
      meta: { scanId, organizationId: scope.organizationId },
    }, progressContext)
    : null
  try {
    await store.startScan(cursor, {
      scanId,
      chainId,
      kind: 'backfill',
      from: shiftIso(dbNow, -Math.max(1, gate.settings.retentionDays) * DAY_MS),
      until: dbNow,
      progressJobId: progressJob?.id ?? null,
    })
  } catch (error) {
    if (progress && progressJob) {
      const createdJobId = progressJob.id
      await safely('fail_job', () => progress.failJob(createdJobId, { errorMessage: describeXrayError(error) }, progressContext))
    }
    throw error
  }
  if (progress && cursor.scanProgressJobId && cursor.scanProgressJobId !== progressJob?.id) {
    const previousJobId = cursor.scanProgressJobId
    await safely('cancel_superseded', () => progress.markCancelled(previousJobId, progressContext))
  }
  const scheduleRegistered = await ensureXrayIngestSchedule(container, scope)
  if (options.enqueue !== false) {
    await enqueueXrayBackfill({
      scope: { tenantId: scope.tenantId, organizationId: scope.organizationId, userId: options.userId },
      scanId,
      chainId,
      progressJobId: progressJob?.id ?? null,
    })
  }
  return { ok: true, scanId, chainId, progressJobId: progressJob?.id ?? null, scheduleRegistered }
}

function progressPercent(result: XraySliceResult): number | undefined {
  const progress = result.scanProgress
  if (!progress?.from || !progress.until || !progress.position) return undefined
  const from = Date.parse(progress.from)
  const until = Date.parse(progress.until)
  const position = Date.parse(progress.position)
  if (!(until > from)) return undefined
  return Math.min(99, Math.max(0, Math.floor(((position - from) / (until - from)) * 100)))
}

async function endScan(
  store: ProjectionStore,
  progress: ProgressService | undefined,
  payload: XrayBackfillJobPayload,
  progressContext: ProgressServiceContext,
  reason: string,
  outcome: 'failed' | 'cancelled',
): Promise<void> {
  const scope = { tenantId: payload.scope.tenantId, organizationId: payload.scope.organizationId }
  await store.abandonScan(scope, payload.scanId, payload.chainId, reason)
  if (!progress || !payload.progressJobId) return
  const jobId = payload.progressJobId
  if (outcome === 'cancelled') {
    await safely('mark_cancelled', () => progress.markCancelled(jobId, progressContext))
  } else {
    await safely('fail_job', () => progress.failJob(jobId, { errorMessage: reason }, progressContext))
  }
}

async function cancelIfSuperseded(
  store: ProjectionStore,
  progress: ProgressService | undefined,
  payload: XrayBackfillJobPayload,
  progressContext: ProgressServiceContext,
): Promise<void> {
  const jobId = payload.progressJobId
  if (!progress || !jobId) return
  const cursor = await store.readCursor({ tenantId: payload.scope.tenantId, organizationId: payload.scope.organizationId })
  if (cursor?.scanProgressJobId !== jobId) await safely('mark_cancelled', () => progress.markCancelled(jobId, progressContext))
}

/**
 * One slice of a range scan job: drops a job of a replaced scan or chain, checks
 * cancellation, runs `runScanSlice` and either finishes the ProgressJob or enqueues the
 * continuation (unless `enqueueContinuation` is false, for callers that drive the slices
 * themselves). Failures fail the progress job and rethrow so the queue retries from the
 * persisted scan position (a retry revives the job).
 */
export async function runXrayBackfillJob(
  container: XrayContainer,
  payload: XrayBackfillJobPayload,
  options: { enqueueContinuation?: boolean } = {},
): Promise<XraySliceResult['status'] | 'disabled' | 'cancelled'> {
  const enqueueContinuation = options.enqueueContinuation !== false
  const scope = { tenantId: payload.scope.tenantId, organizationId: payload.scope.organizationId }
  const progress = resolveProgress(container)
  const progressContext: ProgressServiceContext = { ...scope, userId: payload.scope.userId ?? null }
  const em = resolveEm(container)
  const store = createXrayStore(em)
  const current = await store.readCursor(scope)
  if (!current || current.scanId !== payload.scanId) {
    await cancelIfSuperseded(store, progress, payload, progressContext)
    return 'superseded'
  }
  if (current.scanChainId !== payload.chainId) return 'stale_chain'
  const registry = getProcessRegistry()
  if (!hasProcesses(registry)) {
    await endScan(store, progress, payload, progressContext, '[internal] No Process X-Ray declarations are registered', 'failed')
    return 'no_processes'
  }
  const gate = await isIngestAllowed(container, scope, em)
  if (!gate.allowed) {
    await endScan(store, progress, payload, progressContext, '[internal] Process X-Ray ingest is disabled', 'cancelled')
    return 'disabled'
  }
  if (progress && payload.progressJobId) {
    const cancelled = await progress.isCancellationRequested(payload.progressJobId, scope.tenantId, scope.organizationId)
    if (cancelled) {
      await endScan(store, progress, payload, progressContext, '[internal] Cancelled', 'cancelled')
      return 'cancelled'
    }
    const jobId = payload.progressJobId
    await safely('start_job', () => progress.startJob(jobId, progressContext))
  }
  let result: XraySliceResult
  try {
    const { deps } = await createXrayIngestDeps(container, scope, registry)
    result = await runScanSlice(deps, scope, payload.scanId, payload.chainId)
  } catch (error) {
    await recordCursorError(store, scope, error)
    if (progress && payload.progressJobId) {
      const jobId = payload.progressJobId
      await safely('fail_job', () => progress.failJob(jobId, { errorMessage: describeXrayError(error) }, progressContext))
    }
    throw error
  }
  reportUndecryptable(scope, result)
  const jobId = payload.progressJobId
  switch (result.status) {
    case 'completed':
      if (progress && jobId) {
        await safely('update_progress', () => progress.updateProgress(jobId, { processedCount: result.scanProgress?.processed ?? 0, progressPercent: 100 }, progressContext))
        await safely('complete_job', () => progress.completeJob(jobId, {
          resultSummary: { processed: result.scanProgress?.processed ?? 0, scanId: payload.scanId },
        }, progressContext))
      }
      return result.status
    case 'budget_exhausted':
    case 'lease_lost':
      if (progress && jobId) {
        const percent = progressPercent(result)
        await safely('update_progress', () => progress.updateProgress(jobId, {
          processedCount: result.scanProgress?.processed ?? 0,
          ...(percent !== undefined ? { progressPercent: percent } : {}),
        }, progressContext))
      }
      if (enqueueContinuation) await enqueueXrayBackfill(payload, result.status === 'lease_lost' ? LEASE_LOST_RETRY_MS : 0)
      return result.status
    case 'lease_busy':
      await store.touchScan(scope, payload.scanId, payload.chainId)
      if (progress && jobId) await safely('heartbeat', async () => progress.touchJobHeartbeat?.(jobId, progressContext))
      if (enqueueContinuation) await enqueueXrayBackfill(payload, LEASE_BUSY_RETRY_MS)
      return result.status
    case 'superseded':
      await cancelIfSuperseded(store, progress, payload, progressContext)
      return result.status
    case 'stale_chain':
      return result.status
    case 'key_mismatch':
      await endScan(store, progress, payload, progressContext, XRAY_KEY_MISMATCH_ERROR, 'failed')
      return result.status
    default:
      await endScan(store, progress, payload, progressContext, `[internal] Process X-Ray backfill stopped: ${result.status}`, 'failed')
      return result.status
  }
}

/**
 * Abandoned-job hook of the backfill worker: clears the scan (if its chain is live) and fails
 * its progress job. The queue's failure text may quote data, so it is only logged.
 */
export async function failAbandonedXrayScan(container: XrayContainer, payload: XrayBackfillJobPayload, reason: string): Promise<void> {
  const em = resolveEm(container)
  const store = createXrayStore(em)
  const progressContext: ProgressServiceContext = {
    tenantId: payload.scope.tenantId,
    organizationId: payload.scope.organizationId,
    userId: payload.scope.userId ?? null,
  }
  const current = await store.readCursor({ tenantId: payload.scope.tenantId, organizationId: payload.scope.organizationId })
  if (!current || current.scanId !== payload.scanId || current.scanChainId !== payload.chainId) return
  logger.warn('[internal] The queue abandoned an X-Ray backfill job', { organizationId: payload.scope.organizationId, scanId: payload.scanId, reason })
  await endScan(store, resolveProgress(container), payload, progressContext, XRAY_ABANDONED_ERROR, 'failed')
}

/**
 * Clears the organization's projection (events, cases, rollups) under its lease, resets the
 * cursor to the current contract and no pseudonym key, and starts a fresh backfill. Used
 * after a contract change (`rebuild_required`) or a permanent pseudonym key change. Refused
 * while ingest is disabled, so a rebuild never leaves an organization empty.
 */
export async function rebuildXrayProjection(
  container: XrayContainer,
  scope: ProjectionScope,
  options: { userId: string | null; name: string; description: string; enqueue?: boolean },
): Promise<XrayBackfillStart> {
  const registry = getProcessRegistry()
  if (!hasProcesses(registry)) return { ok: false, reason: 'no_processes' }
  const em = resolveEm(container)
  const gate = await isIngestAllowed(container, scope, em)
  if (!gate.allowed) return { ok: false, reason: 'disabled' }
  const store = createXrayStore(em)
  const cursor = await store.ensureCursor(scope, registry.contractHash, XRAY_SETTLE_MS)
  const lease = await store.acquireLease(cursor, createLeaseOwner(), XRAY_LEASE_MS)
  if (!lease) return { ok: false, reason: 'lease_busy' }
  try {
    for (const table of ['insights_process_events', 'insights_process_cases', 'insights_process_rollups'] as const) {
      let cleared = 0
      do {
        cleared = await store.clearProjectionBatch(lease, XRAY_LEASE_MS, table, CLEAR_BATCH)
      } while (cleared >= CLEAR_BATCH)
    }
    await store.resetCursor(lease, XRAY_LEASE_MS, registry.contractHash, XRAY_SETTLE_MS)
  } finally {
    await store.releaseLease(lease)
  }
  const progress = resolveProgress(container)
  if (progress && cursor.scanProgressJobId) {
    const previousJobId = cursor.scanProgressJobId
    await safely('cancel_superseded', () => progress.markCancelled(previousJobId, { ...scope, userId: options.userId }))
  }
  return startXrayBackfill(container, scope, options)
}

/** Deletes cases inactive for longer than the retention window, their events and old rollups. */
export async function pruneXrayProjection(
  container: XrayContainer,
  scope: ProjectionScope,
): Promise<{ ok: true; removed: number; cutoff: string | null } | { ok: false; reason: XrayUnavailableReason }> {
  const em = resolveEm(container)
  const store = createXrayStore(em)
  const cursor = await store.readCursor(scope)
  if (!cursor) return { ok: true, removed: 0, cutoff: null }
  const settings = await loadXraySettings(em, scope)
  const lease = await store.acquireLease(cursor, createLeaseOwner(), XRAY_LEASE_MS)
  if (!lease) return { ok: false, reason: 'lease_busy' }
  let removed = 0
  const cutoff = shiftIso(await store.now(), -Math.max(1, settings.retentionDays) * DAY_MS)
  try {
    for (const table of ['insights_process_events', 'insights_process_cases', 'insights_process_rollups'] as const) {
      let batch = 0
      do {
        batch = await store.pruneProjectionBatch(lease, XRAY_LEASE_MS, table, cutoff, XRAY_PRUNE_BATCH)
        removed += batch
      } while (batch >= XRAY_PRUNE_BATCH)
    }
    await store.updateCursor(lease, XRAY_LEASE_MS, { last_pruned_at: new Date() })
  } finally {
    await store.releaseLease(lease)
  }
  return { ok: true, removed, cutoff }
}

export async function readXrayStatus(container: XrayContainer, scope: ProjectionScope): Promise<XrayStatus> {
  const registry = getProcessRegistry()
  const em = resolveEm(container)
  const store = createXrayStore(em)
  const [cursor, counts, settings, ingestEnabled] = await Promise.all([
    store.readCursor(scope),
    store.counts(scope),
    loadXraySettings(em, scope),
    isXrayIngestEnabled(createServiceResolver(container), scope.tenantId),
  ])
  return {
    scope,
    ingestEnabled,
    settings,
    registry: {
      ready: registry.ready,
      contractHash: registry.contractHash,
      processes: registry.processes.map((process) => ({ processKey: process.processKey, labelKey: process.labelKey, moduleId: process.moduleId })),
      rejected: registry.rejected.length,
    },
    cursor,
    counts,
  }
}

function userValueFields(registry: ProcessRegistrySnapshot): Array<{ processKey: string; field: string }> {
  return registry.processes.flatMap((process) => process.followupFields
    .filter((field) => field.valueKind === 'user')
    .map((field) => ({ processKey: process.processKey, field: field.key })))
}

/**
 * GDPR erasure of one user in one tenant. Records the user in the erasure ledger first (so
 * every later projection write replaces the user's pseudonym, whatever key is in use), then
 * gives every already projected event of the user one fresh random pseudonym
 * (`erased:<uuid>`), keeping process statistics while unlinking the rows from the user.
 * Throws — so the persistent subscriber retries — when the pseudonym key is unavailable or
 * an organization's rows were written under another key. Returns the rows changed.
 */
export async function eraseXrayActor(container: XrayContainer, tenantId: string, userId: string): Promise<number> {
  const store = createXrayStore(resolveEm(container))
  const replacement = await store.recordErasure(tenantId, userId)
  const resolve = createServiceResolver(container)
  const pseudonymizer = await createActorPseudonymizer(tenantId, resolve<TenantDataEncryptionService>('tenantEncryptionService') ?? null)
  const outcome = await store.replaceActorPseudonym({
    tenantId,
    pseudonym: pseudonymizer.pseudonymize(userId),
    replacement,
    keyFingerprint: pseudonymizer.fingerprint,
    userValueFields: userValueFields(getProcessRegistry()),
  })
  if (outcome.mismatchedOrganizationIds.length > 0) throw new XrayErasureIncompleteError()
  return outcome.updated
}
