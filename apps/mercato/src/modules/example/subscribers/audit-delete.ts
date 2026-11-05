import type { SyncCrudEventPayload } from '@open-mercato/shared/lib/crud/sync-event-types'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('example').child({ subscriber: 'audit-delete' })

/**
 * Sync after-delete subscriber: logs a deletion audit trail.
 *
 * Fires after a todo has been deleted. After-event subscribers cannot block
 * the operation — a throw here is swallowed by the dispatcher. Demonstrates
 * the sync after-event contract (m2).
 */
export const metadata = {
  event: 'example.todo.deleted',
  sync: true,
  priority: 50,
  id: 'example:audit-delete',
}

export default async function handler(
  payload: SyncCrudEventPayload,
): Promise<void> {
  logger.info('Todo deleted', {
    resourceId: payload.resourceId,
    userId: payload.userId,
    organizationId: payload.organizationId,
  })
}
