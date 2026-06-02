/**
 * Channel-state keys owned by the push-delivery lifecycle (Spec C), written by the
 * push register/renew commands rather than the sync cursor. They must survive a
 * sync-cursor replacement so watch/subscription renewal keeps working.
 */
export const PUSH_STATE_KEYS = [
  'pushStatus',
  'watchExpirationMs',
  'pubsubTopic',
  'lastPushError',
] as const

/**
 * Replace the channel sync-cursor state with the adapter's freshly decoded cursor
 * while carrying forward the hub-owned push keys the cursor does not manage.
 *
 * This MUST be a full replace, never a `{ ...previous, ...next }` spread: adapters
 * signal "drain finished" by OMITTING the mid-drain resumption tokens
 * (`pendingHistoryPageToken`, `pendingMessagesPageToken`) from
 * `next` (they are set to `undefined`, which `JSON.stringify` drops from the encoded
 * cursor). A spread would retain a stale token from `previous` and mis-route the
 * next push/poll cycle, so the poll worker and both push-sync workers share this
 * helper to stay consistent.
 */
export function preservePushState(
  previous: unknown,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const prev =
    previous && typeof previous === 'object' && !Array.isArray(previous)
      ? (previous as Record<string, unknown>)
      : {}
  const merged: Record<string, unknown> = { ...next }
  for (const key of PUSH_STATE_KEYS) {
    if (!(key in merged) && key in prev) merged[key] = prev[key]
  }
  return merged
}
