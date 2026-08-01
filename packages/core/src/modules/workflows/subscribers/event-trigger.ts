/**
 * Workflows Module - Event Trigger Subscriber
 *
 * Wildcard subscriber that listens to all events and evaluates
 * workflow event triggers. When a matching trigger is found,
 * the corresponding workflow is started with mapped context.
 */

import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows').child({ component: 'event-trigger' })

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
  ctx: {
    resolve: <T = unknown>(name: string) => T
    eventName?: string
    tenantId?: string | null
    organizationId?: string | null
  }
): Promise<void> {
  const eventName = ctx.eventName
  if (!eventName) {
    logger.warn('Skipping trigger evaluation because subscriber context is missing eventName')
    return
  }

  // Skip excluded events
  if (isExcludedEvent(eventName)) {
    return
  }

  // Ensure payload is an object
  const eventPayload = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>

  // Only trust scope attached by the emitter via event bus options.
  const tenantId = typeof ctx.tenantId === 'string' && ctx.tenantId.length > 0 ? ctx.tenantId : undefined
  const organizationId =
    typeof ctx.organizationId === 'string' && ctx.organizationId.length > 0
      ? ctx.organizationId
      : undefined

  // Skip events without trusted tenant context
  if (!tenantId || !organizationId) {
    return
  }

  // Get dependencies from container
  let em: EntityManager
  let container: AwilixContainer

  try {
    em = ctx.resolve<EntityManager>('em')
    // Create a minimal container wrapper using the resolve function
    // This avoids the need to register 'container' as a self-reference in DI
    container = {
      resolve: ctx.resolve,
      // Provide minimal AwilixContainer interface for type compatibility
      cradle: new Proxy({}, {
        get: (_target, prop: string) => ctx.resolve(prop),
      }),
    } as unknown as AwilixContainer
  } catch (error) {
    // DI not available - skip
    logger.warn('Cannot resolve dependencies for event', { event: eventName, err: error })
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

    logger.debug('Evaluated triggers', {
      event: eventName,
      tenantId,
      organizationId,
      matched: result.triggered + result.skipped + result.errors.length,
      triggered: result.triggered,
      skipped: result.skipped,
      errors: result.errors.length,
    })

    if (result.triggered > 0) {
      logger.info('Triggered workflows for event', {
        event: eventName,
        triggered: result.triggered,
        skipped: result.skipped,
        errors: result.errors.length,
      })
    }

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        logger.error('Trigger failed', { triggerId: err.triggerId, err: err.error })
      }
    }
  } catch (error) {
    logger.error('Error processing triggers for event', { event: eventName, err: error })
  }
}
