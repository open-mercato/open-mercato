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

/**
 * Widget-injection spot on the task detail surface (spec §7.6).
 *
 * A FROZEN contract surface (BACKWARD_COMPATIBILITY.md §6) once a third party
 * mounts a widget on it. It exists because the detail page can only walk a
 * task's `formSchema` GENERICALLY: an agent-disposition task rendered that way
 * is a key/value dump of the mutation an operator is being asked to approve.
 * The module that owns the proposal renders it properly instead.
 */
export const TASK_DETAIL_INJECTION_SPOT_ID = 'workflows.task.detail:context'
