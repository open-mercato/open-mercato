import type { SyncCrudEventPayload } from '@open-mercato/shared/lib/crud/sync-event-types'

/**
 * Sync after-delete subscriber: logs a deletion audit trail.
 *
 * Fires after a todo has been deleted. After-event subscribers cannot block
 * the operation — errors are swallowed with console.error. Demonstrates
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
  // eslint-disable-next-line no-console
  console.log(
    `[example:audit-delete] Todo ${payload.resourceId} deleted by user ${payload.userId} in org ${payload.organizationId}`,
  )
}
