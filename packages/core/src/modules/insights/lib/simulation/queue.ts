import { createHash } from 'node:crypto'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import { isUuid } from '@open-mercato/shared/lib/causation/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  SIMULATION_MAINTENANCE_INTERVAL,
  SIMULATION_MAINTENANCE_KIND,
  SIMULATION_QUEUE,
  SIMULATION_QUEUE_CONCURRENCY,
} from './constants'

const logger = createLogger('insights').child({ component: 'simulation-queue' })

/** S12: a slice job carries identifiers only. */
export type SimulationSliceJobPayload = {
  runId: string
  tenantId: string
  organizationId: string
}

export type SimulationMaintenanceJobPayload = {
  kind: typeof SIMULATION_MAINTENANCE_KIND
}

type JobQueue = Queue<Record<string, unknown>>

let queue: JobQueue | null = null

export function getSimulationQueue(): JobQueue {
  if (!queue) queue = createModuleQueue<Record<string, unknown>>(SIMULATION_QUEUE, { concurrency: SIMULATION_QUEUE_CONCURRENCY })
  return queue
}

export async function enqueueSimulationSlice(payload: SimulationSliceJobPayload, delayMs = 0): Promise<void> {
  const job: SimulationSliceJobPayload = {
    runId: payload.runId,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  }
  await getSimulationQueue().enqueue(job as unknown as Record<string, unknown>, delayMs > 0 ? { delayMs } : undefined)
}

export function readSimulationSlicePayload(value: unknown): SimulationSliceJobPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!isUuid(record.runId) || !isUuid(record.tenantId) || !isUuid(record.organizationId)) return null
  return {
    runId: record.runId.toLowerCase(),
    tenantId: record.tenantId.toLowerCase(),
    organizationId: record.organizationId.toLowerCase(),
  }
}

export function isSimulationMaintenancePayload(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && (value as Record<string, unknown>).kind === SIMULATION_MAINTENANCE_KIND
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
}

type SchedulerContainer = {
  resolve: (name: string) => unknown
  hasRegistration?: (name: string) => boolean
}

function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/** Stable id of the one system-scoped daily simulation maintenance tick. */
export const SIMULATION_MAINTENANCE_SCHEDULE_ID = stableScheduleUuid('insights:simulation-maintenance')

let scheduleEnsured = false

function resolveSchedulerService(container: SchedulerContainer): SchedulerServiceLike | null {
  if (typeof container.hasRegistration === 'function' && !container.hasRegistration('schedulerService')) return null
  try {
    const service = container.resolve('schedulerService') as SchedulerServiceLike | undefined
    return service && typeof service.register === 'function' ? service : null
  } catch {
    return null
  }
}

/**
 * Makes sure the daily simulation maintenance tick exists (system scope, so it never counts against
 * a tenant's schedule quota; queue `insights-simulation`, payload `{ kind: 'simulation_maintenance' }`):
 * it purges expired runs (S17) and decisions older than 13 months (S16). An existing schedule is
 * left untouched (an administrator may have disabled it). Best-effort: the scheduler is optional and
 * a failure is logged and reported, never thrown. Checked once per process after success.
 */
export async function ensureSimulationMaintenanceSchedule(container: SchedulerContainer): Promise<boolean> {
  if (scheduleEnsured) return true
  const scheduler = resolveSchedulerService(container)
  if (!scheduler) return false
  try {
    const exists = typeof scheduler.exists === 'function' ? await scheduler.exists(SIMULATION_MAINTENANCE_SCHEDULE_ID) : false
    if (!exists) {
      await scheduler.register({
        id: SIMULATION_MAINTENANCE_SCHEDULE_ID,
        name: 'Change simulator maintenance',
        description: 'Removes expired change simulations and simulation decisions older than 13 months.',
        scopeType: 'system',
        scheduleType: 'interval',
        scheduleValue: SIMULATION_MAINTENANCE_INTERVAL,
        timezone: 'UTC',
        targetType: 'queue',
        targetQueue: SIMULATION_QUEUE,
        targetPayload: { kind: SIMULATION_MAINTENANCE_KIND },
        sourceType: 'module',
        sourceModule: 'insights',
      })
    }
    scheduleEnsured = true
    return true
  } catch (error) {
    logger.warn('[internal] insights: failed to register the simulation maintenance schedule', { err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.simulation_schedule_failed' })
    return false
  }
}

export function resetSimulationScheduleCacheForTests(): void {
  scheduleEnsured = false
}
