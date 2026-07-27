import { createHash } from 'node:crypto'
import type { AwilixContainer } from 'awilix'
import type { AgentTaskDefinition } from '../../data/entities'
import { AGENT_ORCHESTRATOR_TASK_RUN_QUEUE } from '../queue'

/** Mirrors the @open-mercato/scheduler ScheduleRegistration field names (see setup.ts). */
type SchedulerServiceLike = {
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
  unregister: (scheduleId: string) => Promise<void>
}

/** `scheduled_jobs.id` is a uuid — hash the stable task key into one (same trick as setup.ts). */
export function taskScheduleUuid(taskDefinitionId: string): string {
  const hex = createHash('sha256').update(`agent_orchestrator:task:${taskDefinitionId}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function resolveScheduler(container: AwilixContainer): SchedulerServiceLike | null {
  const cradle = container as unknown as { hasRegistration?: (name: string) => boolean }
  if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) {
    return null
  }
  return container.resolve('schedulerService') as SchedulerServiceLike
}

/**
 * Best-effort, idempotent schedule sync for a task definition: registers the
 * cron schedule when the task is enabled + scheduled, unregisters it otherwise
 * (including soft delete). Runs on EVERY create/update/delete — not just when
 * schedule fields changed — so a failed sync self-heals on the next edit (spec
 * risk register: "stray schedule keeps firing"). A deployment without the
 * scheduler module is a safe no-op; failures log loudly but never abort the
 * mutation that triggered the sync.
 */
export async function syncTaskSchedule(container: AwilixContainer, task: AgentTaskDefinition): Promise<void> {
  const scheduler = resolveScheduler(container)
  if (!scheduler) return
  const scheduleId = taskScheduleUuid(task.id)
  const shouldRun = !task.deletedAt && task.enabled && task.scheduleEnabled && !!task.scheduleCron
  try {
    if (shouldRun) {
      await scheduler.register({
        id: scheduleId,
        name: `Agentic task: ${task.name}`,
        description: `Scheduled trigger for agentic task ${task.id}.`,
        scopeType: 'organization',
        organizationId: task.organizationId,
        tenantId: task.tenantId,
        scheduleType: 'cron',
        scheduleValue: task.scheduleCron as string,
        timezone: task.scheduleTimezone ?? 'UTC',
        targetType: 'queue',
        targetQueue: AGENT_ORCHESTRATOR_TASK_RUN_QUEUE,
        // The scheduler enqueues this payload directly; the worker recognizes
        // the schedule shape and creates the AgentTaskRun row itself.
        targetPayload: { scheduledTaskDefinitionId: task.id, scheduleId },
        sourceType: 'module',
        sourceModule: 'agent_orchestrator',
        isEnabled: true,
      })
    } else {
      await scheduler.unregister(scheduleId)
    }
  } catch (error) {
    console.warn(
      '[internal] agent_orchestrator: task schedule sync failed',
      { taskDefinitionId: task.id, shouldRun },
      error instanceof Error ? error.message : error,
    )
  }
}
