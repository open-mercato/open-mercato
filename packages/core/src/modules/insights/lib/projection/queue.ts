import { createHash } from 'node:crypto'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { ProjectionScope } from './types'

const logger = createLogger('insights').child({ component: 'xray-queue' })

export const XRAY_INGEST_QUEUE = 'insights-xray-ingest'
export const XRAY_BACKFILL_QUEUE = 'insights-xray-backfill'
export const XRAY_INGEST_INTERVAL = '120s'
export const XRAY_BACKFILL_JOB_TYPE = 'insights.xray.backfill'

export type XrayIngestJobPayload = {
  scope?: { tenantId?: string | null; organizationId?: string | null }
  tenantId?: string | null
  organizationId?: string | null
}

export type XrayBackfillJobPayload = {
  scope: { tenantId: string; organizationId: string; userId?: string | null }
  scanId: string
  chainId: string
  progressJobId: string | null
}

type JobQueue = Queue<Record<string, unknown>>

const queues = new Map<string, JobQueue>()

export function getXrayQueue(name: typeof XRAY_INGEST_QUEUE | typeof XRAY_BACKFILL_QUEUE): JobQueue {
  const existing = queues.get(name)
  if (existing) return existing
  const created = createModuleQueue<Record<string, unknown>>(name, { concurrency: name === XRAY_INGEST_QUEUE ? 2 : 1 })
  queues.set(name, created)
  return created
}

export async function enqueueXrayBackfill(payload: XrayBackfillJobPayload, delayMs = 0): Promise<void> {
  await getXrayQueue(XRAY_BACKFILL_QUEUE).enqueue(payload as unknown as Record<string, unknown>, delayMs > 0 ? { delayMs } : undefined)
}

export async function enqueueXrayIngest(scope: ProjectionScope): Promise<void> {
  await getXrayQueue(XRAY_INGEST_QUEUE).enqueue({ scope: { tenantId: scope.tenantId, organizationId: scope.organizationId } })
}

type SchedulerServiceLike = {
  register: (registration: {
    id: string
    name: string
    description?: string
    scopeType: 'system' | 'organization' | 'tenant'
    organizationId?: string
    tenantId?: string
    scheduleType: 'cron' | 'interval'
    scheduleValue: string
    timezone?: string
    targetType: 'queue'
    targetQueue: string
    targetPayload?: Record<string, unknown>
    sourceType?: string
    sourceModule?: string
    isEnabled?: boolean
  }) => Promise<void>
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

export function xrayIngestScheduleId(organizationId: string): string {
  return stableScheduleUuid(`insights:xray-ingest:${organizationId}`)
}

/**
 * Registers the per-organization ingest tick (idempotent upsert). Best-effort: the
 * scheduler is an optional module (absent: no-op) and a failed registration never aborts
 * tenant setup, organization creation or a backfill request. Returns whether the schedule
 * is registered.
 */
export async function ensureXrayIngestSchedule(container: SchedulerContainer, scope: ProjectionScope): Promise<boolean> {
  const schedulerService = resolveSchedulerService(container)
  if (!schedulerService) return false
  try {
    await schedulerService.register({
      id: xrayIngestScheduleId(scope.organizationId),
      name: 'Process X-Ray ingest',
      description: 'Projects audited changes of this organization into the Process X-Ray tables.',
      scopeType: 'organization',
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      scheduleType: 'interval',
      scheduleValue: XRAY_INGEST_INTERVAL,
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: XRAY_INGEST_QUEUE,
      targetPayload: { scope: { tenantId: scope.tenantId, organizationId: scope.organizationId } },
      sourceType: 'module',
      sourceModule: 'insights',
      isEnabled: true,
    })
    return true
  } catch (error) {
    logger.warn('[internal] insights: failed to register the X-Ray ingest schedule', { err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.xray_schedule_failed' })
    return false
  }
}
