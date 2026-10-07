/**
 * Row parsing and board arithmetic for the Kanban board of screen 6 (T3.6).
 *
 * Kept apart from `KanbanBoard.tsx` so the parts that decide what a card says —
 * which rows become cards, what a column's hours are, where a dropped card lands —
 * are unit-testable without a DOM, and so the board component stays about drag,
 * optimistic writes and rollback.
 *
 * The column total deliberately delegates to `sumTaskLoggedMinutes` rather than
 * folding `loggedMinutes` inline: that helper drops any row whose parent is present
 * in the same set, which is the only guard against risk R10 (a parent's rollup
 * already contains its children's minutes, so adding both double-counts).
 */

import { formatDuration } from '../time-tracking/duration'
import { sumTaskLoggedMinutes } from '../timesheets-tasks/taskHoursTotals'
import { STATUS_POSITION_GAP } from '../timesheets-tasks/statusPositions'
import { resolveProjectColorHex } from '../timesheets-ui/colors'

export type BoardApiRow = Record<string, unknown>

export type BoardStatus = {
  id: string
  name: string
  slug: string | null
  color: string | null
  position: number
  isDefault: boolean
  isDone: boolean
}

export type BoardTask = {
  id: string
  title: string
  reference: string | null
  timeProjectId: string | null
  parentTaskId: string | null
  taskStatusId: string | null
  assigneeStaffMemberId: string | null
  position: number
  ownMinutes: number
  loggedMinutes: number
  childCount: number
  closedAt: string | null
  updatedAt: string | null
  tagIds: string[]
}

export type SubtaskProgress = {
  total: number
  done: number
}

export function readString(row: BoardApiRow, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

export function readNumber(row: BoardApiRow, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

export function readBoolean(row: BoardApiRow, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'boolean') return value
    if (value === 'true') return true
    if (value === 'false') return false
  }
  return false
}

function readStringArray(row: BoardApiRow, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = row[key]
    if (!Array.isArray(value)) continue
    const ids = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    if (ids.length > 0) return ids
  }
  return []
}

export function toBoardStatus(row: BoardApiRow): BoardStatus | null {
  const id = readString(row, 'id')
  if (!id) return null
  return {
    id,
    name: readString(row, 'name') ?? id,
    slug: readString(row, 'slug'),
    color: readString(row, 'color'),
    position: readNumber(row, 'position') ?? 0,
    isDefault: readBoolean(row, 'is_default', 'isDefault'),
    isDone: readBoolean(row, 'is_done', 'isDone'),
  }
}

export function toBoardTask(row: BoardApiRow): BoardTask | null {
  const id = readString(row, 'id')
  if (!id) return null
  return {
    id,
    title: readString(row, 'title') ?? id,
    reference: readString(row, 'reference'),
    timeProjectId: readString(row, 'time_project_id', 'timeProjectId'),
    parentTaskId: readString(row, 'parent_task_id', 'parentTaskId'),
    taskStatusId: readString(row, 'task_status_id', 'taskStatusId'),
    assigneeStaffMemberId: readString(row, 'assignee_staff_member_id', 'assigneeStaffMemberId'),
    position: readNumber(row, 'position') ?? 0,
    ownMinutes: readNumber(row, 'ownMinutes', 'own_minutes') ?? 0,
    loggedMinutes: readNumber(row, 'loggedMinutes', 'logged_minutes') ?? 0,
    childCount: readNumber(row, 'childCount', 'child_count') ?? 0,
    closedAt: readString(row, 'closed_at', 'closedAt'),
    updatedAt: readString(row, 'updated_at', 'updatedAt'),
    tagIds: readStringArray(row, 'tagIds', 'tag_ids'),
  }
}

export function readItems(payload: unknown): BoardApiRow[] {
  if (!payload || typeof payload !== 'object') return []
  const items = (payload as { items?: unknown }).items
  if (!Array.isArray(items)) return []
  return items.filter((item): item is BoardApiRow => !!item && typeof item === 'object')
}

export function readTotal(payload: unknown, fallback: number): number {
  if (!payload || typeof payload !== 'object') return fallback
  const total = (payload as { total?: unknown }).total
  return typeof total === 'number' && Number.isFinite(total) ? total : fallback
}

/** `22:45` — the card and column-header hours format of the mockup. */
export function formatBoardMinutes(minutes: number): string {
  return formatDuration(Number.isFinite(minutes) ? minutes : 0, 'clock')
}

/**
 * A column's summed hours (mockup note 4). Never fold `loggedMinutes` by hand —
 * see the module docblock and `taskHoursTotals.ts` on risk R10.
 */
export function columnLoggedMinutes(tasks: readonly BoardTask[]): number {
  return sumTaskLoggedMinutes(
    tasks.map((task) => ({
      id: task.id,
      parentTaskId: task.parentTaskId,
      loggedMinutes: task.loggedMinutes,
    })),
  )
}

/**
 * Subtask progress per parent (`3/5 podzadań`).
 *
 * The board only ever renders top-level cards, so children arrive from a separate
 * sweep. A child counts as done when it sits in a column flagged `is_done`, with
 * `closed_at` as the fallback for a child whose status is no longer on the board.
 */
export function computeSubtaskProgress(
  children: readonly BoardTask[],
  doneStatusIds: ReadonlySet<string>,
): Map<string, SubtaskProgress> {
  const progress = new Map<string, SubtaskProgress>()
  for (const child of children) {
    if (!child.parentTaskId) continue
    const entry = progress.get(child.parentTaskId) ?? { total: 0, done: 0 }
    entry.total += 1
    const isDone = (child.taskStatusId && doneStatusIds.has(child.taskStatusId)) || !!child.closedAt
    if (isDone) entry.done += 1
    progress.set(child.parentTaskId, entry)
  }
  return progress
}

/**
 * The slot a card dropped on a column takes.
 *
 * Cards land at the top of the target column, matching where the optimistic update
 * puts them, so the server order and the rendered order agree without a refetch.
 * Positions stay on the gap grid the server seeds, so a drop writes one row.
 */
export function nextPositionAtColumnTop(tasks: readonly BoardTask[]): number {
  let lowest: number | null = null
  for (const task of tasks) {
    if (!Number.isFinite(task.position)) continue
    if (lowest === null || task.position < lowest) lowest = task.position
  }
  if (lowest === null) return STATUS_POSITION_GAP
  const candidate = Math.floor(lowest / 2)
  return candidate > 0 ? candidate : 1
}

/** Two-letter avatar initials, matching the mockup's `AN` / `PZ` chips. */
export function initialsFromName(name: string | null | undefined): string {
  const safe = (name ?? '').trim()
  if (!safe) return '?'
  const parts = safe.split(/\s+/).filter((part) => part.length > 0)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

/**
 * The column accent bar colour.
 *
 * Statuses store a `PROJECT_COLOR_KEYS` token, never raw CSS, so the board resolves
 * the key through the shared palette and paints the 6px bar with an inline
 * background. No status-colour Tailwind class is involved.
 */
export function statusAccentColor(status: BoardStatus): string {
  return resolveProjectColorHex(status.color, status.name)
}

export function sortByPosition<T extends { position: number; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    if (left.position !== right.position) return left.position - right.position
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })
}
