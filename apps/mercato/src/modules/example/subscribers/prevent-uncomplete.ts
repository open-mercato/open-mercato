import type { SyncCrudEventPayload, SyncCrudEventResult } from '@open-mercato/shared/lib/crud/sync-event-types'

/**
 * Sync before-update subscriber: prevents reverting a completed todo.
 *
 * Once a todo is marked as done, this subscriber blocks any attempt to set
 * `isDone` back to `false`. Demonstrates the sync before-event rejection
 * contract (m2).
 */
export const metadata = {
  event: 'example.todo.updating',
  sync: true,
  priority: 60,
  id: 'example:prevent-uncomplete',
}

export default async function handler(
  payload: SyncCrudEventPayload,
): Promise<SyncCrudEventResult | void> {
  const body = payload.payload
  const previous = payload.previousData

  if (!previous || !body || typeof body !== 'object') return

  const wasDone = previous.isDone === true || previous.is_done === true
  const wantUndone = ('isDone' in body && body.isDone === false) || ('is_done' in body && body.is_done === false)

  if (wasDone && wantUndone) {
    return {
      ok: false,
      message: 'Completed todos cannot be reverted to pending',
      status: 422,
    }
  }
}
