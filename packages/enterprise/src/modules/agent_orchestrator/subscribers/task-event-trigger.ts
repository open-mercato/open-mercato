import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { AgentTaskDefinition, AgentTaskEventTrigger, AgentTaskRun } from '../data/entities'
import type { AgentTaskEventTriggerConfig } from '../data/validators'
import {
  evaluateFilterConditions,
  mapEventToInput,
  matchesEventPattern,
} from '../lib/tasks/eventTriggerMatch'

/**
 * Wildcard subscriber evaluating `AgentTaskEventTrigger` rows (Agentic Tasks
 * Phase 4) — mirrors `workflows`' event-trigger subscriber. Matching triggers
 * enqueue a run through the same `tasks.enqueueRun` command every other
 * trigger source uses (`triggeredBy: 'event:<name>'`).
 */
export const metadata = {
  event: '*',
  persistent: true,
  id: 'agent_orchestrator:task-event-trigger',
}

/**
 * Internal/system events that must never trigger tasks. `agent_orchestrator.`
 * is excluded to prevent recursion storms: a task run emits task_run.* events
 * which would otherwise re-match a broad trigger and loop.
 */
const EXCLUDED_EVENT_PREFIXES = [
  'query_index.',
  'search.',
  'workflows.',
  'cache.',
  'queue.',
  'agent_orchestrator.',
]

export default async function handle(
  payload: unknown,
  ctx: {
    resolve: <T = unknown>(name: string) => T
    eventName?: string
    tenantId?: string | null
    organizationId?: string | null
  },
): Promise<void> {
  const eventName = ctx.eventName
  if (!eventName) return
  if (EXCLUDED_EVENT_PREFIXES.some((prefix) => eventName.startsWith(prefix))) return

  // Only trust scope attached by the emitter via event-bus options.
  const tenantId = typeof ctx.tenantId === 'string' && ctx.tenantId.length > 0 ? ctx.tenantId : null
  const organizationId =
    typeof ctx.organizationId === 'string' && ctx.organizationId.length > 0 ? ctx.organizationId : null
  if (!tenantId || !organizationId) return

  const eventPayload = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>

  let em: EntityManager
  let commandBus: CommandBus
  try {
    em = (ctx.resolve('em') as EntityManager).fork()
    commandBus = ctx.resolve('commandBus') as CommandBus
  } catch (error) {
    console.warn('[internal] agent_orchestrator: task-trigger dependencies unavailable', error)
    return
  }

  const triggers = await em.find(
    AgentTaskEventTrigger,
    { tenantId, organizationId, enabled: true, deletedAt: null },
    { orderBy: { priority: 'desc', createdAt: 'asc' } },
  )
  if (triggers.length === 0) return

  const now = Date.now()
  for (const trigger of triggers) {
    if (!matchesEventPattern(trigger.eventPattern, eventName)) continue
    const config = (trigger.config ?? {}) as AgentTaskEventTriggerConfig
    if (!evaluateFilterConditions(config.filterConditions, eventPayload)) continue

    const definition = await em.findOne(AgentTaskDefinition, {
      id: trigger.taskDefinitionId,
      tenantId,
      organizationId,
      enabled: true,
      deletedAt: null,
    })
    if (!definition) continue

    if (config.debounceMs && config.debounceMs > 0) {
      const recent = await em.find(
        AgentTaskRun,
        {
          taskDefinitionId: definition.id,
          organizationId,
          triggeredBy: `event:${eventName}`,
          createdAt: { $gte: new Date(now - config.debounceMs) },
        },
        { limit: 1 },
      )
      if (recent.length > 0) continue
    }

    if (config.maxConcurrentInstances && config.maxConcurrentInstances > 0) {
      const runningCount = await em.count(AgentTaskRun, {
        taskDefinitionId: definition.id,
        organizationId,
        status: 'running',
      })
      if (runningCount >= config.maxConcurrentInstances) continue
    }

    const commandCtx: CommandRuntimeContext = {
      container: {
        resolve: ctx.resolve,
        cradle: new Proxy({}, { get: (_target, prop: string) => ctx.resolve(prop) }),
      } as unknown as CommandRuntimeContext['container'],
      auth: null,
      organizationScope: null,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
    }
    try {
      await commandBus.execute('agent_orchestrator.tasks.enqueueRun', {
        input: {
          tenantId,
          organizationId,
          taskDefinitionId: definition.id,
          input: mapEventToInput(config.contextMapping, eventPayload),
          triggeredBy: `event:${eventName}`,
        },
        ctx: commandCtx,
      })
    } catch (error) {
      console.error(
        '[internal] agent_orchestrator: event-triggered task enqueue failed',
        { triggerId: trigger.id, taskDefinitionId: definition.id, eventName },
        error instanceof Error ? error.message : error,
      )
    }
  }
}
