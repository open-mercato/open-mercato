/**
 * Work Inbox — canonical hrefs (PURE).
 *
 * Mirrors `lib/visual-editor-navigation.ts`: every link to the inbox is built
 * from here rather than from a literal path, so the retired `/backend/tasks`
 * bridge and any future move are a one-line change.
 */

export const WORK_INBOX_HREF = '/backend/work-inbox'

/**
 * Task detail is deliberately still `/backend/tasks/<id>` — the spec keeps
 * instance URLs, and only the LIST moved.
 */
export function buildWorkInboxItemHref(itemId: string): string {
  return `/backend/tasks/${itemId}`
}
