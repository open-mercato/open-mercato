import { getGlobalEventBus } from '@open-mercato/shared/modules/events'
import { emitMaintenanceEvent, type MaintenanceEventId } from '../events'

/** Best-effort: the event bus may be degraded or absent (CLI) during maintenance. */
export async function emitMaintenanceEventSafely(eventId: MaintenanceEventId, payload: Record<string, unknown>): Promise<void> {
  try {
    if (!getGlobalEventBus()) return
    await emitMaintenanceEvent(eventId, payload)
  } catch {
    return
  }
}
