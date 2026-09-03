import { createHash } from 'node:crypto'
import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { AgentProcessDefinition } from '../../data/entities'
import { PROCESS_TRIGGERS_MAX } from '../../data/validators'
import { AGENT_ORCHESTRATOR_PROCESS_RUN_QUEUE } from '../queue'
import { parseProcessTriggers, scheduleTriggers } from './triggers'

const logger = createLogger('agent_orchestrator').child({ component: 'task-schedule' })

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

/**
 * `scheduled_jobs.id` is a uuid — hash the stable task key into one (same trick
 * as setup.ts). `slot` is the schedule trigger's position in the definition's
 * declared list; slot 0 keeps the pre-Phase-2 key so a definition that already
 * had a cron keeps its registered job instead of orphaning it.
 */
export function taskScheduleUuid(processDefinitionId: string, slot = 0): string {
  const key = slot === 0
    ? `agent_orchestrator:task:${processDefinitionId}`
    : `agent_orchestrator:task:${processDefinitionId}:${slot}`
  const hex = createHash('sha256').update(key).digest('hex')
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
 * Best-effort, idempotent schedule sync for a process definition: registers one
 * scheduler job per enabled `{ kind: 'schedule' }` trigger, unregisters every
 * unused slot up to the declared-trigger cap. Runs on EVERY create/update/delete
 * — not just when triggers changed — so a failed sync self-heals on the next
 * edit (spec risk register: "stray schedule keeps firing"). A deployment without
 * the scheduler module is a safe no-op; failures log loudly but never abort the
 * mutation that triggered the sync.
 */
export async function syncProcessSchedule(container: AwilixContainer, task: AgentProcessDefinition): Promise<void> {
  const scheduler = resolveScheduler(container)
  if (!scheduler) return
  const live = !task.deletedAt && task.enabled
  const schedules = live
    ? scheduleTriggers(parseProcessTriggers(task.triggers)).filter((trigger) => trigger.enabled)
    : []
  try {
    for (let slot = 0; slot < schedules.length; slot += 1) {
      const trigger = schedules[slot]
      await scheduler.register({
        id: taskScheduleUuid(task.id, slot),
        name: schedules.length > 1
          ? `Process definition: ${task.name} (${slot + 1})`
          : `Process definition: ${task.name}`,
        description: `Scheduled trigger for process definition ${task.id}.`,
        scopeType: 'organization',
        organizationId: task.organizationId,
        tenantId: task.tenantId,
        scheduleType: 'cron',
        scheduleValue: trigger.cron,
        timezone: trigger.timezone,
        targetType: 'queue',
        targetQueue: AGENT_ORCHESTRATOR_PROCESS_RUN_QUEUE,
        // The scheduler enqueues this payload directly; the worker recognizes
        // the schedule shape and creates the AgentProcessRun row itself.
        targetPayload: { scheduledProcessDefinitionId: task.id, scheduleId: taskScheduleUuid(task.id, slot) },
        sourceType: 'module',
        sourceModule: 'agent_orchestrator',
        isEnabled: true,
      })
    }
    for (let slot = schedules.length; slot < PROCESS_TRIGGERS_MAX; slot += 1) {
      await scheduler.unregister(taskScheduleUuid(task.id, slot))
    }
  } catch (error) {
    logger.warn('task schedule sync failed', {
      processDefinitionId: task.id,
      scheduleCount: schedules.length,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
