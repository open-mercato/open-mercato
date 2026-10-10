import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type { ProgressService, ProgressServiceContext } from '@open-mercato/core/modules/progress/lib/progressService'
import { getProcessRegistry, type ProcessRegistrySnapshot } from '../process/registry'
import { createXrayAnalyticsFromContainer, invalidateXrayAnalytics } from '../analytics/index'
import { readProjectionState, runAnalyticsQuery } from '../analytics/query'
import { isRollupPassDue, listRollupPasses, markRollupPass, pruneStaleRollups } from '../analytics/rollups'
import { isSuggestionPassDue, listSuggestionPasses } from '../suggestions/passes'
import { supersedeProcessSuggestions } from '../suggestions/store'
import { clearSuggestionPass } from '../suggestions/passes'
import { isXrayCursorComplete } from './completeness'
import { describeXrayError } from './errors'
import {
  XRAY_KEY_MISMATCH_ERROR,
  XRAY_LEASE_MS,
  XRAY_PRUNE_BATCH,
  XRAY_PRUNE_INTERVAL_MS,
  XRAY_SETTLE_MS,
  runIngestSlice,
  runScanSlice,
  shiftIso,
  type XraySliceResult,
} from './ingest'
import { isXrayIngestEnabled } from './killSwitch'
import { assertXrayScope, resolveOrganizationTenants } from './payloads'
import { createActorPseudonymizer } from './pseudonym'
import {
  XRAY_BACKFILL_JOB_TYPE,
  XRAY_FANOUT_MAX_BACKLOG,
  XRAY_INGEST_INTERVAL_MS,
  enqueueXrayBackfill,
  enqueueXrayIngest,
  enqueueXrayRollup,
  enqueueXraySuggestionMining,
  ensureXrayIngestSchedule,
  readXrayIngestBacklog,
  readXrayRollupBacklog,
  readXraySuggestionsBacklog,
  type XrayBackfillJobPayload,
} from './queue'
import {
  createLeaseOwner,
  createServiceResolver,
  createXrayDatabase,
  createXrayIngestDeps,
  createXrayStore,
  type XrayContainer,
} from './runtime'
import { listDisabledXrayOrganizations, loadXraySettings, xrayScopeKey, type XraySettingsSnapshot } from './settings'
import {
  CURSOR_PAGE_SIZE,
  ProjectionLeaseLostError,
  type ProjectionCounts,
  type ProjectionCursor,
  type ProjectionLease,
  type ProjectionStore,
} from './store'
import type { ProjectionScope } from './types'

const logger = createLogger('insights').child({ component: 'xray-jobs' })

const DAY_MS = 24 * 60 * 60_000
const LEASE_BUSY_RETRY_MS = 5000
const LEASE_LOST_RETRY_MS = 1000
const CLEAR_BATCH = 5000
const XRAY_ABANDONED_ERROR = '[internal] The queue abandoned the X-Ray backfill job after its retries'
const PROJECTION_TABLES = ['insights_process_events', 'insights_process_cases', 'insights_process_rollups'] as const

/** Mutation-guard resource kind of `POST /api/insights/xray/backfill` (resource id: the organization). */
export const XRAY_BACKFILL_RESOURCE_KIND = 'insights.xray_backfill'

/**
 * Delay before the next slice of a range scan: the lease is free in between, so an incremental
 * ingest of the organization (nudged when it fell behind) takes it instead of waiting for the scan.
 */
export const XRAY_SCAN_CONTINUATION_DELAY_MS = 1500

/** Prune batches (per table, `XRAY_PRUNE_BATCH` rows each) one tick may run while ingest is off. */
export const XRAY_INACTIVE_PRUNE_MAX_BATCHES = 4

export type XrayUnavailableReason = 'no_processes' | 'disabled' | 'lease_busy'

export type XrayIngestJobResult = XraySliceResult | { status: 'disabled' | 'no_processes'; pruned: number }

export type XrayFanoutResult =
  | { status: 'backlogged'; backlog: number }
  | { status: 'done'; enqueued: number; skipped: number; stray: number; rollupsEnqueued: number; suggestionsEnqueued: number }

export type XrayRollupJobResult =
  | { status: 'disabled' | 'no_processes' | 'not_due' | 'incomplete'; pruned: number }
  | { status: 'done'; processes: number; written: number; skipped: number; pruned: number }

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
  /** True when the counts hit their statement timeout (`counts` is then empty). */
  countsTimedOut?: boolean
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

/**
 * Invalidates the organization's analytics (rollup marker + cached results) after its projection
 * changed under them. Never throws: a failure is logged and reported, and stale results then
 * expire on their own (cache TTL, rollup age).
 */
async function invalidateAnalyticsSafely(container: XrayContainer, scope: ProjectionScope, reason: string): Promise<void> {
  try {
    await invalidateXrayAnalytics(container, scope)
  } catch (error) {
    logger.warn('[internal] Could not invalidate the X-Ray analytics of an organization', { organizationId: scope.organizationId, reason, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_analytics_invalidation_failed', attributes: { reason } })
  }
}

/**
 * Marks the organization's open automation suggestions of the cleared processes (all when
 * `null`) as superseded and forgets its last mining pass: their evidence is gone until the
 * projection is rebuilt, and the first tick after that mines again. Never throws: a failure is
 * logged and reported (the next mining pass supersedes them anyway).
 */
async function supersedeSuggestionsSafely(em: EntityManager, scope: ProjectionScope, processKeys: string[] | null, reason: string): Promise<void> {
  try {
    const db = createXrayDatabase(em)
    await supersedeProcessSuggestions(db, scope, processKeys)
    await clearSuggestionPass(db, scope)
  } catch (error) {
    logger.warn('[internal] Could not supersede the X-Ray suggestions of an organization', { organizationId: scope.organizationId, reason, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_suggestions_supersede_failed', attributes: { reason } })
  }
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

/** Whether the daily retention prune of a cursor is due (same rule as the ingest slice). */
export function isXrayPruneDue(lastPrunedAt: string | null, dbNow: string): boolean {
  return !lastPrunedAt || Date.parse(dbNow) - Date.parse(lastPrunedAt) >= XRAY_PRUNE_INTERVAL_MS
}

/**
 * Deletes rows older than the retention cutoff under the lease, table by table, until a batch
 * comes back short or `maxBatches` batches ran. Returns the rows removed and whether every table
 * was pruned completely.
 */
async function pruneUnderLease(
  store: ProjectionStore,
  lease: ProjectionLease,
  cutoff: string,
  maxBatches: number,
): Promise<{ removed: number; complete: boolean }> {
  let removed = 0
  let batches = 0
  for (const table of PROJECTION_TABLES) {
    for (;;) {
      if (batches >= maxBatches) return { removed, complete: false }
      const batch = await store.pruneProjectionBatch(lease, XRAY_LEASE_MS, table, cutoff, XRAY_PRUNE_BATCH)
      removed += batch
      batches += 1
      if (batch < XRAY_PRUNE_BATCH) break
    }
  }
  return { removed, complete: true }
}

/**
 * Retention while ingest is off (organization settings, kill switch) or no process is
 * declared: once a day, a bounded prune under the lease, never an ingest. A prune that ran out of
 * batches leaves `last_pruned_at` untouched, so the next tick continues it.
 */
async function pruneInactiveXrayProjection(store: ProjectionStore, scope: ProjectionScope, retentionDays: number): Promise<number> {
  const cursor = await store.readCursor(scope)
  if (!cursor) return 0
  const dbNow = await store.now()
  if (!isXrayPruneDue(cursor.lastPrunedAt, dbNow)) return 0
  const lease = await store.acquireLease(cursor, createLeaseOwner(), XRAY_LEASE_MS)
  if (!lease) return 0
  try {
    const cutoff = shiftIso(dbNow, -Math.max(1, retentionDays) * DAY_MS)
    const outcome = await pruneUnderLease(store, lease, cutoff, XRAY_INACTIVE_PRUNE_MAX_BATCHES)
    if (outcome.complete) await store.updateCursor(lease, XRAY_LEASE_MS, { last_pruned_at: new Date(Date.parse(dbNow)) })
    return outcome.removed
  } catch (error) {
    if (error instanceof ProjectionLeaseLostError) return 0
    throw error
  } finally {
    await store.releaseLease(lease)
  }
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
 * The ingest job of one organization (enqueued by the system tick). Refuses an organization of
 * another tenant before any write (`XrayScopeMismatchError`). When no process is declared, the
 * kill switch is off or the organization disabled X-Ray, it only runs the daily retention prune
 * (bounded). Otherwise one ingest slice; enqueues the range scan it started or the chain it
 * handed a stalled scan to, and a follow-up job when the budget ran out.
 */
export async function runXrayIngestJob(container: XrayContainer, scope: ProjectionScope): Promise<XrayIngestJobResult> {
  const registry = getProcessRegistry()
  const em = resolveEm(container)
  await assertXrayScope(em, scope)
  const gate = await isIngestAllowed(container, scope, em)
  const store = createXrayStore(em)
  if (!hasProcesses(registry) || !gate.allowed) {
    const pruned = await pruneInactiveXrayProjection(store, scope, gate.settings.retentionDays)
    return { status: hasProcesses(registry) ? 'disabled' : 'no_processes', pruned }
  }
  let result: XraySliceResult
  try {
    const { deps } = await createXrayIngestDeps(container, scope, registry)
    result = await runIngestSlice(deps, scope, { retentionDays: gate.settings.retentionDays })
  } catch (error) {
    await recordCursorError(store, scope, error)
    throw error
  }
  reportUndecryptable(scope, result)
  if (result.voided > 0) await invalidateAnalyticsSafely(container, scope, 'voided')
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
 * The system tick (one job per interval for the whole installation): pages through every
 * organization cursor and enqueues one ingest job per organization. Skips cursors whose
 * organization does not belong to their tenant (stray rows, logged), and organizations whose
 * settings or tenant kill switch disable X-Ray (or every organization when no process is
 * declared) unless their daily retention prune is due. Enabled organizations whose projection is
 * complete (`isXrayCursorComplete`: no backfill, range scan or pending rebuild, so the job is not
 * skipped and re-enqueued every tick) also get a rollup job when their last rollup pass is older
 * than `XRAY_ROLLUP_INTERVAL_MS` (or missing) and an automation suggestion mining job when their
 * last mining pass is older than 24 hours (or missing), each unless its queue already holds
 * `XRAY_FANOUT_MAX_BACKLOG` waiting jobs. The whole tick is skipped while the ingest queue still
 * holds `XRAY_FANOUT_MAX_BACKLOG` waiting jobs, so a backlog never grows by a full round per
 * interval. Organizations get their cursor from tenant setup, organization creation or a backfill.
 */
export async function runXrayIngestFanout(container: XrayContainer): Promise<XrayFanoutResult> {
  const backlog = await readXrayIngestBacklog()
  if (backlog !== null && backlog >= XRAY_FANOUT_MAX_BACKLOG) {
    logger.warn('[internal] X-Ray ingest tick skipped: the ingest queue still holds the previous ticks', { backlog })
    return { status: 'backlogged', backlog }
  }
  const active = hasProcesses(getProcessRegistry())
  const em = resolveEm(container)
  const store = createXrayStore(em)
  const resolve = createServiceResolver(container)
  const toggles = new Map<string, Promise<boolean>>()
  const toggleFor = (tenantId: string): Promise<boolean> => {
    const cached = toggles.get(tenantId)
    if (cached) return cached
    const pending = isXrayIngestEnabled(resolve, tenantId)
    toggles.set(tenantId, pending)
    return pending
  }
  const dbNow = await store.now()
  const rollupBacklog = active ? await readXrayRollupBacklog() : null
  const scheduleRollups = active && (rollupBacklog === null || rollupBacklog < XRAY_FANOUT_MAX_BACKLOG)
  const suggestionsBacklog = active ? await readXraySuggestionsBacklog() : null
  const scheduleSuggestions = active && (suggestionsBacklog === null || suggestionsBacklog < XRAY_FANOUT_MAX_BACKLOG)
  const kysely = createXrayDatabase(em)
  let after: ProjectionScope | null = null
  let enqueued = 0
  let skipped = 0
  let stray = 0
  let rollupsEnqueued = 0
  let suggestionsEnqueued = 0
  for (;;) {
    const page: ProjectionCursor[] = await store.listCursors({ allTenants: true, after, limit: CURSOR_PAGE_SIZE })
    if (page.length === 0) break
    const scopes = page.map((cursor) => ({ tenantId: cursor.tenantId, organizationId: cursor.organizationId }))
    const [tenants, disabled, rollupPasses, suggestionPasses] = await Promise.all([
      resolveOrganizationTenants(em, scopes.map((scope) => scope.organizationId)),
      active ? listDisabledXrayOrganizations(em, scopes) : Promise.resolve(new Set<string>()),
      scheduleRollups ? listRollupPasses(kysely, scopes) : Promise.resolve(new Map<string, string>()),
      scheduleSuggestions ? listSuggestionPasses(kysely, scopes) : Promise.resolve(new Map<string, string>()),
    ])
    for (const [index, cursor] of page.entries()) {
      const scope = scopes[index]
      if (tenants.get(scope.organizationId) !== scope.tenantId) {
        stray += 1
        continue
      }
      const enabled = active && !disabled.has(xrayScopeKey(scope)) && await toggleFor(scope.tenantId)
      const complete = enabled && isXrayCursorComplete(cursor)
      if (complete && scheduleRollups && isRollupPassDue(rollupPasses.get(xrayScopeKey(scope)), dbNow)) {
        await enqueueXrayRollup(scope)
        rollupsEnqueued += 1
      }
      if (complete && scheduleSuggestions && isSuggestionPassDue(suggestionPasses.get(xrayScopeKey(scope)), dbNow)) {
        await enqueueXraySuggestionMining(scope)
        suggestionsEnqueued += 1
      }
      if (!enabled && !isXrayPruneDue(cursor.lastPrunedAt, dbNow)) {
        skipped += 1
        continue
      }
      await enqueueXrayIngest(scope)
      enqueued += 1
    }
    if (page.length < CURSOR_PAGE_SIZE) break
    after = scopes[scopes.length - 1]
  }
  if (stray > 0) {
    logger.warn('[internal] X-Ray ingest tick skipped cursors whose organization does not belong to their tenant', { cursors: stray })
  }
  return { status: 'done', enqueued, skipped, stray, rollupsEnqueued, suggestionsEnqueued }
}

/**
 * One rollup pass of an organization (queue `insights-xray-rollup`, enqueued by the system tick).
 * Refuses an organization of another tenant. Skips an organization whose settings or kill switch
 * disable X-Ray (or when no process is declared), whose last pass is not due yet (a duplicate job
 * finds the fresh pass marker) or whose projection is incomplete (backfill, rebuild or range scan
 * running: such rollups would be served right after it finishes). Otherwise computes the
 * 7/30/90-day rollups in the organization's time zone, prunes rollups of windows that ended and
 * records the pass. Idempotent: rollups are upserted per window and never overwrite newer ones.
 */
export async function runXrayRollupJob(container: XrayContainer, scope: ProjectionScope): Promise<XrayRollupJobResult> {
  const registry = getProcessRegistry()
  const em = resolveEm(container)
  await assertXrayScope(em, scope)
  if (!hasProcesses(registry)) return { status: 'no_processes', pruned: 0 }
  const gate = await isIngestAllowed(container, scope, em)
  if (!gate.allowed) return { status: 'disabled', pruned: 0 }
  const db = createXrayDatabase(em)
  const [passes, dbNow] = await Promise.all([listRollupPasses(db, [scope]), createXrayStore(em).now()])
  if (!isRollupPassDue(passes.get(xrayScopeKey(scope)), dbNow)) return { status: 'not_due', pruned: 0 }
  const pruned = await pruneStaleRollups(db, scope)
  const state = await runAnalyticsQuery(db, (trx) => readProjectionState(trx, { tenantId: scope.tenantId, organizationIds: [scope.organizationId] }))
  if (state.incomplete) return { status: 'incomplete', pruned }
  const pass = await createXrayAnalyticsFromContainer(container).computeRollups(scope, { timeZone: gate.settings.timeZone })
  await markRollupPass(db, scope)
  return { status: 'done', ...pass, pruned }
}

/**
 * Creates the organization's cursor (idempotent) once the organization is verified to belong to
 * the tenant, so the system tick ingests it from now on. Used for new organizations.
 */
export async function ensureXrayCursor(container: XrayContainer, scope: ProjectionScope): Promise<ProjectionCursor> {
  const em = resolveEm(container)
  await assertXrayScope(em, scope)
  return createXrayStore(em).ensureCursor(scope, XRAY_SETTLE_MS)
}

/**
 * Tenant setup: makes sure the system ingest tick exists and creates the cursor of the tenant's
 * organization. Best-effort (setup never fails on X-Ray); failures are logged and reported, and
 * the organization can still be enrolled by a backfill.
 */
export async function seedXrayIngest(container: XrayContainer, scope: ProjectionScope): Promise<void> {
  await ensureXrayIngestSchedule(container)
  try {
    await ensureXrayCursor(container, scope)
  } catch (error) {
    logger.warn('[internal] Could not create the Process X-Ray cursor of the organization', { organizationId: scope.organizationId, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_cursor_seed_failed' })
  }
}

/**
 * Starts (or restarts) a full backfill of the organization's retention window as a resumable
 * range scan tracked by a ProgressJob, creates the organization's cursor (so the system tick
 * ingests it) and makes sure the system tick exists. Refuses an organization of another tenant
 * before any write. A previous scan of the organization is superseded and its progress job
 * cancelled. The backfill reads up to the current time (no settle lag): rows committed later are
 * caught by incremental ingest.
 */
export async function startXrayBackfill(
  container: XrayContainer,
  scope: ProjectionScope,
  options: { userId: string | null; name: string; description: string; enqueue?: boolean },
): Promise<XrayBackfillStart> {
  const registry = getProcessRegistry()
  if (!hasProcesses(registry)) return { ok: false, reason: 'no_processes' }
  const em = resolveEm(container)
  await assertXrayScope(em, scope)
  const gate = await isIngestAllowed(container, scope, em)
  if (!gate.allowed) return { ok: false, reason: 'disabled' }
  const store = createXrayStore(em)
  const cursor = await store.ensureCursor(scope, XRAY_SETTLE_MS)
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
  const scheduleRegistered = await ensureXrayIngestSchedule(container)
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

/**
 * Cancels the progress job of a scan that another scan replaced. A cursor without any scan means
 * the scan ended and whoever ended it settles the progress job (completion, `endScan`, a
 * rebuild's reset), so nothing is cancelled: otherwise a duplicate delivery of the job that
 * finished the scan could cancel it between the scan's completion and `completeJob`.
 */
async function cancelIfSuperseded(
  store: ProjectionStore,
  progress: ProgressService | undefined,
  payload: XrayBackfillJobPayload,
  progressContext: ProgressServiceContext,
): Promise<void> {
  const jobId = payload.progressJobId
  if (!progress || !jobId) return
  const cursor = await store.readCursor({ tenantId: payload.scope.tenantId, organizationId: payload.scope.organizationId })
  if (!cursor || cursor.scanId === null) return
  if (cursor.scanProgressJobId !== jobId) await safely('mark_cancelled', () => progress.markCancelled(jobId, progressContext))
}

function isIngestStarved(cursor: ProjectionCursor, dbNow: string): boolean {
  return !cursor.lastRunAt || Date.parse(dbNow) - Date.parse(cursor.lastRunAt) >= XRAY_INGEST_INTERVAL_MS
}

/**
 * Enqueues an incremental ingest of the organization ahead of the next scan slice when its main
 * pass has not advanced for an ingest interval (the scan kept the lease), unless the ingest queue
 * is backlogged (the job would wait behind the backlog anyway).
 */
async function nudgeStarvedIngest(store: ProjectionStore, cursor: ProjectionCursor, scope: ProjectionScope): Promise<void> {
  if (!isIngestStarved(cursor, await store.now())) return
  const backlog = await readXrayIngestBacklog()
  if (backlog !== null && backlog >= XRAY_FANOUT_MAX_BACKLOG) return
  await enqueueXrayIngest(scope)
}

/**
 * One slice of a range scan job: refuses an organization of another tenant, drops a job of a
 * replaced scan or chain, checks cancellation, runs `runScanSlice` and either finishes the
 * ProgressJob or enqueues the continuation (unless `enqueueContinuation` is false, for callers
 * that drive the slices themselves) after `XRAY_SCAN_CONTINUATION_DELAY_MS`; when the
 * organization's incremental ingest has not advanced for an ingest interval, an ingest job is
 * enqueued first so it takes the lease in that gap. Failures fail the progress job and rethrow so
 * the queue retries from the persisted scan position (a retry revives the job).
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
  await assertXrayScope(em, scope)
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
  const slice = result
  const settle = async (): Promise<XraySliceResult['status']> => {
    switch (slice.status) {
      case 'completed':
        if (progress && jobId) {
          await safely('update_progress', () => progress.updateProgress(jobId, { processedCount: slice.scanProgress?.processed ?? 0, progressPercent: 100 }, progressContext))
          await safely('complete_job', () => progress.completeJob(jobId, {
            resultSummary: { processed: slice.scanProgress?.processed ?? 0, scanId: payload.scanId },
          }, progressContext))
        }
        return slice.status
      case 'budget_exhausted':
      case 'lease_lost':
        if (progress && jobId) {
          const percent = progressPercent(slice)
          await safely('update_progress', () => progress.updateProgress(jobId, {
            processedCount: slice.scanProgress?.processed ?? 0,
            ...(percent !== undefined ? { progressPercent: percent } : {}),
          }, progressContext))
        }
        if (enqueueContinuation) {
          if (slice.status === 'budget_exhausted') await nudgeStarvedIngest(store, current, scope)
          await enqueueXrayBackfill(payload, slice.status === 'lease_lost' ? LEASE_LOST_RETRY_MS : XRAY_SCAN_CONTINUATION_DELAY_MS)
        }
        return slice.status
      case 'lease_busy':
        await store.touchScan(scope, payload.scanId, payload.chainId)
        if (progress && jobId) await safely('heartbeat', async () => progress.touchJobHeartbeat?.(jobId, progressContext))
        if (enqueueContinuation) await enqueueXrayBackfill(payload, LEASE_BUSY_RETRY_MS)
        return slice.status
      case 'superseded':
        await cancelIfSuperseded(store, progress, payload, progressContext)
        return slice.status
      case 'stale_chain':
        return slice.status
      case 'key_mismatch':
        await endScan(store, progress, payload, progressContext, XRAY_KEY_MISMATCH_ERROR, 'failed')
        return slice.status
      default:
        await endScan(store, progress, payload, progressContext, `[internal] Process X-Ray backfill stopped: ${slice.status}`, 'failed')
        return slice.status
    }
  }
  try {
    return await settle()
  } finally {
    if (slice.voided > 0 || slice.status === 'completed') {
      await invalidateAnalyticsSafely(container, scope, slice.status === 'completed' ? 'scan_completed' : 'voided')
    }
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
 * cursor (no contracts — the next slice adopts the current ones —, no pseudonym key, no
 * completed full reconciliation) and starts a fresh backfill. Used by operators after a
 * permanent pseudonym key change or to re-project everything; contract changes rebuild single
 * processes on their own. Refused while ingest is disabled. The contracts are emptied before
 * the clearing starts, so a clearing that fails midway leaves every process to be cleared and
 * rebuilt by the next slice; if the backfill fails to start, the next ingest tick schedules a
 * full reconciliation (the reset cleared its timestamp).
 */
export async function rebuildXrayProjection(
  container: XrayContainer,
  scope: ProjectionScope,
  options: { userId: string | null; name: string; description: string; enqueue?: boolean },
): Promise<XrayBackfillStart> {
  const registry = getProcessRegistry()
  if (!hasProcesses(registry)) return { ok: false, reason: 'no_processes' }
  const em = resolveEm(container)
  await assertXrayScope(em, scope)
  const gate = await isIngestAllowed(container, scope, em)
  if (!gate.allowed) return { ok: false, reason: 'disabled' }
  const store = createXrayStore(em)
  const cursor = await store.ensureCursor(scope, XRAY_SETTLE_MS)
  const lease = await store.acquireLease(cursor, createLeaseOwner(), XRAY_LEASE_MS)
  if (!lease) return { ok: false, reason: 'lease_busy' }
  try {
    await store.updateCursor(lease, XRAY_LEASE_MS, { contract_hashes: '{}' })
    for (const table of PROJECTION_TABLES) {
      let cleared = 0
      do {
        cleared = await store.clearProjectionBatch(lease, XRAY_LEASE_MS, table, CLEAR_BATCH)
      } while (cleared >= CLEAR_BATCH)
    }
    await store.resetCursor(lease, XRAY_LEASE_MS, XRAY_SETTLE_MS)
  } finally {
    await store.releaseLease(lease)
    await invalidateAnalyticsSafely(container, scope, 'rebuild')
    await supersedeSuggestionsSafely(em, scope, null, 'rebuild')
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
  const cutoff = shiftIso(await store.now(), -Math.max(1, settings.retentionDays) * DAY_MS)
  try {
    const { removed } = await pruneUnderLease(store, lease, cutoff, Number.POSITIVE_INFINITY)
    await store.updateCursor(lease, XRAY_LEASE_MS, { last_pruned_at: new Date() })
    return { ok: true, removed, cutoff }
  } finally {
    await store.releaseLease(lease)
  }
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
    countsTimedOut: counts === null,
    registry: {
      ready: registry.ready,
      contractHash: registry.contractHash,
      processes: registry.processes.map((process) => ({ processKey: process.processKey, labelKey: process.labelKey, moduleId: process.moduleId })),
      rejected: registry.rejected.length,
    },
    cursor,
    counts: counts ?? [],
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
  for (const cursor of await store.listCursors({ tenantId })) {
    await invalidateAnalyticsSafely(container, { tenantId: cursor.tenantId, organizationId: cursor.organizationId }, 'erasure')
  }
  if (outcome.mismatchedOrganizationIds.length > 0) throw new XrayErasureIncompleteError()
  return outcome.updated
}
