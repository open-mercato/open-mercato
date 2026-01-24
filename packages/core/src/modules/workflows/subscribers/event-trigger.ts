/**
 * Workflows Module - Event Trigger Subscriber
 *
 * Wildcard subscriber that listens to all events and evaluates
 * workflow event triggers. When a matching trigger is found,
 * the corresponding workflow is started with mapped context.
 */

import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'

export const metadata = {
  event: '*', // Subscribe to ALL events
  persistent: true, // Ensure reliability
  id: 'workflows:event-trigger',
}

// Events that should never trigger workflows (internal/system events)
const EXCLUDED_EVENT_PREFIXES = [
  'query_index.', // Internal indexing events
  'search.', // Internal search events
  'workflows.', // Workflow internal events (avoid recursion)
  'cache.', // Cache events
  'queue.', // Queue events
]

/**
 * Check if an event should be excluded from trigger processing.
 */
function isExcludedEvent(eventName: string): boolean {
  return EXCLUDED_EVENT_PREFIXES.some(prefix => eventName.startsWith(prefix))
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T; eventName?: string }
): Promise<void> {
  const eventName = ctx.eventName
  if (!eventName) {
    // Skip if no event name (shouldn't happen, but be safe)
    return
  }

  // Skip excluded events
  if (isExcludedEvent(eventName)) {
    return
  }

  // Ensure payload is an object
  const eventPayload = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>

  // Extract tenant/org from payload
  const tenantId = eventPayload?.tenantId as string | undefined
  const organizationId = eventPayload?.organizationId as string | undefined

  // Skip events without tenant context
  if (!tenantId || !organizationId) {
    return
  }

  // Get dependencies from container
  let em: EntityManager
  let container: AwilixContainer

  try {
    em = ctx.resolve<EntityManager>('em')
    container = ctx.resolve<AwilixContainer>('container')
  } catch (error) {
    // DI not available - skip
    console.warn(`[workflow-trigger] Cannot resolve dependencies for event "${eventName}":`, error)
    return
  }

  // Import service dynamically to avoid circular dependencies
  const { processEventTriggers } = await import('../lib/event-trigger-service')

  try {
    const result = await processEventTriggers(em, container, {
      eventName,
      payload: eventPayload,
      tenantId,
      organizationId,
    })

    if (result.triggered > 0) {
      console.log(
        `[workflow-trigger] Triggered ${result.triggered} workflow(s) for "${eventName}"` +
        (result.skipped > 0 ? ` (${result.skipped} skipped)` : '') +
        (result.errors.length > 0 ? ` (${result.errors.length} errors)` : '')
      )
    }

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        console.error(`[workflow-trigger] Trigger ${err.triggerId} failed:`, err.error)
      }
    }
  } catch (error) {
    console.error(`[workflow-trigger] Error processing triggers for "${eventName}":`, error)
  }
}
