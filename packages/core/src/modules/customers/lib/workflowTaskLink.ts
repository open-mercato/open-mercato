/**
 * The `CustomerTodoLink.todoSource` a workflow-created user task is stored under,
 * and the backend page that task actually opens on.
 *
 * Lives in its own module because both a server subscriber
 * (`link-workflow-task-handler`) and a `"use client"` renderer
 * (`components/detail/utils`) need the value, and the subscriber pulls in ORM
 * entities that must not reach the browser bundle.
 *
 * The value is an ENTITY id, not a module name: `resolveLegacyTodoDetails` hands
 * `todoSource` to the query engine to load each linked task's title, and a bare
 * module name resolves to no entity at all.
 */
export const WORKFLOW_TASK_TODO_SOURCE = 'workflows:user_task'

/**
 * A workflow user task is completed on its own task screen — the one carrying
 * the form the USER_TASK step declared — not through the `/todos/:id/edit`
 * convention the other todo sources follow.
 */
export function workflowTaskHref(taskId: string): string {
  return `/backend/workflows/tasks/${encodeURIComponent(taskId)}`
}
