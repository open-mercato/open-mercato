import type { SyncCrudEventPayload } from './sync-event-types'
import type { SyncSubscriberEntry } from './sync-subscriber-store'

// ---------------------------------------------------------------------------
// Event pattern matching
// ---------------------------------------------------------------------------

export function matchesEventPattern(pattern: string, eventId: string): boolean {
  if (pattern === eventId) return true
  if (pattern === '*') return true
  const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
  return regex.test(eventId)
}

// ---------------------------------------------------------------------------
// Collect matching subscribers
// ---------------------------------------------------------------------------

export function collectSyncSubscribers(
  allSyncSubscribers: SyncSubscriberEntry[],
  eventId: string,
): SyncSubscriberEntry[] {
  return allSyncSubscribers
    .filter((s) => matchesEventPattern(s.metadata.event, eventId))
    .sort((a, b) => (a.metadata.priority ?? 50) - (b.metadata.priority ?? 50))
}

// ---------------------------------------------------------------------------
// Run sync before-event subscribers
// ---------------------------------------------------------------------------

export async function runSyncBeforeEvent(
  subscribers: SyncSubscriberEntry[],
  payload: SyncCrudEventPayload,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<{ ok: boolean; errorBody?: Record<string, unknown>; errorStatus?: number; modifiedPayload?: Record<string, unknown> }> {
  let currentPayload = payload.payload

  for (const subscriber of subscribers) {
    const result = await subscriber.handler({ ...payload, payload: currentPayload }, ctx)

    if (result?.ok === false) {
      const body = result.body ?? { error: result.message ?? 'Operation blocked', subscriberId: subscriber.metadata.id }
      return { ok: false, errorBody: body, errorStatus: result.status ?? 422 }
    }

    if (result?.modifiedPayload) {
      currentPayload = { ...currentPayload, ...result.modifiedPayload }
    }
  }

  return { ok: true, modifiedPayload: currentPayload !== payload.payload ? currentPayload : undefined }
}

// ---------------------------------------------------------------------------
// Run sync after-event subscribers
// ---------------------------------------------------------------------------

export async function runSyncAfterEvent(
  subscribers: SyncSubscriberEntry[],
  payload: SyncCrudEventPayload,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  for (const subscriber of subscribers) {
    try {
      await subscriber.handler(payload, ctx)
    } catch (error) {
      console.error(`[sync-event] after-subscriber failed: ${subscriber.metadata.id}`, error)
    }
  }
}
