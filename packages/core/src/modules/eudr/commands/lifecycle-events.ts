import { organizationEventScope } from '@open-mercato/shared/lib/events/organization-scope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { EudrEventId } from '../events'

const logger = createLogger('eudr').child({ component: 'lifecycle-events' })

type LifecycleEventBus = {
  emitEvent(event: string, payload: unknown, options?: unknown): Promise<void>
}

type LifecycleContainer = { resolve: (name: string) => unknown }

export async function emitEudrLifecycleEvent(
  container: LifecycleContainer,
  eventId: EudrEventId,
  payload: Record<string, unknown>,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  try {
    const eventBus = container.resolve('eventBus') as LifecycleEventBus | undefined
    if (!eventBus) return
    await eventBus.emitEvent(
      eventId,
      { ...payload, occurredAt: new Date().toISOString() },
      { persistent: true, ...organizationEventScope(scope) },
    )
  } catch (err) {
    logger.warn('EUDR lifecycle event emit failed', { eventId, err })
  }
}
