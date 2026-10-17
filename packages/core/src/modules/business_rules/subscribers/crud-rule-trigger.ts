/**
 * Business Rules Module - CRUD Event Trigger Subscriber
 *
 * Wildcard subscriber that listens to all domain events and evaluates
 * business rules configured for the matching entity + event type.
 * Mirrors the pattern used by workflows/subscribers/event-trigger.ts.
 *
 * Closes #662 — business rules configured with entity + event triggers
 * were never executed because no subscriber wired CRUD events to the
 * rule engine.
 */

import type { EntityManager } from '@mikro-orm/core'
import { executeRules, resolveBusinessRuleDiscoveryCache } from '../lib/rule-engine'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { reportCausationDegradation } from '@open-mercato/shared/lib/causation/server'

const logger = createLogger('business_rules').child({ component: 'crud-rule-trigger' })

export const metadata = {
  event: '*',
  persistent: true,
  id: 'business_rules:crud-rule-trigger',
}

const EXCLUDED_EVENT_PREFIXES = [
  'query_index.',
  'search.',
  'business_rules.',
  'cache.',
  'queue.',
  'workflows.',
]

function isExcludedEvent(eventName: string): boolean {
  return EXCLUDED_EVENT_PREFIXES.some((prefix) => eventName.startsWith(prefix))
}

function parseEventName(eventName: string): { entityType: string; eventType: string } | null {
  const parts = eventName.split('.')
  if (parts.length < 3) return null
  const eventType = parts[parts.length - 1]
  const entityType = parts.slice(0, -1).join('.')
  return { entityType, eventType }
}

const PAYLOAD_ENTITY_ID_KEYS = ['id', 'entityId', 'recordId'] as const
const MAX_ENTITY_ID_LENGTH = 255
const ENTITY_ID_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

function normalizeEntityIdCandidate(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_ENTITY_ID_LENGTH) return undefined
  if (ENTITY_ID_CONTROL_CHARACTER_PATTERN.test(trimmed)) return undefined
  return trimmed
}

function resolvePayloadEntityId(payload: Record<string, unknown>): string | undefined {
  for (const key of PAYLOAD_ENTITY_ID_KEYS) {
    const candidate = normalizeEntityIdCandidate(payload[key])
    if (candidate) return candidate
  }
  return undefined
}

type CrudRuleTriggerContext = {
  resolve: <T = unknown>(name: string) => T
  eventName?: string
  tenantId?: string | null
  organizationId?: string | null
}

export default async function handle(
  payload: unknown,
  ctx: CrudRuleTriggerContext,
): Promise<void> {
  const eventName = ctx.eventName
  if (!eventName) return
  if (isExcludedEvent(eventName)) return

  const parsed = parseEventName(eventName)
  if (!parsed) return

  const data = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const tenantId = typeof ctx.tenantId === 'string' && ctx.tenantId.length > 0 ? ctx.tenantId : undefined
  const organizationId = typeof ctx.organizationId === 'string' && ctx.organizationId.length > 0 ? ctx.organizationId : undefined
  if (!tenantId || !organizationId) return

  const em = ctx.resolve<EntityManager>('em')
  const cache = resolveBusinessRuleDiscoveryCache(ctx.resolve)
  const entityId = resolvePayloadEntityId(data)

  try {
    const result = await executeRules(em, {
      entityType: parsed.entityType,
      eventType: parsed.eventType,
      ...(entityId ? { entityId } : {}),
      data,
      tenantId,
      organizationId,
    }, { cache })
    if (!entityId && result.executedRules.length > 0) {
      reportCausationDegradation('rule_entity_id_unresolved', { eventName })
    }
  } catch (error) {
    logger.error('Rule execution failed for event', { event: eventName, err: error })
    getTelemetryRuntime()?.reportError(error, {
      module: 'business_rules',
      code: 'business_rules.crud_trigger_failed',
      attributes: { eventName },
    })
  }
}
