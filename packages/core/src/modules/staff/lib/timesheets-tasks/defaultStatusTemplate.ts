/**
 * The tenant default Kanban template a project is seeded with (D-1).
 *
 * D-1 makes columns per-project so an audit project and a migration project can
 * look nothing alike, which only works if every project starts from something
 * usable — there is no board without columns, and no UI that repairs an empty
 * one. This template is that starting point: the four columns screen 6 draws,
 * with the entry point (`isDefault`) and the terminal column (`isDone`) already
 * marked so a task can be created and closed the moment the project exists.
 *
 * Labels are i18n keys with an English fallback, resolved through the same
 * `translate(key, fallback)` seam the rest of the module uses, so a Polish tenant
 * gets the mockup's "W toku" rather than a hardcoded English string. Colours are
 * DS chart token keys from `PROJECT_COLOR_KEYS`, never raw hex — the board reads
 * the key back through `resolveProjectColorHex` to paint `kcol-accent`.
 */

import type { ProjectColorKey } from '../timesheets-ui/colors'
import { STATUS_POSITION_GAP } from './statusPositions'

export type DefaultTaskStatusTemplateEntry = {
  slug: string
  labelKey: string
  defaultLabel: string
  color: ProjectColorKey
  isDefault: boolean
  isDone: boolean
}

export const DEFAULT_TASK_STATUS_TEMPLATE: readonly DefaultTaskStatusTemplateEntry[] = [
  {
    slug: 'backlog',
    labelKey: 'staff.time_tracking.taskStatuses.defaults.backlog',
    defaultLabel: 'Backlog',
    color: 'indigo',
    isDefault: true,
    isDone: false,
  },
  {
    slug: 'in-progress',
    labelKey: 'staff.time_tracking.taskStatuses.defaults.inProgress',
    defaultLabel: 'In progress',
    color: 'blue',
    isDefault: false,
    isDone: false,
  },
  {
    slug: 'in-review',
    labelKey: 'staff.time_tracking.taskStatuses.defaults.inReview',
    defaultLabel: 'In review',
    color: 'orange',
    isDefault: false,
    isDone: false,
  },
  {
    slug: 'done',
    labelKey: 'staff.time_tracking.taskStatuses.defaults.done',
    defaultLabel: 'Done',
    color: 'emerald',
    isDefault: false,
    isDone: true,
  },
] as const

export type DefaultTaskStatusRow = {
  slug: string
  name: string
  color: ProjectColorKey
  position: number
  isDefault: boolean
  isDone: boolean
}

export type TaskStatusLabelTranslate = (key: string, fallback: string) => string

/**
 * Materialises the template into insertable rows: localized names and positions
 * already on the gap grid, so the first drag on a fresh board is a single-row
 * write rather than an immediate compaction.
 */
export function buildDefaultTaskStatusRows(translate: TaskStatusLabelTranslate): DefaultTaskStatusRow[] {
  return DEFAULT_TASK_STATUS_TEMPLATE.map((entry, index) => ({
    slug: entry.slug,
    name: translate(entry.labelKey, entry.defaultLabel),
    color: entry.color,
    position: (index + 1) * STATUS_POSITION_GAP,
    isDefault: entry.isDefault,
    isDone: entry.isDone,
  }))
}
