import type { SyncCrudEventPayload, SyncCrudEventResult } from '@open-mercato/shared/lib/crud/sync-event-types'

/**
 * Sync before-create subscriber: sets a default priority on new todos.
 *
 * When creating a todo without an explicit `priority` field, this subscriber
 * injects `priority: 'normal'` into the payload. Demonstrates the sync
 * before-event contract (m2).
 */
export const metadata = {
  event: 'example.todo.creating',
  sync: true,
  priority: 50,
  id: 'example:auto-default-priority',
}

export default async function handler(
  payload: SyncCrudEventPayload,
): Promise<SyncCrudEventResult | void> {
  const body = payload.payload
  if (body && typeof body === 'object' && !('priority' in body)) {
    return {
      ok: true,
      modifiedPayload: { ...body, priority: 'normal' },
    }
  }
}
