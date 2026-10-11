import type { EntityManager } from '@mikro-orm/postgresql'
import { loggedMinutes, type RollupEntry, type RollupTask, type TaskRollup } from '../time-tracking/rollup'

/**
 * Per-task hours for the board, the drawer and the subtask checklist.
 *
 * D-2 fixes one rule for every surface: a parent always shows the inclusive rollup,
 * `own entries + Σ children's entries`. The arithmetic itself belongs to
 * `lib/time-tracking/rollup.ts` and is not repeated here — this module's job is to
 * hand that helper a complete, access-scoped picture of the page in a single round
 * trip.
 *
 * Two properties matter and are easy to get wrong:
 *
 *  1. **Off-page children still count.** The board asks for top-level cards only, so
 *     a parent's children are, by construction, absent from the page. Rolling up only
 *     the children that happen to share the page would make a card's hours depend on
 *     the current filter — indistinguishable from flakiness. The query therefore
 *     widens from the page's ids to `id IN (page) OR parent_task_id IN (page)`.
 *  2. **One aggregate for the whole page.** A 100-card board must not issue 100
 *     queries; minutes come back pre-summed per (task, entry project) group, exactly
 *     as the project aggregates do.
 *
 * Raw `duration_minutes` is what feeds these numbers. Rounded minutes exist only for
 * money and stay inside `cost.ts` (D-7).
 */

export type TaskRollupTaskRow = {
  id: string
  parentTaskId?: string | null
  timeProjectId?: string | null
  /** The task sits in a column flagged `is_done` — the only definition of a done subtask (D-2). */
  isDone?: boolean | null
  deletedAt?: Date | string | null
}

/** Entry minutes pre-summed by the database, one group per (task, entry project). */
export type TaskRollupEntryGroup = {
  taskId: string
  timeProjectId?: string | null
  minutes: number
  deletedAt?: Date | string | null
}

export type TaskRollupInput = {
  /** The page's task ids — already filtered to what the caller may see. */
  taskIds: readonly string[]
  /** The page's tasks plus every child of them, on-page or not. */
  tasks: readonly TaskRollupTaskRow[]
  entryGroups: readonly TaskRollupEntryGroup[]
}

export type { TaskRollup }

/**
 * The rollup as the API publishes it: the minutes contract of
 * `lib/time-tracking/rollup.ts` plus the done tally of the same children
 * `childCount` counts.
 *
 * `doneChildCount` exists so a surface can render `3/5` from the row it already
 * has. Without it the only way to say how many subtasks are finished is to fetch
 * a page of children and count them, which turns opening a task into a second
 * round trip for a number this aggregate already knows.
 */
export type TaskPageRollup = TaskRollup & { doneChildCount: number }

export const EMPTY_TASK_ROLLUP: TaskPageRollup = {
  ownMinutes: 0,
  loggedMinutes: 0,
  childCount: 0,
  doneChildCount: 0,
}

function toMinutes(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * The projects the caller provably sees on this page.
 *
 * The list route has already intersected the page with `resolveProjectAccess`, so the
 * projects of the page's own tasks are an authoritative allow-list. An entry pointing
 * at any other project is dropped rather than trusted: nothing here can prove the
 * caller may see it, and a rollup is a client-facing number.
 */
function allowedProjectIds(input: TaskRollupInput): Set<string> {
  const pageIds = new Set(input.taskIds)
  const allowed = new Set<string>()
  for (const task of input.tasks) {
    if (!pageIds.has(task.id) || task.deletedAt) continue
    if (task.timeProjectId) allowed.add(task.timeProjectId)
  }
  return allowed
}

/**
 * How many of a task's live children sit in a done column.
 *
 * The child set is derived exactly as `loggedMinutes` derives it — same parent
 * test, same soft-delete exclusion, same self-reference guard — so a subtask can
 * never be done without also being counted, which is the only way `3/5` can read
 * as `3/4`.
 */
function countDoneChildren(
  taskId: string,
  allTasks: readonly RollupTask[],
  doneByTaskId: ReadonlyMap<string, boolean>,
): number {
  let done = 0
  for (const candidate of allTasks) {
    if (candidate.parentTaskId !== taskId || candidate.id === taskId || candidate.deletedAt) continue
    if (doneByTaskId.get(candidate.id) === true) done += 1
  }
  return done
}

export function summarizeTaskRollups(input: TaskRollupInput): Map<string, TaskPageRollup> {
  const allowed = allowedProjectIds(input)

  // The grouped query returns one row per (task, entry project), so a task with
  // entries in two projects arrives twice. Deduplicating is not cosmetic: a repeated
  // child row would be counted twice by `childCount`.
  const taskById = new Map<string, RollupTask>()
  const doneByTaskId = new Map<string, boolean>()
  for (const task of input.tasks) {
    if (taskById.has(task.id)) continue
    taskById.set(task.id, { id: task.id, parentTaskId: task.parentTaskId ?? null, deletedAt: task.deletedAt ?? null })
    doneByTaskId.set(task.id, task.isDone === true)
  }
  const allTasks = [...taskById.values()]

  const entriesByTaskId = new Map<string, RollupEntry[]>()
  for (const group of input.entryGroups) {
    if (group.timeProjectId && !allowed.has(group.timeProjectId)) continue
    const bucket = entriesByTaskId.get(group.taskId) ?? []
    bucket.push({ durationMinutes: toMinutes(group.minutes), deletedAt: group.deletedAt ?? null })
    entriesByTaskId.set(group.taskId, bucket)
  }

  const result = new Map<string, TaskPageRollup>()
  for (const taskId of input.taskIds) {
    const task = taskById.get(taskId) ?? { id: taskId, parentTaskId: null }
    result.set(taskId, {
      ...loggedMinutes(task, allTasks, entriesByTaskId),
      doneChildCount: countDoneChildren(taskId, allTasks, doneByTaskId),
    })
  }
  return result
}

export type TaskRollupScope = {
  em: EntityManager
  tenantId: string
  organizationId: string
  taskIds: readonly string[]
}

type TaskRollupRow = {
  task_id: string
  parent_task_id: string | null
  task_project_id: string | null
  task_is_done: boolean | string | null
  entry_project_id: string | null
  minutes: string | number | null
}

function toDoneFlag(value: boolean | string | null | undefined): boolean {
  if (typeof value === 'boolean') return value
  return value === 't' || value === 'true'
}

/**
 * One grouped aggregate per page.
 *
 * The `OR` in the predicate is served by two indexes — the task primary key for the
 * page's own ids and `staff_time_tasks_parent_idx` for their children — so widening
 * to off-page children costs no extra round trip.
 */
export async function computeTaskRollups(scope: TaskRollupScope): Promise<Map<string, TaskPageRollup>> {
  const taskIds = [...new Set(scope.taskIds)].filter((id) => typeof id === 'string' && id.length > 0)
  if (taskIds.length === 0) return new Map<string, TaskPageRollup>()

  const placeholders = taskIds.map(() => '?').join(', ')
  const params: unknown[] = [scope.tenantId, scope.organizationId, ...taskIds, ...taskIds]

  // The status join is what makes `doneChildCount` free: done-ness is a property
  // of the column a task sits in (D-2), and the aggregate already walks every
  // child of the page.
  const sql = `
    SELECT
      t.id AS task_id,
      t.parent_task_id,
      t.time_project_id AS task_project_id,
      COALESCE(s.is_done, false) AS task_is_done,
      e.time_project_id AS entry_project_id,
      COALESCE(SUM(e.duration_minutes), 0)::bigint AS minutes
    FROM staff_time_tasks t
    LEFT JOIN staff_time_task_statuses s
      ON s.id = t.task_status_id
     AND s.tenant_id = t.tenant_id
     AND s.organization_id = t.organization_id
     AND s.deleted_at IS NULL
    LEFT JOIN staff_time_entries e
      ON e.task_id = t.id
     AND e.tenant_id = t.tenant_id
     AND e.organization_id = t.organization_id
     AND e.deleted_at IS NULL
    WHERE t.tenant_id = ?
      AND t.organization_id = ?
      AND t.deleted_at IS NULL
      AND (t.id IN (${placeholders}) OR t.parent_task_id IN (${placeholders}))
    GROUP BY 1, 2, 3, 4, 5
  `

  const rows = (await scope.em.getConnection().execute(sql, params)) as TaskRollupRow[]

  const tasks: TaskRollupTaskRow[] = []
  const entryGroups: TaskRollupEntryGroup[] = []
  for (const row of rows) {
    tasks.push({
      id: row.task_id,
      parentTaskId: row.parent_task_id,
      timeProjectId: row.task_project_id,
      isDone: toDoneFlag(row.task_is_done),
      deletedAt: null,
    })
    entryGroups.push({
      taskId: row.task_id,
      timeProjectId: row.entry_project_id,
      minutes: toMinutes(row.minutes),
      deletedAt: null,
    })
  }

  return summarizeTaskRollups({ taskIds, tasks, entryGroups })
}
