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
import { executeRules } from '../lib/rule-engine'

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

type EventPayload = {
  tenantId?: string
  organizationId?: string
  [key: string]: unknown
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T; eventName?: string },
): Promise<void> {
  const eventName = ctx.eventName
  if (!eventName) return
  if (isExcludedEvent(eventName)) return

  const parsed = parseEventName(eventName)
  if (!parsed) return

  const data = (payload ?? {}) as EventPayload
  const tenantId = data.tenantId
  const organizationId = data.organizationId
  if (!tenantId || !organizationId) return

  const em = ctx.resolve<EntityManager>('em')

  try {
    await executeRules(em, {
      entityType: parsed.entityType,
      eventType: parsed.eventType,
      data,
      tenantId,
      organizationId,
    })
  } catch (error) {
    console.error(`[business_rules] Rule execution failed for event ${eventName}:`, error)
  }
}
