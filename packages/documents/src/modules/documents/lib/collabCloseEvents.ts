/**
 * Hocuspocus closes every socket of a room with `ResetConnection` (4205) both
 * when the room only needs to re-authenticate (share/archive changes) and when
 * its content was replaced server-side (version restore, content reset). The
 * provider reconnects with the SAME local Y.Doc in both cases — after a
 * content replacement that stale document would sync straight back into the
 * freshly loaded room and silently undo the restore. The sidecar therefore
 * closes content-replaced rooms with this dedicated reason so browsers know to
 * discard their local document before reconnecting.
 *
 * Only the reason is significant. Hocuspocus multiplexes documents over one
 * socket, so a per-document close reaches the browser as a Close *message*
 * that the provider surfaces with code 1000 and the server-supplied reason;
 * the 4205 code is only observed when the socket itself is closed.
 */
export const COLLAB_CONTENT_RESET_CLOSE_CODE = 4205
export const COLLAB_CONTENT_RESET_CLOSE_REASON = 'documents:content-reset'
export const COLLAB_CONTENT_RESET_CLOSE_EVENT = {
  code: COLLAB_CONTENT_RESET_CLOSE_CODE,
  reason: COLLAB_CONTENT_RESET_CLOSE_REASON,
} as const

export function isCollabContentResetCloseEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false
  return (event as { reason?: unknown }).reason === COLLAB_CONTENT_RESET_CLOSE_REASON
}
