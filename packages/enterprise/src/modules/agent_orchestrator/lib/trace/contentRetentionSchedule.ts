import { createHash } from 'node:crypto'
import type { AwilixContainer } from 'awilix'
import { AGENT_ORCHESTRATOR_TRACE_CONTENT_RETENTION_QUEUE } from '../queue'

/** Mirrors the @open-mercato/scheduler ScheduleRegistration field names. */
export type SchedulerServiceLike = {
  register: (registration: {
    id: string
    name: string
    scopeType: 'system' | 'organization' | 'tenant'
    organizationId?: string
    tenantId?: string
    scheduleType: 'cron' | 'interval'
    scheduleValue: string
    timezone?: string
    targetType: 'queue' | 'command'
    targetQueue?: string
    targetPayload?: unknown
    sourceType?: 'user' | 'module'
    sourceModule?: string
    isEnabled?: boolean
    description?: string
  }) => Promise<void>
}

export type TraceContentRetentionScheduleScope = { tenantId: string; organizationId: string }

/**
 * `scheduled_jobs.id` is a uuid column, so a module-owned schedule's stable
 * registration key must be hashed into a uuid — this keeps register() an
 * idempotent upsert across seedDefaults re-runs.
 */
export function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export function resolveSchedulerService(container: AwilixContainer): SchedulerServiceLike | null {
  const cradle = container as { hasRegistration?: (name: string) => boolean }
  if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) return null
  return container.resolve('schedulerService') as SchedulerServiceLike
}

/**
 * Upsert the daily per-organization trace content retention schedule. Returns
 * `scheduler_unavailable` when the deployment has no scheduler module; a
 * registration failure is thrown to the caller.
 */
export async function registerTraceContentRetentionSchedule(
  container: AwilixContainer,
  scope: TraceContentRetentionScheduleScope,
): Promise<'registered' | 'scheduler_unavailable'> {
  const schedulerService = resolveSchedulerService(container)
  if (!schedulerService) return 'scheduler_unavailable'
  await schedulerService.register({
    id: stableScheduleUuid(`agent_orchestrator:trace-content-retention:${scope.organizationId}`),
    name: 'Agent trace content retention',
    description: 'Deletes full-fidelity trace content artifacts older than the tenant retention window once a day.',
    scopeType: 'organization',
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    scheduleType: 'interval',
    scheduleValue: '86400s',
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: AGENT_ORCHESTRATOR_TRACE_CONTENT_RETENTION_QUEUE,
    targetPayload: { scope: { tenantId: scope.tenantId, organizationId: scope.organizationId } },
    sourceType: 'module',
    sourceModule: 'agent_orchestrator',
    isEnabled: true,
  })
  return 'registered'
}

export type TraceContentRetentionScheduleOutcome = {
  scope: TraceContentRetentionScheduleScope
  status: 'registered' | 'failed'
  error: string | null
}

export type TraceContentRetentionScheduleSummary =
  | { status: 'scheduler_unavailable'; outcomes: [] }
  | { status: 'completed'; outcomes: TraceContentRetentionScheduleOutcome[] }

/**
 * Register the retention schedule for every given organization (the
 * `trace-retention:schedule` CLI). One organization's failure is recorded and
 * the rest still register.
 */
export async function registerTraceContentRetentionSchedules(
  container: AwilixContainer,
  scopes: TraceContentRetentionScheduleScope[],
): Promise<TraceContentRetentionScheduleSummary> {
  if (!resolveSchedulerService(container)) return { status: 'scheduler_unavailable', outcomes: [] }
  const outcomes: TraceContentRetentionScheduleOutcome[] = []
  for (const scope of scopes) {
    try {
      await registerTraceContentRetentionSchedule(container, scope)
      outcomes.push({ scope, status: 'registered', error: null })
    } catch (error) {
      outcomes.push({ scope, status: 'failed', error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { status: 'completed', outcomes }
}
