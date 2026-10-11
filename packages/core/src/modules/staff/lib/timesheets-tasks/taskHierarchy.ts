/**
 * The depth-1 rule behind D-2, as pure predicates.
 *
 * A subtask is not a second kind of record — it is a task with `parent_task_id` set,
 * carrying its own status, assignee and time entries. What keeps that from turning
 * into an arbitrary tree (which the board, the drawer checklist and the report rollup
 * would each have to learn to walk) is a single invariant: **a parent may not itself
 * have a parent**. One level, no exceptions, enforced on create and on re-parent.
 *
 * The consequences the rest of the module relies on:
 *  - the board can filter `parent_task_id IS NULL` and know it is showing every task
 *    that is not already displayed inside some other task's drawer;
 *  - the rollup is `own + Σ children` with no recursion;
 *  - a soft-delete cascade is one level deep, so it is a single extra write set rather
 *    than a walk.
 */

export const SUBTASK_DEPTH_EXCEEDED_CODE = 'subtask_depth_exceeded'

/** A parent may have children; a child may not. Depth is counted in edges. */
export const MAX_TASK_DEPTH = 1

export type TaskHierarchyNode = {
  id: string
  timeProjectId: string
  parentTaskId?: string | null
}

/** The task being parented. On create it has no id yet and no children. */
export type TaskHierarchyChild = {
  id?: string | null
  timeProjectId: string
  /** Live children the task already has. A task with children may not become one. */
  childCount?: number
}

export type TaskParentRejection =
  /** The task was pointed at itself. */
  | 'self_parent'
  /** Either the intended parent is already a child, or the task itself has children. */
  | 'subtask_depth_exceeded'
  /** §2 — a task lives in exactly one project, and so does its parent. */
  | 'parent_project_mismatch'

/**
 * Answers "may `child` be parented to `parent`?" — `null` means yes.
 *
 * A missing parent is the caller's to report (it is a 404/422 about an unreachable
 * record, not a shape violation), so this function is only handed a parent that was
 * actually loaded inside the caller's scope.
 */
export function rejectTaskParent(
  parent: TaskHierarchyNode,
  child: TaskHierarchyChild,
): TaskParentRejection | null {
  if (child.id && parent.id === child.id) return 'self_parent'
  if (parent.timeProjectId !== child.timeProjectId) return 'parent_project_mismatch'
  // The intended parent is itself a subtask — accepting this would make a grandchild.
  if (parent.parentTaskId != null) return 'subtask_depth_exceeded'
  // The task being moved already holds children, so it cannot also become one.
  if ((child.childCount ?? 0) > 0) return 'subtask_depth_exceeded'
  return null
}

/** True when the task may still gain children (i.e. it is not itself a child). */
export function canAcceptChildren(task: Pick<TaskHierarchyNode, 'parentTaskId'>): boolean {
  return task.parentTaskId == null
}

export type TaskSoftDeletePlan = {
  taskId: string
  /** Live children that go with the parent, in the order they were read. */
  childIds: string[]
  /** Everything the delete transaction stamps `deleted_at` on. */
  allIds: string[]
}

/**
 * Soft-deleting a parent takes its children with it, in the same transaction.
 *
 * Time entries are deliberately absent from the plan: they keep pointing at the
 * deleted task so a closed report still resolves its line labels months later. The
 * cascade is one level because the depth rule guarantees the children have none.
 */
export function planTaskSoftDelete(
  task: TaskHierarchyNode,
  children: readonly Pick<TaskHierarchyNode, 'id'>[] = [],
): TaskSoftDeletePlan {
  const childIds: string[] = []
  const seen = new Set<string>([task.id])
  // A child task can never bring a cascade of its own, so the list is empty for one.
  const candidates = canAcceptChildren(task) ? children : []
  for (const child of candidates) {
    if (!child?.id || seen.has(child.id)) continue
    seen.add(child.id)
    childIds.push(child.id)
  }
  return { taskId: task.id, childIds, allIds: [task.id, ...childIds] }
}
