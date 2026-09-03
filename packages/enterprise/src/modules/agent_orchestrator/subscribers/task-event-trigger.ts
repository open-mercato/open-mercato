import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { AgentProcessDefinition, AgentProcessRun } from '../data/entities'
import { parseProcessTriggers, eventTriggers } from '../lib/tasks/triggers'
import {
  candidateEventPatterns,
  evaluateFilterConditions,
  mapEventToInput,
  matchesEventPattern,
} from '../lib/tasks/eventTriggerMatch'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('agent_orchestrator').child({ subscriber: 'task-event-trigger' })

/**
 * Wildcard subscriber evaluating the `{ kind: 'event' }` entries of
 * `agent_process_definitions.triggers` (triggered process model Phase 2 — the
 * retired `agent_task_event_triggers` table collapsed into that jsonb).
 * Matching triggers enqueue a run through the same `processes.enqueueRun`
 * command every other trigger source uses, with
 * `triggeredBy: { kind: 'event', ref: <eventPattern> }`.
 */
export const metadata = {
  event: '*',
  persistent: true,
  id: 'agent_orchestrator:task-event-trigger',
}

/**
 * Internal/system events that must never trigger processes. `agent_orchestrator.`
 * is excluded to prevent recursion storms: a process run emits process_run.* events
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

/** How many recent runs the debounce window inspects before giving up on a match. */
const DEBOUNCE_SCAN_LIMIT = 20

type DefinitionIdRow = { id: string }

/**
 * The definitions whose declared triggers CAN match this event, narrowed by
 * jsonb containment so the `agent_process_definitions_triggers_gin` index does
 * the work. `candidateEventPatterns` enumerates the exact id plus every
 * trailing-wildcard pattern that could match it, so wildcards are index-served
 * too and no scan over enabled definitions is needed.
 */
async function findCandidateDefinitionIds(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  eventName: string,
): Promise<string[]> {
  const patterns = candidateEventPatterns(eventName)
  const containment = patterns.map(() => '"triggers" @> ?::jsonb').join(' or ')
  const params = patterns.map((pattern) => JSON.stringify([{ kind: 'event', eventPattern: pattern }]))
  const rows = (await em.getConnection().execute(
    `select "id" from "agent_process_definitions"
     where "tenant_id" = ? and "organization_id" = ? and "enabled" = true and "deleted_at" is null
       and (${containment})`,
    [scope.tenantId, scope.organizationId, ...params],
  )) as DefinitionIdRow[]
  return rows.map((row) => row.id).filter((id): id is string => typeof id === 'string')
}

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
    logger.warn('task-trigger dependencies unavailable', {
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }

  const scope = { tenantId, organizationId }
  let candidateIds: string[]
  try {
    candidateIds = await findCandidateDefinitionIds(em, scope, eventName)
  } catch (error) {
    logger.error('event-trigger candidate lookup failed', {
      eventName,
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }
  if (candidateIds.length === 0) return

  const definitions = await em.find(
    AgentProcessDefinition,
    { id: { $in: candidateIds }, ...scope, enabled: true, deletedAt: null },
    { orderBy: { createdAt: 'asc' } },
  )
  if (definitions.length === 0) return

  // One definition may declare several event triggers; the highest priority
  // matching entry within a definition decides, mirroring the retired table's
  // `order by priority desc, created_at asc`.
  const matches = definitions
    .flatMap((definition) =>
      eventTriggers(parseProcessTriggers(definition.triggers))
        .filter((trigger) => trigger.enabled && matchesEventPattern(trigger.eventPattern, eventName))
        .map((trigger) => ({ definition, trigger })),
    )
    .sort((left, right) => right.trigger.priority - left.trigger.priority)

  const now = Date.now()
  for (const { definition, trigger } of matches) {
    const config = trigger.config ?? {}
    if (!evaluateFilterConditions(config.filterConditions, eventPayload)) continue

    if (config.debounceMs && config.debounceMs > 0) {
      const recent = await em.find(
        AgentProcessRun,
        {
          processDefinitionId: definition.id,
          organizationId,
          createdAt: { $gte: new Date(now - config.debounceMs) },
        },
        { limit: DEBOUNCE_SCAN_LIMIT, orderBy: { createdAt: 'desc' } },
      )
      const debounced = recent.some((run) => {
        const source = run.triggeredBy
        return !!source && source.kind === 'event' && source.ref === trigger.eventPattern
      })
      if (debounced) continue
    }

    if (config.maxConcurrentInstances && config.maxConcurrentInstances > 0) {
      const runningCount = await em.count(AgentProcessRun, {
        processDefinitionId: definition.id,
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
      await commandBus.execute('agent_orchestrator.processes.enqueueRun', {
        input: {
          tenantId,
          organizationId,
          processDefinitionId: definition.id,
          input: mapEventToInput(config.contextMapping, eventPayload),
          triggeredBy: { kind: 'event' as const, ref: trigger.eventPattern },
        },
        ctx: commandCtx,
      })
    } catch (error) {
      logger.error('event-triggered process enqueue failed', {
        processDefinitionId: definition.id,
        eventPattern: trigger.eventPattern,
        eventName,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
