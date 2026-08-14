"use client"

/**
 * The kept editable grid (T5.4) — project × day cells, typed straight into, saved
 * in one pass.
 *
 * This is the one surface of the old timesheet the redesign keeps, because it is
 * the fastest way in the product to fill a week. The table's markup, column
 * widths, weekend treatment, footer and totals are carried over unchanged; the
 * upgrade is three things and no more:
 *
 *  1. **The shared duration parser.** Cells were a private `decimalToMinutes`
 *     that understood `1.5` and silently answered `0` for `1h 40m`. They are now
 *     `DurationInput`, so the grid understands exactly what the entry dialog, the
 *     inline cell edit and the quick-add rows understand. The look is preserved
 *     by `formatValue={formatTrimmedDecimalDuration}` — 120 minutes renders `2`,
 *     not `2.00` (watch item W3, closed by T4.5 with a test pinning the
 *     divergence from `formatDuration(…, 'decimal')`).
 *
 *     A consequence worth stating: text that does not parse is **kept**, the cell
 *     is flagged, and Save is disabled until it is fixed. The old grid stripped
 *     every character it did not like as you typed.
 *
 *  2. **Rows can be a project or a project + task.** The row-mode toggle splits
 *     each project row into its task-less entries plus one row per task with time
 *     in the period, so grid entries carry `taskId` like every other entry.
 *
 *  3. **Locked cells are read-only**, badged, and never sent. The bulk endpoint
 *     refuses the whole batch with `409 time_entry_locked` naming the offending
 *     ids (T4.2); those ids are marked here so the refusal lands on the cells
 *     that caused it rather than as an opaque batch failure.
 *
 * **Save path — and a defect this task found but must not fix.**
 * `POST …/time-entries/bulk` accepts `taskId` in its schema
 * (`staffTimeEntryBulkItemSchema`) but its handler never reads it: neither the
 * create branch nor the update branch assigns `task_id`. So a task row saved
 * through bulk would report success and drop the task — the same silent-no-op
 * class as T2.11 and T4.9. The bulk route is outside this phase's scope, so the
 * defect is reported rather than fixed, and task-row cells are written through
 * the single-entry CRUD route, which does honour `taskId` (and locks, rounding,
 * access, audit and undo with it). Project rows keep the bulk path unchanged.
 * When bulk learns `taskId`, `saveTaskCells` below collapses into the batch.
 */

import * as React from 'react'
import { Lock, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AddRowDropdown } from '../../../../lib/timesheets-ui/AddRowDropdown'
import { ProjectColorDot } from '../../../../lib/timesheets-ui/ProjectColorDot'
import { DurationInput, formatTrimmedDecimalDuration } from '../../../../lib/time-tracking-ui/DurationInput'
import { readErrorCode, isEntryLockedError } from '../../../../lib/time-tracking-ui/timeEntryListData'
import type { TimesheetEntry } from '../../../../lib/time-tracking-ui/timesheetData'
import { isWeekendIso, parseIsoDay } from '../../../../lib/time-tracking-ui/timesheetPeriod'
import {
  buildTargetKey,
  targetLabel,
  type TimesheetLogTarget,
  type TimesheetProjectRef,
  type TimesheetTaskRef,
} from '../../../../lib/time-tracking-ui/timesheetTargets'

const logger = createLogger('staff').child({ component: 'time-tracking/timesheet/grid' })

const ENTRIES_API_PATH = 'staff/timesheets/time-entries'
const BULK_ENDPOINT = '/api/staff/timesheets/time-entries/bulk'
const RESOURCE_KIND = 'staff.timesheets.time_entry'

export type GridRowMode = 'projects' | 'tasks'

export type GridViewProps = {
  /** Every day column of the current period, in order. */
  days: readonly string[]
  projects: readonly TimesheetProjectRef[]
  allAssignedProjects: readonly TimesheetProjectRef[]
  tasks: readonly TimesheetTaskRef[]
  entries: readonly TimesheetEntry[]
  staffMemberId: string | null
  canManage: boolean
  canManageProjects: boolean
  /** Someone else's timesheet is readable but not editable from the grid. */
  readOnly: boolean
  rowMode: GridRowMode
  onRowModeChange: (mode: GridRowMode) => void
  onAddProject: (project: TimesheetProjectRef) => void | Promise<void>
  onRemoveProject: (project: TimesheetProjectRef) => void | Promise<void>
  onCreateProject: () => void
  onSaved: () => void | Promise<void>
}

type GridRow = TimesheetLogTarget & {
  removable: boolean
}

type GridCell = {
  minutes: number
  entryIds: string[]
  lockedEntryIds: string[]
}

type DirtyCell = {
  rowKey: string
  date: string
  minutes: number
}

function cellKey(rowKey: string, date: string): string {
  return `${rowKey}|${date}`
}

/** The grid's column header: `Mon` over `13`. */
function dayHeaderParts(date: string, locale?: string): { weekday: string; dayOfMonth: string } {
  const parsed = parseIsoDay(date)
  if (!parsed) return { weekday: '', dayOfMonth: date }
  let weekday = ''
  try {
    weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(parsed)
  } catch {
    weekday = ''
  }
  return { weekday, dayOfMonth: String(parsed.getDate()) }
}

export function buildGridRows(
  projects: readonly TimesheetProjectRef[],
  tasks: readonly TimesheetTaskRef[],
  entries: readonly TimesheetEntry[],
  rowMode: GridRowMode,
  extraTaskKeys: ReadonlySet<string>,
): GridRow[] {
  if (rowMode === 'projects') {
    return projects.map((project) => ({
      key: buildTargetKey(project.id, null),
      timeProjectId: project.id,
      taskId: null,
      projectName: project.name,
      projectCode: project.code,
      projectColor: project.color,
      taskTitle: null,
      removable: true,
    }))
  }

  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const usedTaskIds = new Map<string, Set<string>>()
  for (const entry of entries) {
    if (!entry.taskId || !entry.timeProjectId) continue
    const bucket = usedTaskIds.get(entry.timeProjectId) ?? new Set<string>()
    bucket.add(entry.taskId)
    usedTaskIds.set(entry.timeProjectId, bucket)
  }
  for (const key of extraTaskKeys) {
    const separator = key.indexOf(':')
    if (separator < 0) continue
    const projectId = key.slice(0, separator)
    const taskId = key.slice(separator + 1)
    const bucket = usedTaskIds.get(projectId) ?? new Set<string>()
    bucket.add(taskId)
    usedTaskIds.set(projectId, bucket)
  }

  const rows: GridRow[] = []
  for (const project of projects) {
    rows.push({
      key: buildTargetKey(project.id, null),
      timeProjectId: project.id,
      taskId: null,
      projectName: project.name,
      projectCode: project.code,
      projectColor: project.color,
      taskTitle: null,
      removable: true,
    })
    const taskIds = Array.from(usedTaskIds.get(project.id) ?? [])
    const named = taskIds
      .map((taskId) => ({ taskId, title: tasksById.get(taskId)?.title ?? null }))
      .sort((left, right) => (left.title ?? '').localeCompare(right.title ?? ''))
    for (const task of named) {
      rows.push({
        key: buildTargetKey(project.id, task.taskId),
        timeProjectId: project.id,
        taskId: task.taskId,
        projectName: project.name,
        projectCode: project.code,
        projectColor: project.color,
        taskTitle: task.title,
        removable: false,
      })
    }
  }
  return rows
}

export function buildGridCells(
  entries: readonly TimesheetEntry[],
  rowMode: GridRowMode,
): Map<string, GridCell> {
  const cells = new Map<string, GridCell>()
  for (const entry of entries) {
    if (!entry.timeProjectId) continue
    const rowKey =
      rowMode === 'projects'
        ? buildTargetKey(entry.timeProjectId, null)
        : buildTargetKey(entry.timeProjectId, entry.taskId)
    const key = cellKey(rowKey, entry.date)
    const current = cells.get(key) ?? { minutes: 0, entryIds: [], lockedEntryIds: [] }
    current.minutes += Number.isFinite(entry.durationMinutes) ? entry.durationMinutes : 0
    current.entryIds.push(entry.id)
    if (entry.isLocked) current.lockedEntryIds.push(entry.id)
    cells.set(key, current)
  }
  return cells
}

export function GridView({
  days,
  projects,
  allAssignedProjects,
  tasks,
  entries,
  staffMemberId,
  canManage,
  canManageProjects,
  readOnly,
  rowMode,
  onRowModeChange,
  onAddProject,
  onRemoveProject,
  onCreateProject,
  onSaved,
}: GridViewProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [dirty, setDirty] = React.useState<Record<string, DirtyCell>>({})
  const [invalidCells, setInvalidCells] = React.useState<Record<string, true>>({})
  const [extraLockedEntryIds, setExtraLockedEntryIds] = React.useState<Record<string, true>>({})
  const [extraTaskKeys, setExtraTaskKeys] = React.useState<Set<string>>(() => new Set())
  const [isSaving, setIsSaving] = React.useState(false)

  const mutationContextId = staffMemberId ? `staff-timesheets:${staffMemberId}` : 'staff-timesheets:pending'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    staffMemberId: string | null
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const mutationContext = React.useCallback(
    (resourceId?: string) => ({
      formId: mutationContextId,
      resourceKind: RESOURCE_KIND,
      resourceId,
      staffMemberId,
      retryLastMutation,
    }),
    [mutationContextId, retryLastMutation, staffMemberId],
  )

  const rows = React.useMemo(
    () => buildGridRows(projects, tasks, entries, rowMode, extraTaskKeys),
    [entries, extraTaskKeys, projects, rowMode, tasks],
  )
  const cells = React.useMemo(() => buildGridCells(entries, rowMode), [entries, rowMode])
  const rowsByKey = React.useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows])

  // A fresh period, a different person or a row-mode switch invalidates every
  // pending edit: the cells they belong to are no longer on screen.
  const resetToken = `${rowMode}|${days[0] ?? ''}|${days[days.length - 1] ?? ''}|${staffMemberId ?? ''}`
  const resetTokenRef = React.useRef(resetToken)
  React.useEffect(() => {
    if (resetTokenRef.current === resetToken) return
    resetTokenRef.current = resetToken
    setDirty({})
    setInvalidCells({})
  }, [resetToken])

  const isCellLocked = React.useCallback(
    (key: string) => {
      const cell = cells.get(key)
      if (!cell) return false
      if (cell.lockedEntryIds.length > 0) return true
      return cell.entryIds.some((id) => extraLockedEntryIds[id])
    },
    [cells, extraLockedEntryIds],
  )

  const cellMinutes = React.useCallback(
    (key: string) => {
      const pending = dirty[key]
      if (pending) return pending.minutes
      return cells.get(key)?.minutes ?? 0
    },
    [cells, dirty],
  )

  const handleCellChange = React.useCallback(
    (row: GridRow, date: string, minutes: number | null, invalid: boolean) => {
      const key = cellKey(row.key, date)
      setInvalidCells((current) => {
        if (invalid === Boolean(current[key])) return current
        const next = { ...current }
        if (invalid) next[key] = true
        else delete next[key]
        return next
      })
      // Unparseable text is never turned into a number — the previous value stands
      // and Save stays blocked until the text is fixed or cleared.
      if (invalid) return
      const nextMinutes = minutes ?? 0
      const stored = cells.get(key)
      const storedMinutes = stored?.minutes ?? 0
      const hadEntries = (stored?.entryIds.length ?? 0) > 0
      setDirty((current) => {
        const next = { ...current }
        if (nextMinutes === storedMinutes && !hadEntries) {
          delete next[key]
          return next
        }
        next[key] = { rowKey: row.key, date, minutes: nextMinutes }
        return next
      })
    },
    [cells],
  )

  const rowTotal = React.useCallback(
    (rowKey: string) => days.reduce((sum, date) => sum + cellMinutes(cellKey(rowKey, date)), 0),
    [cellMinutes, days],
  )
  const dayTotal = React.useCallback(
    (date: string) => rows.reduce((sum, row) => sum + cellMinutes(cellKey(row.key, date)), 0),
    [cellMinutes, rows],
  )
  const grandTotal = React.useMemo(
    () => rows.reduce((sum, row) => sum + rowTotal(row.key), 0),
    [rowTotal, rows],
  )

  const dirtyCount = Object.keys(dirty).length
  const invalidCount = Object.keys(invalidCells).length
  const hasChanges = dirtyCount > 0
  const dense = days.length > 10

  const markLockedFromError = React.useCallback((error: unknown) => {
    const body = (error as { body?: { lockedEntryIds?: unknown } } | null)?.body
    const direct = (error as { lockedEntryIds?: unknown } | null)?.lockedEntryIds
    const ids = Array.isArray(body?.lockedEntryIds)
      ? body?.lockedEntryIds
      : Array.isArray(direct)
        ? direct
        : []
    const marked = ids.filter((id): id is string => typeof id === 'string')
    if (marked.length === 0) return false
    setExtraLockedEntryIds((current) => {
      const next = { ...current }
      for (const id of marked) next[id] = true
      return next
    })
    return true
  }, [])

  const reportSaveFailure = React.useCallback(
    (error: unknown) => {
      if (surfaceRecordConflict(error, t)) return
      if (isEntryLockedError(error)) {
        markLockedFromError(error)
        flash(
          t(
            'staff.time_tracking.timesheet.grid.errors.locked',
            'Some of these cells belong to a closed report and cannot be changed. They are now marked as locked.',
          ),
          'error',
        )
        return
      }
      logger.error('staff.time_tracking.timesheet.grid save failed', { err: error, code: readErrorCode(error) })
      flash(t('staff.timesheets.my.errors.save', 'Failed to save timesheets.'), 'error')
    },
    [markLockedFromError, t],
  )

  /**
   * Task-row cells, one write each through the single-entry route — see the file
   * header for why they cannot ride the batch yet. A locked cell never reaches
   * here (its input is read-only), so a 409 from this path means the entry was
   * frozen after the page loaded, which is exactly when the user needs to be
   * told which cell it was.
   */
  const saveTaskCells = React.useCallback(
    async (changes: Array<{ row: GridRow; cell: DirtyCell }>) => {
      for (const { row, cell } of changes) {
        const key = cellKey(row.key, cell.date)
        const existingId = cells.get(key)?.entryIds[0] ?? null
        const errorMessage = t('staff.timesheets.my.errors.save', 'Failed to save timesheets.')
        if (existingId && cell.minutes <= 0) {
          await runMutation({
            operation: () => deleteCrud(ENTRIES_API_PATH, existingId, { errorMessage }),
            context: mutationContext(existingId),
            mutationPayload: { id: existingId },
          })
          continue
        }
        if (cell.minutes <= 0) continue
        if (existingId) {
          const payload = { id: existingId, durationMinutes: cell.minutes }
          await runMutation({
            operation: () => updateCrud(ENTRIES_API_PATH, payload, { errorMessage }),
            context: mutationContext(existingId),
            mutationPayload: payload,
          })
          continue
        }
        const payload = {
          staffMemberId,
          date: cell.date,
          timeProjectId: row.timeProjectId,
          taskId: row.taskId,
          durationMinutes: cell.minutes,
          source: 'manual',
        }
        await runMutation({
          operation: () => createCrud(ENTRIES_API_PATH, payload, { errorMessage }),
          context: mutationContext(),
          mutationPayload: payload,
        })
      }
    },
    [cells, mutationContext, runMutation, staffMemberId, t],
  )

  const handleSave = React.useCallback(async () => {
    if (!hasChanges || invalidCount > 0) return
    const confirmed = await confirm({
      title: t('staff.timesheets.my.confirm_save.title', 'Save changes?'),
      text: t('staff.timesheets.my.confirm_save.body', 'Your timesheet entries will be saved.'),
    })
    if (!confirmed) return

    const bulkEntries: Array<{ id?: string; date: string; timeProjectId: string; durationMinutes: number }> = []
    const taskChanges: Array<{ row: GridRow; cell: DirtyCell }> = []
    for (const cell of Object.values(dirty)) {
      const row = rowsByKey.get(cell.rowKey)
      if (!row) continue
      if (row.taskId) {
        taskChanges.push({ row, cell })
        continue
      }
      const key = cellKey(row.key, cell.date)
      bulkEntries.push({
        id: cells.get(key)?.entryIds[0],
        date: cell.date,
        timeProjectId: row.timeProjectId,
        durationMinutes: cell.minutes,
      })
    }
    if (bulkEntries.length === 0 && taskChanges.length === 0) return

    setIsSaving(true)
    try {
      if (bulkEntries.length > 0) {
        const payload = { entries: bulkEntries }
        await runMutation({
          operation: () =>
            apiCallOrThrow(BULK_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            }),
          context: mutationContext(staffMemberId ?? undefined),
          mutationPayload: payload as unknown as Record<string, unknown>,
        })
      }
      if (taskChanges.length > 0) await saveTaskCells(taskChanges)
      setDirty({})
      flash(t('staff.timesheets.my.saved', 'Timesheet saved.'), 'success')
      await onSaved()
    } catch (error) {
      reportSaveFailure(error)
    } finally {
      setIsSaving(false)
    }
  }, [
    cells,
    confirm,
    dirty,
    hasChanges,
    invalidCount,
    mutationContext,
    onSaved,
    reportSaveFailure,
    rowsByKey,
    runMutation,
    saveTaskCells,
    staffMemberId,
    t,
  ])

  const taskRowOptions = React.useMemo(() => {
    const visibleProjectIds = new Set(projects.map((project) => project.id))
    const existing = new Set(rows.map((row) => row.key))
    return tasks
      .filter((task) => visibleProjectIds.has(task.timeProjectId))
      .map((task) => {
        const project = projects.find((candidate) => candidate.id === task.timeProjectId)!
        return {
          key: buildTargetKey(task.timeProjectId, task.id),
          label: targetLabel({
            key: buildTargetKey(task.timeProjectId, task.id),
            timeProjectId: task.timeProjectId,
            taskId: task.id,
            projectName: project.name,
            projectCode: project.code,
            projectColor: project.color,
            taskTitle: task.title,
          }),
        }
      })
      .filter((option) => !existing.has(option.key))
  }, [projects, rows, tasks])

  const editable = canManage && !readOnly

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={rowMode}
          onValueChange={(value) => {
            if (value !== rowMode) onRowModeChange(value as GridRowMode)
          }}
          size="sm"
          aria-label={t('staff.time_tracking.timesheet.grid.rowMode.label', 'Grid rows')}
        >
          <SegmentedControlItem value="projects">
            {t('staff.time_tracking.timesheet.grid.rowMode.projects', 'Projects')}
          </SegmentedControlItem>
          <SegmentedControlItem value="tasks">
            {t('staff.time_tracking.timesheet.grid.rowMode.tasks', 'Projects + tasks')}
          </SegmentedControlItem>
        </SegmentedControl>

        <div className="flex items-center gap-3">
          {invalidCount > 0 ? (
            <span className="text-xs font-medium text-status-error-text">
              {t('staff.time_tracking.timesheet.grid.invalid', 'Fix the highlighted cell before saving.')}
            </span>
          ) : hasChanges ? (
            <span className="text-xs font-medium text-status-warning-text">
              {t('staff.timesheets.my.unsaved', 'Unsaved changes')}
            </span>
          ) : null}
          {editable ? (
            <Button
              size="sm"
              type="button"
              onClick={() => void handleSave()}
              disabled={!hasChanges || invalidCount > 0 || isSaving}
            >
              {isSaving
                ? t('staff.timesheets.my.saving', 'Saving...')
                : t('staff.timesheets.my.save_changes', 'Save Changes')}
            </Button>
          ) : null}
        </div>
      </div>

      {rowMode === 'tasks' && editable && taskRowOptions.length > 0 ? (
        <div className="flex items-center gap-2">
          <Select
            value=""
            onValueChange={(value) => setExtraTaskKeys((current) => new Set(current).add(value))}
          >
            <SelectTrigger
              className="w-72"
              aria-label={t('staff.time_tracking.timesheet.grid.addTaskRow', 'Add a task row')}
            >
              <SelectValue placeholder={t('staff.time_tracking.timesheet.grid.addTaskRow', 'Add a task row')} />
            </SelectTrigger>
            <SelectContent>
              {taskRowOptions.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className={dense ? 'w-[140px] min-w-[140px]' : 'w-[35%]'} />
            {days.map((date) => (
              <col key={date} className={dense ? 'w-[36px] min-w-[36px]' : ''} />
            ))}
            <col className={dense ? 'w-[56px] min-w-[56px]' : 'w-[72px]'} />
          </colgroup>
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-medium">
                {t('staff.timesheets.my.project', 'Project')}
              </th>
              {days.map((date) => {
                const { weekday, dayOfMonth } = dayHeaderParts(date)
                const weekend = isWeekendIso(date)
                return (
                  <th
                    key={date}
                    className={cn(
                      'py-2 text-center font-medium px-1',
                      weekend ? 'bg-muted/80 text-muted-foreground' : null,
                    )}
                  >
                    <div className="text-xs uppercase text-muted-foreground">{weekday}</div>
                    <div className="text-xs">{dayOfMonth}</div>
                  </th>
                )
              })}
              <th className="px-3 py-2 text-right font-medium">{t('staff.timesheets.my.total', 'Total')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="group border-b hover:bg-muted/30">
                <td
                  className={cn(
                    'sticky left-0 z-10 bg-background px-3 py-1.5 font-medium text-foreground',
                    row.taskId ? 'pl-6' : null,
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate" title={targetLabel(row)}>
                        {row.taskId ? null : (
                          <ProjectColorDot colorKey={row.projectColor} projectName={row.projectName} size="sm" />
                        )}
                        <span className="truncate">{row.taskId ? row.taskTitle ?? targetLabel(row) : row.projectName}</span>
                      </div>
                      {row.taskId ? (
                        <div className="text-xs text-muted-foreground truncate">{row.projectName}</div>
                      ) : row.projectCode ? (
                        <div className="text-xs text-muted-foreground">{row.projectCode}</div>
                      ) : null}
                    </div>
                    {row.removable && editable ? (
                      <button
                        type="button"
                        onClick={() => {
                          const project = projects.find((candidate) => candidate.id === row.timeProjectId)
                          if (project) void onRemoveProject(project)
                        }}
                        aria-label={t('staff.timesheets.my.removeRow', 'Remove from grid')}
                        title={t('staff.timesheets.my.removeRow', 'Remove from grid')}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-opacity"
                      >
                        <X className="size-3.5" />
                      </button>
                    ) : null}
                  </div>
                </td>
                {days.map((date) => {
                  const key = cellKey(row.key, date)
                  const weekend = isWeekendIso(date)
                  const minutes = cellMinutes(key)
                  const locked = isCellLocked(key)
                  const isDirty = dirty[key] !== undefined
                  const isInvalid = Boolean(invalidCells[key])
                  return (
                    <td
                      key={date}
                      className={cn(
                        'px-0.5 py-0.5',
                        weekend ? 'bg-muted/40' : null,
                        // The old grid tinted the input itself amber; the border and
                        // background of a `DurationInput` belong to the primitive, so
                        // the pending-edit cue moved to the cell — same signal, DS
                        // status tokens instead of raw `amber-*` (Boy Scout rule).
                        isInvalid
                          ? 'bg-status-error-bg'
                          : isDirty
                            ? 'bg-status-warning-bg'
                            : null,
                      )}
                    >
                      {weekend && minutes === 0 ? (
                        <div className="rounded px-1 py-1 text-center text-xs text-muted-foreground/50">-</div>
                      ) : locked || !editable ? (
                        <div
                          className="flex items-center justify-center gap-1 rounded px-1 py-1 text-center text-xs tabular-nums text-muted-foreground"
                          title={
                            locked
                              ? t(
                                  'staff.time_tracking.timesheet.grid.lockedCell',
                                  'Locked by a closed report',
                                )
                              : undefined
                          }
                        >
                          {locked ? <Lock className="size-3 shrink-0" aria-hidden="true" /> : null}
                          <span>{formatTrimmedDecimalDuration(minutes) || '-'}</span>
                        </div>
                      ) : (
                        <DurationInput
                          variant="compact"
                          inputSize="sm"
                          value={minutes > 0 ? minutes : null}
                          formatValue={formatTrimmedDecimalDuration}
                          onChange={(nextMinutes, state) =>
                            handleCellChange(row, date, nextMinutes, state.status === 'invalid')
                          }
                          placeholder={t('staff.timesheets.my.durationPlaceholder', '0')}
                          ariaLabel={`${targetLabel(row)} · ${date}`}
                          className={cn('mx-auto', dense ? 'w-10' : 'w-16')}
                          inputClassName={cn(
                            'text-center px-1 tabular-nums',
                            dense ? 'text-xs' : null,
                            minutes > 0 ? 'font-semibold' : 'text-muted-foreground',
                          )}
                        />
                      )}
                    </td>
                  )
                })}
                <td className="px-3 py-1.5 text-right font-semibold text-xs tabular-nums">
                  {formatTrimmedDecimalDuration(rowTotal(row.key)) || '0'}
                </td>
              </tr>
            ))}
            {editable ? (
              <tr className="border-b">
                <td colSpan={days.length + 2} className="sticky left-0 bg-background px-1 py-0.5">
                  <AddRowDropdown
                    assignedProjects={allAssignedProjects.map((project) => ({
                      id: project.id,
                      name: project.name,
                      code: project.code,
                      color: project.color,
                    }))}
                    visibleProjectIds={new Set(projects.map((project) => project.id))}
                    canCreateProject={canManageProjects}
                    onAddProject={(project) => {
                      void onAddProject({
                        id: project.id,
                        name: project.name,
                        code: project.code ?? null,
                        color: project.color ?? null,
                      })
                    }}
                    onCreateProject={onCreateProject}
                  />
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/50 font-semibold">
              <td className="sticky left-0 z-10 bg-muted px-3 py-2">
                {t('staff.timesheets.my.daily_total', 'Daily Total')}
              </td>
              {days.map((date) => {
                const weekend = isWeekendIso(date)
                const minutes = dayTotal(date)
                return (
                  <td
                    key={date}
                    className={cn(
                      'py-2 text-center text-xs tabular-nums',
                      weekend ? 'text-muted-foreground/50' : null,
                    )}
                  >
                    {weekend && minutes === 0 ? '-' : formatTrimmedDecimalDuration(minutes) || '-'}
                  </td>
                )
              })}
              <td className="px-3 py-2 text-right tabular-nums font-semibold">
                {formatTrimmedDecimalDuration(grandTotal) || '0'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {rows.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">
          {t('staff.time_tracking.timesheet.grid.noRows', 'Add a project row to start filling the grid.')}
        </p>
      ) : null}

      {ConfirmDialogElement}
    </div>
  )
}
