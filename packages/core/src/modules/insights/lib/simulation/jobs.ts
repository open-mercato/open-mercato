import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type {
  SimulationKindResult,
  SimulationRunContext,
  SimulationScope,
  SimulationSliceResult,
} from '@open-mercato/shared/modules/insights/simulate'
import type { ProgressService, ProgressServiceContext } from '@open-mercato/core/modules/progress/lib/progressService'
import { ActionLogDecryptionUnavailableError } from '@open-mercato/core/modules/audit_logs/lib/fieldHistory'
import type { InsightsSimulationRun, SimulationErrorCode, SimulationRunStatus } from '../../data/entities'
import { effectiveKAnonymity } from '../analytics/stats'
import { isStatementTimeoutError } from '../projection/errors'
import { isOrganizationInTenant } from '../projection/payloads'
import { loadXraySettings } from '../projection/settings'
import {
  SIMULATION_CONTINUATION_DELAY_MS,
  SIMULATION_LIMITS,
  SIMULATION_PAST_VALUES_FEATURE,
  SIMULATION_RUN_FEATURE,
  SIMULATION_TENANT_BUSY_DELAY_MS,
} from './constants'
import { SimulationFeatureCheckError, createAuditScanner, createFeatureCheck, withPastValuePolicy } from './context'
import { simulationRunFeatures } from './features'
import { suppressSimulationGroups, type SimulationResultGroup } from './privacy'
import { enqueueSimulationSlice, type SimulationSliceJobPayload } from './queue'
import { getSimulationKind, listSimulationEventAdapters } from './registry'
import { confirmSimulationSamples } from './samples'
import {
  abandonStaleSimulationRuns,
  isActiveSimulationStatus,
  loadSimulationRunForWorker,
  purgeExpiredSimulationRuns,
  purgeOldSimulationDecisions,
  updateActiveSimulationRun,
  type SimulationRunPatch,
} from './store'

const logger = createLogger('insights').child({ component: 'simulation-jobs' })

/** Hard cap on slices of one run (a kind must end the run once `runDeadlineAt` passed). */
export const SIMULATION_MAX_SLICES = 200

const COVERAGE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/

const I18N_KEY_PATTERN = /^[a-z][a-zA-Z0-9_.-]{0,159}$/

export type SimulationContainer = {
  resolve: (name: string) => unknown
}

export type SimulationSliceOutcome =
  | 'scope_mismatch'
  | 'missing'
  | 'terminal'
  | 'kind_unavailable'
  | 'forbidden'
  | 'cancelled'
  | 'busy'
  | 'continued'
  | 'completed'
  | 'failed'
  | 'superseded'

export type SimulationJobDeps = {
  now?: () => number
  enqueue?: (payload: SimulationSliceJobPayload, delayMs: number) => Promise<void>
  sliceMs?: number
  runSlice?: <T>(em: EntityManager, tenantId: string, run: (trx: EntityManager) => Promise<T>) => Promise<ReadOnlySliceResult<T>>
}

/** The stored, k-suppressed result of a completed run (`result_json`). */
export type StoredSimulationResult = {
  k: number
  truncated: boolean
  groups: SimulationResultGroup[]
}

type SimulationBudgetUsage = {
  maxRecords: number
  maxDurationMs: number
  maxBatchBytes: number
  maxBatchRows: number
  recordsUsed: number
  elapsedMs: number
  slices: number
}

function tryResolve<TService>(container: SimulationContainer, name: string): TService | undefined {
  try {
    return container.resolve(name) as TService
  } catch {
    return undefined
  }
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

export function readSimulationBudgets(value: unknown): SimulationBudgetUsage {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return {
    maxRecords: Math.min(readNumber(record.maxRecords, SIMULATION_LIMITS.maxRecords), SIMULATION_LIMITS.maxRecords),
    maxDurationMs: Math.min(readNumber(record.maxDurationMs, SIMULATION_LIMITS.maxDurationMs), SIMULATION_LIMITS.maxDurationMs),
    maxBatchBytes: Math.min(readNumber(record.maxBatchBytes, SIMULATION_LIMITS.maxBatchBytes), SIMULATION_LIMITS.maxBatchBytes),
    maxBatchRows: Math.min(readNumber(record.maxBatchRows, SIMULATION_LIMITS.maxBatchRows), SIMULATION_LIMITS.maxBatchRows),
    recordsUsed: readNumber(record.recordsUsed, 0),
    elapsedMs: readNumber(record.elapsedMs, 0),
    slices: readNumber(record.slices, 0),
  }
}

/** The continuation state a running run keeps in its encrypted `result_json`. */
export function readPartialState(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  return Object.prototype.hasOwnProperty.call(record, 'partial') ? record.partial ?? null : null
}

export function sanitizeCoverage(coverage: unknown): Record<string, number> {
  const result: Record<string, number> = {}
  if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) return result
  for (const [key, value] of Object.entries(coverage as Record<string, unknown>)) {
    if (!COVERAGE_KEY_PATTERN.test(key)) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue
    result[key] = Math.floor(value)
  }
  return result
}

export function sanitizeI18nKeys(keys: unknown): string[] {
  if (!Array.isArray(keys)) return []
  return Array.from(new Set(keys.filter((key): key is string => typeof key === 'string' && I18N_KEY_PATTERN.test(key)))).slice(0, 32)
}

function classifyError(error: unknown): SimulationErrorCode {
  if (isStatementTimeoutError(error)) return 'statement_timeout'
  if (error instanceof ActionLogDecryptionUnavailableError) return 'decryption_unavailable'
  return 'internal'
}

async function safely(action: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run()
  } catch (error) {
    logger.warn('[internal] Simulation progress update failed', { action, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.simulation_progress_failed', attributes: { action } })
  }
}

function progressContextOf(run: Pick<InsightsSimulationRun, 'tenantId' | 'organizationId' | 'requestedByUserId'>): ProgressServiceContext {
  return { tenantId: run.tenantId, organizationId: run.organizationId, userId: run.requestedByUserId }
}

/**
 * Settles the run's ProgressJob after a terminal transition: `cancelled` marks it cancelled,
 * `failed` fails it with the error code only (never exception text).
 */
export async function settleSimulationProgress(
  progress: ProgressService | undefined,
  run: Pick<InsightsSimulationRun, 'tenantId' | 'organizationId' | 'requestedByUserId' | 'progressJobId'>,
  status: SimulationRunStatus,
  errorCode: SimulationErrorCode | null,
): Promise<void> {
  const jobId = run.progressJobId
  if (!progress || !jobId) return
  const context = progressContextOf(run)
  if (status === 'cancelled') {
    await safely('mark_cancelled', () => progress.markCancelled(jobId, context))
  } else if (status === 'failed') {
    await safely('fail_job', () => progress.failJob(jobId, { errorMessage: errorCode ?? 'internal' }, context))
  } else if (status === 'completed') {
    await safely('update_progress', () => progress.updateProgress(jobId, { progressPercent: 100 }, context))
    await safely('complete_job', () => progress.completeJob(jobId, undefined, context))
  }
}

async function finishRun(
  container: SimulationContainer,
  em: EntityManager,
  run: InsightsSimulationRun,
  status: 'failed' | 'cancelled',
  errorCode: SimulationErrorCode | null,
  now: () => number,
): Promise<boolean> {
  const patch: SimulationRunPatch = { status, errorCode, completedAt: new Date(now()), resultJson: null }
  const saved = await updateActiveSimulationRun(em, { tenantId: run.tenantId, organizationId: run.organizationId }, run.id, null, patch, now())
  if (!saved) return false
  await settleSimulationProgress(tryResolve<ProgressService>(container, 'progressService'), saved, status, errorCode)
  return true
}

export type ReadOnlySliceResult<T> = { acquired: false } | { acquired: true; value: T }

/**
 * Runs one slice in a READ ONLY transaction that holds the tenant's slice lock (S12 fairness: one
 * slice per tenant at a time; another tenant's slice never waits behind it) and bounds every
 * statement with `statement_timeout`.
 */
export async function runInReadOnlySlice<T>(
  em: EntityManager,
  tenantId: string,
  run: (trx: EntityManager) => Promise<T>,
): Promise<ReadOnlySliceResult<T>> {
  return em.fork().transactional(async (trx) => {
    const db = trx.getKysely<unknown>()
    const lock = await sql<{ acquired: boolean }>`select pg_try_advisory_xact_lock(hashtextextended(${`insights.simulation.slice:${tenantId}`}, 0)) as acquired`.execute(db)
    if (lock.rows[0]?.acquired !== true) return { acquired: false } as const
    await sql`set local statement_timeout = ${sql.lit(SIMULATION_LIMITS.statementTimeoutMs)}`.execute(db)
    return { acquired: true, value: await run(trx) } as const
  }, { readOnly: true })
}

async function resolveKAnonymity(em: EntityManager, scope: SimulationScope): Promise<number> {
  const settings = await loadXraySettings(em, scope)
  return effectiveKAnonymity(settings.kAnonymity)
}

/**
 * One slice of a simulation run (queue `insights-simulation`). Re-verifies the tenant/organization
 * pair and the requester's features (`insights.simulator.run` + the kind's features; a deleted or
 * demoted requester cancels the run with `forbidden`), treats a cancelled ProgressJob as
 * authoritative, then runs the kind inside a read-only, statement-bounded transaction under the
 * tenant's slice lock (a busy tenant is requeued with a delay). A slice either persists the
 * continuation state and enqueues the next slice, or k-suppresses the result, confirms sample ids
 * through the owning module's explain `loadCurrent`, and completes the run. Every write is a
 * compare-and-set on the run version, so a cancellation or a duplicate delivery always wins
 * cleanly.
 */
export async function runSimulationSlice(
  container: SimulationContainer,
  payload: SimulationSliceJobPayload,
  deps: SimulationJobDeps = {},
): Promise<SimulationSliceOutcome> {
  const now = deps.now ?? Date.now
  const enqueue = deps.enqueue ?? enqueueSimulationSlice
  const runSlice = deps.runSlice ?? runInReadOnlySlice
  const scope: SimulationScope = { tenantId: payload.tenantId, organizationId: payload.organizationId }
  const rootEm = container.resolve('em') as EntityManager
  const em = rootEm.fork()
  if (!(await isOrganizationInTenant(em, scope))) {
    logger.warn('[internal] Dropping a simulation slice whose organization does not belong to its tenant', scope)
    return 'scope_mismatch'
  }
  const run = await loadSimulationRunForWorker(em, scope, payload.runId)
  if (!run) return 'missing'
  if (!isActiveSimulationStatus(run.status)) return 'terminal'
  const progress = tryResolve<ProgressService>(container, 'progressService')
  const registered = getSimulationKind(run.kind)
  if (!registered) {
    await finishRun(container, rootEm, run, 'failed', 'kind_unavailable', now)
    return 'kind_unavailable'
  }
  const definition = registered.definition
  const parsed = definition.inputSchema.safeParse(run.inputJson)
  const budgets = readSimulationBudgets(run.budgetsJson)
  if (!parsed.success || budgets.slices >= SIMULATION_MAX_SLICES) {
    await finishRun(container, rootEm, run, 'failed', 'internal', now)
    return 'failed'
  }
  const hasFeatures = createFeatureCheck(container, run.requestedByUserId, scope)
  if (!(await hasFeatures([SIMULATION_RUN_FEATURE, ...simulationRunFeatures(definition, parsed.data)]))) {
    await finishRun(container, rootEm, run, 'cancelled', 'forbidden', now)
    return 'forbidden'
  }
  if (progress && run.progressJobId) {
    const cancelled = await progress.isCancellationRequested(run.progressJobId, scope.tenantId, scope.organizationId)
    if (cancelled) {
      await finishRun(container, rootEm, run, 'cancelled', null, now)
      return 'cancelled'
    }
  }
  let current = run
  if (run.status === 'queued') {
    const started = await updateActiveSimulationRun(rootEm, scope, run.id, run.updatedAt, { status: 'running', startedAt: new Date(now()) }, now())
    if (!started) return 'superseded'
    current = started
    const jobId = run.progressJobId
    if (progress && jobId) await safely('start_job', () => progress.startJob(jobId, progressContextOf(run)))
  }
  const startedAt = now()
  const runDeadlineAt = startedAt + Math.max(0, budgets.maxDurationMs - budgets.elapsedMs)
  const sliceDeadlineAt = Math.min(runDeadlineAt, startedAt + (deps.sliceMs ?? SIMULATION_LIMITS.sliceMs))
  const window = { from: current.windowFrom, to: current.windowTo }
  let outcome: ReadOnlySliceResult<SimulationSliceResult<unknown>>
  try {
    const pastValuesAllowed = await hasFeatures([SIMULATION_PAST_VALUES_FEATURE])
    const encryption = tryResolve<TenantDataEncryptionService>(container, 'tenantEncryptionService')
    outcome = await runSlice(rootEm, scope.tenantId, async (trx) => {
      const context: SimulationRunContext<unknown> = {
        em: trx,
        scope,
        requesterUserId: current.requestedByUserId,
        artifactId: current.artifactId ?? null,
        window,
        budget: {
          recordsRemaining: Math.max(0, budgets.maxRecords - budgets.recordsUsed),
          sliceDeadlineAt,
          runDeadlineAt,
          maxBatchRows: budgets.maxBatchRows,
          maxBatchBytes: budgets.maxBatchBytes,
        },
        state: readPartialState(current.resultJson),
        now,
        hasFeatures,
        eventAdapters: withPastValuePolicy(listSimulationEventAdapters(), pastValuesAllowed),
        scanAuditLog: createAuditScanner(trx, encryption, scope, window, budgets.maxBatchBytes),
      }
      return definition.run(parsed.data, context)
    })
  } catch (error) {
    if (error instanceof SimulationFeatureCheckError) throw error
    const errorCode = classifyError(error)
    logger.error('[internal] Simulation slice failed', { runId: run.id, kind: run.kind, errorCode, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.simulation_slice_failed', attributes: { kind: run.kind, errorCode } })
    await finishRun(container, rootEm, current, 'failed', errorCode, now)
    return 'failed'
  }
  if (!outcome.acquired) {
    const jobId = current.progressJobId
    if (progress && jobId) await safely('heartbeat', async () => progress.touchJobHeartbeat?.(jobId, progressContextOf(current)))
    await enqueue(payload, SIMULATION_TENANT_BUSY_DELAY_MS)
    return 'busy'
  }
  const slice = outcome.value
  const usage: SimulationBudgetUsage = {
    ...budgets,
    recordsUsed: budgets.recordsUsed + Math.max(0, Math.floor(slice.recordsProcessed)),
    elapsedMs: budgets.elapsedMs + Math.max(0, now() - startedAt),
    slices: budgets.slices + 1,
  }
  if (slice.status === 'continue') {
    const saved = await updateActiveSimulationRun(rootEm, scope, run.id, current.updatedAt, { resultJson: { partial: slice.state }, budgetsJson: usage }, now())
    if (!saved) return 'superseded'
    const jobId = saved.progressJobId
    const percent = typeof slice.progress === 'number' && Number.isFinite(slice.progress) ? Math.min(99, Math.max(0, Math.floor(slice.progress * 100))) : undefined
    if (progress && jobId && percent !== undefined) {
      await safely('update_progress', () => progress.updateProgress(jobId, { progressPercent: percent }, progressContextOf(saved)))
    }
    await enqueue(payload, SIMULATION_CONTINUATION_DELAY_MS)
    return 'continued'
  }
  return completeRun(container, rootEm, current, slice.result, usage, definition.cellKeys, hasFeatures, now)
}

/**
 * Coverage counts sum the group totals (every counted event lands in exactly one cell), so when a
 * group is suppressed below k they would reveal its size by difference: the run then keeps no
 * coverage and says why.
 */
export const SIMULATION_COVERAGE_HIDDEN_CAVEAT = 'insights.simulation.caveats.coverageHidden'

async function completeRun(
  container: SimulationContainer,
  rootEm: EntityManager,
  run: InsightsSimulationRun,
  result: SimulationKindResult,
  usage: SimulationBudgetUsage,
  cellKeys: string[],
  hasFeatures: ReturnType<typeof createFeatureCheck>,
  now: () => number,
): Promise<SimulationSliceOutcome> {
  const scope = { tenantId: run.tenantId, organizationId: run.organizationId }
  const em = rootEm.fork()
  const k = await resolveKAnonymity(em, scope)
  const suppressed = suppressSimulationGroups(Array.isArray(result.groups) ? result.groups : [], k, cellKeys)
  const groups = await confirmSimulationSamples(container, em, scope, run.requestedByUserId, hasFeatures, suppressed)
  const stored: StoredSimulationResult = { k, truncated: result.truncated === true, groups }
  const coverageHidden = groups.some((group) => group.suppressed)
  const caveats = sanitizeI18nKeys(result.caveats)
  const saved = await updateActiveSimulationRun(rootEm, scope, run.id, run.updatedAt, {
    status: 'completed',
    errorCode: null,
    completedAt: new Date(now()),
    resultJson: stored,
    coverageJson: coverageHidden ? {} : sanitizeCoverage(result.coverage),
    caveats: coverageHidden ? [...caveats, SIMULATION_COVERAGE_HIDDEN_CAVEAT] : caveats,
    fidelity: typeof result.fidelity === 'string' ? result.fidelity : 'none',
    budgetsJson: usage,
  }, now())
  if (!saved) return 'superseded'
  await settleSimulationProgress(tryResolve<ProgressService>(container, 'progressService'), saved, 'completed', null)
  return 'completed'
}

/** Abandoned-job hook of the worker: a run whose job the queue gave up on is failed (`abandoned`). */
export async function failAbandonedSimulationRun(container: SimulationContainer, payload: SimulationSliceJobPayload): Promise<void> {
  const rootEm = container.resolve('em') as EntityManager
  const run = await loadSimulationRunForWorker(rootEm.fork(), { tenantId: payload.tenantId, organizationId: payload.organizationId }, payload.runId)
  if (!run || !isActiveSimulationStatus(run.status)) return
  await finishRun(container, rootEm, run, 'failed', 'abandoned', Date.now)
}

export type SimulationMaintenanceResult = {
  expiredRuns: number
  oldDecisions: number
  abandonedRuns: number
}

/** The daily tick: purges expired runs (S17), old decisions (S16) and fails stale active runs. */
export async function runSimulationMaintenance(container: SimulationContainer, now: Date = new Date()): Promise<SimulationMaintenanceResult> {
  const rootEm = container.resolve('em') as EntityManager
  const progress = tryResolve<ProgressService>(container, 'progressService')
  const abandoned = await abandonStaleSimulationRuns(rootEm, now)
  for (const run of abandoned) await settleSimulationProgress(progress, run, 'failed', 'abandoned')
  const expiredRuns = await purgeExpiredSimulationRuns(rootEm, now)
  const oldDecisions = await purgeOldSimulationDecisions(rootEm, now)
  return { expiredRuns, oldDecisions, abandonedRuns: abandoned.length }
}
