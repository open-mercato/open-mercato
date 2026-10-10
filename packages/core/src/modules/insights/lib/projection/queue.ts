import { createHash } from 'node:crypto'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { ProjectionScope } from './types'

const logger = createLogger('insights').child({ component: 'xray-queue' })

export const XRAY_INGEST_QUEUE = 'insights-xray-ingest'
export const XRAY_BACKFILL_QUEUE = 'insights-xray-backfill'
export const XRAY_ROLLUP_QUEUE = 'insights-xray-rollup'
export const XRAY_SUGGESTIONS_QUEUE = 'insights-xray-suggestions'
export const XRAY_INGEST_INTERVAL_MS = 120_000
export const XRAY_INGEST_INTERVAL = `${XRAY_INGEST_INTERVAL_MS / 1000}s`
export const XRAY_BACKFILL_JOB_TYPE = 'insights.xray.backfill'
/** `kind` of the system tick payload: one job that fans out per-organization ingest jobs. */
export const XRAY_FANOUT_KIND = 'xray_fanout'
/** A fan-out tick is skipped while the ingest queue still holds this many waiting jobs. */
export const XRAY_FANOUT_MAX_BACKLOG = 1000

const LEGACY_SCHEDULE_PAGE = 100
const LEGACY_SCHEDULE_MAX_ROUNDS = 50

export type XrayIngestJobPayload = {
  kind?: string
  scope?: { tenantId?: string | null; organizationId?: string | null }
  tenantId?: string | null
  organizationId?: string | null
  _jobOrigin?: string
}

export type XrayRollupJobPayload = {
  scope: { tenantId: string; organizationId: string }
}

/** One automation suggestion mining pass of an organization; `force` ignores the 24-hour interval (on-demand request). */
export type XraySuggestionJobPayload = {
  scope: { tenantId: string; organizationId: string }
  force?: boolean
}

type XrayQueueName = typeof XRAY_INGEST_QUEUE | typeof XRAY_BACKFILL_QUEUE | typeof XRAY_ROLLUP_QUEUE | typeof XRAY_SUGGESTIONS_QUEUE

export type XrayBackfillJobPayload = {
  scope: { tenantId: string; organizationId: string; userId?: string | null }
  scanId: string
  chainId: string
  progressJobId: string | null
}

type JobQueue = Queue<Record<string, unknown>>

const queues = new Map<string, JobQueue>()

export function getXrayQueue(name: XrayQueueName): JobQueue {
  const existing = queues.get(name)
  if (existing) return existing
  const created = createModuleQueue<Record<string, unknown>>(name, { concurrency: name === XRAY_INGEST_QUEUE ? 2 : 1 })
  queues.set(name, created)
  return created
}

export async function enqueueXrayBackfill(payload: XrayBackfillJobPayload, delayMs = 0): Promise<void> {
  await getXrayQueue(XRAY_BACKFILL_QUEUE).enqueue(payload as unknown as Record<string, unknown>, delayMs > 0 ? { delayMs } : undefined)
}

/** One rollup pass of an organization (queue `insights-xray-rollup`, concurrency 1). */
export async function enqueueXrayRollup(scope: ProjectionScope): Promise<void> {
  const payload: XrayRollupJobPayload = { scope: { tenantId: scope.tenantId, organizationId: scope.organizationId } }
  await getXrayQueue(XRAY_ROLLUP_QUEUE).enqueue(payload as unknown as Record<string, unknown>)
}

/** One suggestion mining pass of an organization (queue `insights-xray-suggestions`, concurrency 1). */
export async function enqueueXraySuggestionMining(scope: ProjectionScope, options: { force?: boolean } = {}): Promise<void> {
  const payload: XraySuggestionJobPayload = {
    scope: { tenantId: scope.tenantId, organizationId: scope.organizationId },
    ...(options.force === true ? { force: true } : {}),
  }
  await getXrayQueue(XRAY_SUGGESTIONS_QUEUE).enqueue(payload as unknown as Record<string, unknown>)
}

export async function enqueueXrayIngest(scope: ProjectionScope, delayMs = 0): Promise<void> {
  await getXrayQueue(XRAY_INGEST_QUEUE).enqueue(
    { scope: { tenantId: scope.tenantId, organizationId: scope.organizationId } },
    delayMs > 0 ? { delayMs } : undefined,
  )
}

async function readBacklog(name: typeof XRAY_INGEST_QUEUE | typeof XRAY_ROLLUP_QUEUE | typeof XRAY_SUGGESTIONS_QUEUE): Promise<number | null> {
  try {
    const counts = await getXrayQueue(name).getJobCounts()
    return Number.isFinite(counts.waiting) ? counts.waiting : null
  } catch (error) {
    logger.warn('[internal] Could not read an X-Ray queue backlog', { queue: name, err: error })
    return null
  }
}

/** Jobs waiting in the ingest queue; null when the queue cannot tell (the caller then proceeds). */
export async function readXrayIngestBacklog(): Promise<number | null> {
  return readBacklog(XRAY_INGEST_QUEUE)
}

/** Jobs waiting in the rollup queue; null when the queue cannot tell (the caller then proceeds). */
export async function readXrayRollupBacklog(): Promise<number | null> {
  return readBacklog(XRAY_ROLLUP_QUEUE)
}

/** Jobs waiting in the suggestion mining queue; null when the queue cannot tell (the caller then proceeds). */
export async function readXraySuggestionsBacklog(): Promise<number | null> {
  return readBacklog(XRAY_SUGGESTIONS_QUEUE)
}

type ScheduleRowLike = {
  id: string
  scopeType?: string | null
  targetQueue?: string | null
  sourceType?: string | null
  sourceModule?: string | null
}

type SchedulerServiceLike = {
  register: (registration: {
    id: string
    name: string
    description?: string
    scopeType: 'system'
    scheduleType: 'interval'
    scheduleValue: string
    timezone?: string
    targetType: 'queue'
    targetQueue: string
    targetPayload?: Record<string, unknown>
    sourceType?: 'module'
    sourceModule?: string
  }) => Promise<void>
  exists?: (scheduleId: string) => Promise<boolean>
  findByModule?: (moduleId: string, limit?: number) => Promise<ScheduleRowLike[]>
  unregister?: (scheduleId: string) => Promise<void>
}

type SchedulerContainer = {
  resolve: (name: string) => unknown
  hasRegistration?: (name: string) => boolean
}

function resolveSchedulerService(container: SchedulerContainer): SchedulerServiceLike | null {
  if (typeof container.hasRegistration === 'function' && !container.hasRegistration('schedulerService')) return null
  try {
    const service = container.resolve('schedulerService') as SchedulerServiceLike | undefined
    return service && typeof service.register === 'function' ? service : null
  } catch {
    return null
  }
}

function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/** Stable id of the one system-scoped X-Ray ingest tick. */
export const XRAY_INGEST_SCHEDULE_ID = stableScheduleUuid('insights:xray-ingest')

/**
 * A per-organization ingest schedule registered by the previous design (one row per
 * organization, counted against the tenant's active-schedule quota), replaced by the system tick.
 */
export function isLegacyXrayIngestSchedule(row: ScheduleRowLike): boolean {
  return row.id !== XRAY_INGEST_SCHEDULE_ID
    && row.scopeType === 'organization'
    && row.sourceType === 'module'
    && row.sourceModule === 'insights'
    && row.targetQueue === XRAY_INGEST_QUEUE
}

async function removeLegacyXraySchedules(scheduler: SchedulerServiceLike): Promise<number> {
  const findByModule = scheduler.findByModule
  const unregister = scheduler.unregister
  if (typeof findByModule !== 'function' || typeof unregister !== 'function') return 0
  let removed = 0
  try {
    for (let round = 0; round < LEGACY_SCHEDULE_MAX_ROUNDS; round += 1) {
      const legacy = (await findByModule.call(scheduler, 'insights', LEGACY_SCHEDULE_PAGE)).filter(isLegacyXrayIngestSchedule)
      if (legacy.length === 0) break
      for (const row of legacy) {
        await unregister.call(scheduler, row.id)
        removed += 1
      }
    }
  } catch (error) {
    logger.warn('[internal] insights: failed to remove the per-organization X-Ray ingest schedules', { err: error, removed })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_legacy_schedule_cleanup_failed' })
  }
  if (removed > 0) logger.info('Removed per-organization X-Ray ingest schedules replaced by the system tick', { removed })
  return removed
}

/**
 * Makes sure the one system-scoped X-Ray ingest tick exists (every 120 s, queue
 * `insights-xray-ingest`, payload `{ kind: 'xray_fanout' }`). A system schedule carries no tenant,
 * so it never counts against a tenant's active-schedule quota. An existing schedule is left
 * untouched, so an administrator who disabled it or changed its interval keeps that choice. Once
 * the tick exists, the per-organization schedules of the previous design are removed through the
 * scheduler service. Best-effort: the scheduler is an optional module (absent: no-op) and a
 * failure is logged and reported but never aborts tenant setup, organization creation or a
 * backfill request (every one of them calls this again). Returns whether the tick exists.
 */
export async function ensureXrayIngestSchedule(container: SchedulerContainer): Promise<boolean> {
  const schedulerService = resolveSchedulerService(container)
  if (!schedulerService) return false
  try {
    const exists = typeof schedulerService.exists === 'function' ? await schedulerService.exists(XRAY_INGEST_SCHEDULE_ID) : false
    if (!exists) {
      await schedulerService.register({
        id: XRAY_INGEST_SCHEDULE_ID,
        name: 'Process X-Ray ingest',
        description: 'Enqueues the Process X-Ray ingest of every organization (projects audited changes into the Process X-Ray tables).',
        scopeType: 'system',
        scheduleType: 'interval',
        scheduleValue: XRAY_INGEST_INTERVAL,
        timezone: 'UTC',
        targetType: 'queue',
        targetQueue: XRAY_INGEST_QUEUE,
        targetPayload: { kind: XRAY_FANOUT_KIND },
        sourceType: 'module',
        sourceModule: 'insights',
      })
    }
  } catch (error) {
    logger.warn('[internal] insights: failed to register the X-Ray ingest schedule', { err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_schedule_failed' })
    return false
  }
  await removeLegacyXraySchedules(schedulerService)
  return true
}
