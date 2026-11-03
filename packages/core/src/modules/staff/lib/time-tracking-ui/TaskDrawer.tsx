"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@open-mercato/ui/primitives/drawer'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import { Progress } from '@open-mercato/ui/primitives/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import {
  buildOptimisticLockHeader,
  extractOptimisticLockConflict,
  extractRecordLockConflict,
} from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { formatCurrency, formatDate } from '@open-mercato/ui/utils/format'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { TaskCommentThread, type CommentVisibility } from './TaskCommentThread'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { SupportRequestPanel } from './SupportRequestPanel'
import { SupportAttachmentsSection } from './SupportAttachmentsSection'
import { readSupportTicket, SUPPORT_ACTIVITY_EVENT, type SupportTicketView } from './supportTicketData'
import { TaskQuickLog, type QuickLogSubmission } from './TaskQuickLog'
import { TagPicker, tagChipStyle } from './TagPicker'
import { slugifyProjectName } from '../time-tracking/projectCode'
import type { TagOption } from './timeEntryDialogState'
import {
  computeSubtaskProgress,
  formatBoardMinutes,
  readItems,
  readString,
  readTotal,
  sortByPosition,
  toBoardStatus,
  toBoardTask,
  type BoardApiRow,
  type BoardStatus,
  type BoardTask,
} from './kanbanBoardData'
import {
  childMinutes,
  formatElapsed,
  formatSplitMinutes,
  resolveDefaultStatusId,
  resolveDoneStatusId,
  summarizeEntries,
  toDrawerComment,
  toDrawerEntry,
  todayIsoDate,
  buildEntryClocks,
  isAssignmentEventForTask,
  TASK_ASSIGNMENT_CHANGED_EVENT,
  TASK_DRAWER_QUERY_ROOT,
  type DrawerComment,
  type DrawerEntry,
} from './taskDrawerData'

const logger = createLogger('staff').child({ component: 'TaskDrawer' })

const TASK_ENTITY_ID = 'staff:staff_time_task'

type TaskDetailInjectionContext = {
  entityId: string
  recordId: string
  taskId: string
  timeProjectId: string | null
  retryLastMutation: () => Promise<boolean>
}

export const TASK_DRAWER_MUTATION_CONTEXT_ID = 'staff.time_tracking.task_drawer'

/**
 * The drawer's writes carry no `resourceKind`/`resourceId`, so the enterprise
 * record-lock widget leaves them alone: every property saves on its own (the
 * spec's per-field saves), and the `updated_at` version each save sends is what
 * guards concurrent edits. A lock taken per save, never released and never
 * resolvable from here, could only block the user (#8045, #8101). The `formId`
 * is still scoped to the task so no guarded-mutation state crosses tasks.
 */
function taskDrawerFormId(taskId: string): string {
  return `${TASK_DRAWER_MUTATION_CONTEXT_ID}:${taskId}`
}

const ASSIGNMENT_RACE_CODES = new Set(['task_already_claimed', 'task_assignment_changed'])

function isAssignmentRace(error: unknown): boolean {
  if (extractOptimisticLockConflict(error) || extractRecordLockConflict(error)) return true
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && ASSIGNMENT_RACE_CODES.has(code)
}
export const RATES_FEATURE = 'staff.timesheets.rates.view'
export const TASKS_MANAGE_FEATURE = 'staff.timesheets.tasks.manage'
export const ENTRIES_LIST_PATH = '/backend/staff/time-tracking/entries'

const DRAWER_QUERY_ROOT = TASK_DRAWER_QUERY_ROOT
const DIRECTORY_PAGE_SIZE = 100
const CHILD_PAGE_SIZE = 100
const COMMENT_PAGE_SIZE = 50
const ENTRY_PAGE_SIZE = 100
/** Bounded sweep: the entries route has no `taskId` filter (see the docblock). */
const MAX_ENTRY_PAGES = 3
const RECENT_ENTRY_COUNT = 5
const ELAPSED_TICK_MS = 1000

export type TaskDrawerProps = {
  taskId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Shown in the header line next to the created date; the host already knows it. */
  projectName?: string | null
  /** `?panel=time` — "Add time" on a board card lands with the quick log focused. */
  focusPanel?: string | null
  /** Lets the host (the board) refetch after a write that changed hours or status. */
  onChanged?: () => void
}

type TaskAssignmentAbility = { canClaim: boolean; canRelease: boolean }

type LoadedTask = {
  task: BoardTask
  createdAt: string | null
  support: SupportTicketView | null
  assignment: TaskAssignmentAbility
}

function readTaskAssignmentAbility(row: BoardApiRow): TaskAssignmentAbility {
  const block = (row as Record<string, unknown>)._staffAssignment
  if (!block || typeof block !== 'object') return { canClaim: false, canRelease: false }
  const ability = block as Record<string, unknown>
  return { canClaim: ability.canClaim === true, canRelease: ability.canRelease === true }
}

type RunningTimer = { entryId: string | null; taskId: string | null; startedAt: string | null }

type ProjectEntries = { rows: BoardApiRow[]; partial: boolean }

async function fetchProjectEntries(projectId: string): Promise<ProjectEntries> {
  const rows: BoardApiRow[] = []
  for (let page = 1; page <= MAX_ENTRY_PAGES; page += 1) {
    const call = await apiCall<Record<string, unknown>>(
      `/api/staff/timesheets/time-entries?projectId=${encodeURIComponent(projectId)}&page=${page}&pageSize=${ENTRY_PAGE_SIZE}&sortField=date&sortDir=desc`,
    )
    if (!call.ok) return { rows, partial: true }
    const items = readItems(call.result)
    rows.push(...items)
    if (items.length < ENTRY_PAGE_SIZE) return { rows, partial: false }
    if (rows.length >= readTotal(call.result, rows.length)) return { rows, partial: false }
  }
  return { rows, partial: true }
}

/**
 * The task drawer of screen 7 (T3.7, US-C3/C4/C5, US-D4).
 *
 * Four decisions carry the design intent:
 *
 *  1. **Subtasks are child tasks, and ticking one is a status move** (D-2, and
 *     the decision that supersedes the mockup's note 4). There is no boolean on
 *     a task, so the checkbox PATCHes the child to the project's first `is_done`
 *     column and un-ticking returns it to the `is_default` one. Each row carries
 *     its own assignee and its own hours because a subtask holds time like any
 *     other task; the parent's headline is the inclusive rollup that already
 *     contains them.
 *  2. **Depth is capped at one.** A child task's drawer renders no subtask
 *     section at all: the server answers `400 subtask_depth_exceeded`, so an
 *     "add subtask" affordance there could only ever fail.
 *  3. **Properties save per field, so each write carries its own version.** A
 *     blur PATCHes with `buildOptimisticLockHeader(versionRef.current)` and then refreshes
 *     the token — from the status route's `updatedAt` when it returns one, by
 *     refetching the row when it does not (the CRUD update answers `{ok:true}`).
 *     Saves are chained on `saveChainRef` so the second field never leaves with
 *     the version the first one just invalidated.
 *  4. **One timer at a time** (note 2, US-D4). Starting here while a timer runs
 *     on another task asks first, then stops that one before starting this one.
 *
 * Two known gaps, both other tasks' work, are handled honestly rather than faked:
 * the task projection carries no tag ids yet (T3.10), so the tag row can add but
 * cannot list what the server already has; and the entries route has no `taskId`
 * filter, so the recent-entries list and the billable split come from a bounded
 * sweep of the project's entries and say so when the bound is hit.
 */
export function TaskDrawer({
  taskId,
  open,
  onOpenChange,
  projectName,
  focusPanel,
  onChanged,
}: TaskDrawerProps) {
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const { payload } = useBackendChrome()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const canSeeMoney = hasFeature(payload?.grantedFeatures, RATES_FEATURE)
  const canManage = hasFeature(payload?.grantedFeatures, TASKS_MANAGE_FEATURE)

  const [tagIds, setTagIds] = React.useState<string[]>([])
  const [subtaskDraft, setSubtaskDraft] = React.useState('')
  const [composingSubtask, setComposingSubtask] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [timerBusy, setTimerBusy] = React.useState(false)
  const [now, setNow] = React.useState(() => Date.now())

  const saveChainRef = React.useRef<Promise<void>>(Promise.resolve())
  /**
   * The lock token lives in a ref, not in state: a save queued behind another one
   * must read the version at the moment it *runs*, not the one its closure was
   * built with, or a second blur landing before a re-render would still leave
   * with the token the first blur just invalidated.
   */
  const versionRef = React.useRef<string | null>(null)
  const [notice, setNotice] = React.useState<{ status: 'warning' | 'error'; message: string } | null>(null)

  const { runMutation: runGuardedMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: TASK_DRAWER_MUTATION_CONTEXT_ID,
    blockedMessage: t('staff.time_tracking.taskDrawer.properties.saveError', 'Could not save the change.'),
  })
  const runMutation = React.useCallback<typeof runGuardedMutation>(
    (input) => {
      setNotice(null)
      return runGuardedMutation(input)
    },
    [runGuardedMutation],
  )

  const taskQuery = useQuery<LoadedTask | null>({
    queryKey: [...DRAWER_QUERY_ROOT, 'task', `scope:${scopeVersion}`, taskId],
    enabled: open && taskId.length > 0,
    staleTime: 5_000,
    queryFn: async () => {
      const call = await apiCall<Record<string, unknown>>(
        `/api/staff/timesheets/tasks?id=${encodeURIComponent(taskId)}&pageSize=1`,
      )
      if (!call.ok) throw new Error('[internal] task request failed')
      const row = readItems(call.result)[0]
      if (!row) return null
      const parsed = toBoardTask(row)
      return parsed
        ? {
            task: parsed,
            createdAt: readString(row, 'created_at', 'createdAt'),
            support: readSupportTicket(row),
            assignment: readTaskAssignmentAbility(row),
          }
        : null
    },
  })

  const task = taskQuery.data?.task ?? null
  const createdAt = taskQuery.data?.createdAt ?? null
  const support = taskQuery.data?.support ?? null
  const projectId = task?.timeProjectId ?? null

  const taskInjectionContext = React.useMemo<TaskDetailInjectionContext>(
    () => ({
      entityId: TASK_ENTITY_ID,
      recordId: taskId,
      taskId,
      timeProjectId: projectId,
      retryLastMutation,
    }),
    [projectId, retryLastMutation, taskId],
  )
  const isChildTask = !!task?.parentTaskId

  React.useEffect(() => {
    if (!task) return
    versionRef.current = task.updatedAt
    setTagIds(task.tagIds)
  }, [task])

  React.useEffect(() => {
    setNotice(null)
  }, [taskId])

  const statusesQuery = useQuery<BoardStatus[]>({
    queryKey: [...DRAWER_QUERY_ROOT, 'statuses', `scope:${scopeVersion}`, projectId ?? 'none'],
    enabled: open && !!projectId,
    staleTime: 30_000,
    queryFn: async () => {
      if (!projectId) return []
      const call = await apiCall<Record<string, unknown>>(
        `/api/staff/timesheets/task-statuses?timeProjectId=${encodeURIComponent(projectId)}&page=1&pageSize=${DIRECTORY_PAGE_SIZE}&sortField=position&sortDir=asc`,
      )
      if (!call.ok) return []
      const statuses = readItems(call.result)
        .map(toBoardStatus)
        .filter((status): status is BoardStatus => status !== null)
      return sortByPosition(statuses)
    },
  })

  const statuses = React.useMemo(() => statusesQuery.data ?? [], [statusesQuery.data])

  const childrenQuery = useQuery<BoardTask[]>({
    queryKey: [...DRAWER_QUERY_ROOT, 'children', `scope:${scopeVersion}`, taskId],
    enabled: open && !isChildTask && !!task,
    staleTime: 10_000,
    queryFn: async () => {
      const call = await apiCall<Record<string, unknown>>(
        `/api/staff/timesheets/tasks?parentTaskId=${encodeURIComponent(taskId)}&page=1&pageSize=${CHILD_PAGE_SIZE}&sortField=position&sortDir=asc`,
      )
      if (!call.ok) return []
      const rows = readItems(call.result)
        .map(toBoardTask)
        .filter((row): row is BoardTask => row !== null)
      return sortByPosition(rows)
    },
  })

  const children = React.useMemo(() => childrenQuery.data ?? [], [childrenQuery.data])

  const commentsQuery = useQuery<DrawerComment[]>({
    queryKey: [...DRAWER_QUERY_ROOT, 'comments', `scope:${scopeVersion}`, taskId],
    enabled: open && taskId.length > 0,
    staleTime: 10_000,
    queryFn: async () => {
      const call = await apiCall<Record<string, unknown>>(
        `/api/staff/timesheets/tasks/${encodeURIComponent(taskId)}/comments?page=1&pageSize=${COMMENT_PAGE_SIZE}`,
      )
      if (!call.ok) throw new Error('[internal] comments request failed')
      return readItems(call.result)
        .map(toDrawerComment)
        .filter((comment): comment is DrawerComment => comment !== null)
    },
  })

  const entriesQuery = useQuery<ProjectEntries>({
    queryKey: [...DRAWER_QUERY_ROOT, 'entries', `scope:${scopeVersion}`, projectId ?? 'none'],
    enabled: open && !!projectId,
    staleTime: 10_000,
    queryFn: async () => (projectId ? fetchProjectEntries(projectId) : { rows: [], partial: false }),
  })

  const selfQuery = useQuery<string | null>({
    queryKey: [...DRAWER_QUERY_ROOT, 'self', `scope:${scopeVersion}`],
    enabled: open,
    staleTime: 300_000,
    queryFn: async () => {
      const call = await apiCall<{ member?: { id?: string | null } | null }>('/api/staff/team-members/self')
      return call.ok ? call.result?.member?.id ?? null : null
    },
  })

  const selfStaffMemberId = selfQuery.data ?? null

  const membersQuery = useQuery<{ id: string; name: string }[]>({
    queryKey: [...DRAWER_QUERY_ROOT, 'members', `scope:${scopeVersion}`],
    enabled: open,
    staleTime: 300_000,
    queryFn: async () => {
      const call = await apiCall<Record<string, unknown>>(
        `/api/staff/team-members?page=1&pageSize=${DIRECTORY_PAGE_SIZE}&isActive=true`,
      )
      if (!call.ok) return []
      return readItems(call.result)
        .map((row) => {
          const id = readString(row, 'id')
          if (!id) return null
          return { id, name: readString(row, 'display_name', 'displayName') ?? id }
        })
        .filter((member): member is { id: string; name: string } => member !== null)
    },
  })

  const members = React.useMemo(() => membersQuery.data ?? [], [membersQuery.data])

  const memberNames = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const member of members) map.set(member.id, member.name)
    return map
  }, [members])

  const tagsQuery = useQuery<TagOption[]>({
    queryKey: [...DRAWER_QUERY_ROOT, 'tags', `scope:${scopeVersion}`],
    enabled: open,
    staleTime: 300_000,
    queryFn: async () => {
      const call = await apiCall<Record<string, unknown>>(
        `/api/staff/timesheets/tags?page=1&pageSize=${DIRECTORY_PAGE_SIZE}&sortField=label&sortDir=asc`,
      )
      if (!call.ok) return []
      return readItems(call.result)
        .map((row) => {
          const id = readString(row, 'id')
          if (!id) return null
          // The colour has to travel with the tag or the drawer's chips render
          // grey while the entry dialog's render tinted from the same rows.
          return { id, label: readString(row, 'label') ?? id, color: readString(row, 'color') }
        })
        .filter((tag): tag is TagOption => tag !== null)
    },
  })

  const tagOptions = React.useMemo(() => tagsQuery.data ?? [], [tagsQuery.data])

  const runningTimerQuery = useQuery<RunningTimer>({
    queryKey: [...DRAWER_QUERY_ROOT, 'running-timer', `scope:${scopeVersion}`, selfStaffMemberId ?? 'none'],
    enabled: open && !!selfStaffMemberId,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!selfStaffMemberId) return { entryId: null, taskId: null, startedAt: null }
      const call = await apiCall<Record<string, unknown>>(
        `/api/staff/timesheets/time-entries?staffMemberId=${encodeURIComponent(selfStaffMemberId)}&running=true&pageSize=${ENTRY_PAGE_SIZE}`,
      )
      if (!call.ok) return { entryId: null, taskId: null, startedAt: null }
      for (const row of readItems(call.result)) {
        const startedAt = readString(row, 'started_at', 'startedAt')
        const endedAt = readString(row, 'ended_at', 'endedAt')
        if (!startedAt || endedAt) continue
        return {
          entryId: readString(row, 'id'),
          taskId: readString(row, 'task_id', 'taskId'),
          startedAt,
        }
      }
      return { entryId: null, taskId: null, startedAt: null }
    },
  })

  const runningTimer = runningTimerQuery.data ?? { entryId: null, taskId: null, startedAt: null }
  const timerRunningHere = !!runningTimer.entryId && runningTimer.taskId === taskId

  React.useEffect(() => {
    if (!open || !timerRunningHere) return
    const handle = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS)
    return () => clearInterval(handle)
  }, [open, timerRunningHere])

  const doneStatusIds = React.useMemo(
    () => new Set(statuses.filter((status) => status.isDone).map((status) => status.id)),
    [statuses],
  )

  // `doneChildCount` does not exist on the API yet, so the drawer derives it the
  // way the board does — from the children it already fetched for the list. One
  // extra page of rows per open, no extra request.
  const progress = React.useMemo(
    () => computeSubtaskProgress(children, doneStatusIds).get(taskId) ?? { total: 0, done: 0 },
    [children, doneStatusIds, taskId],
  )

  const subtaskTotal = Math.max(progress.total, task?.childCount ?? 0)

  const taskIdsForEntries = React.useMemo(() => {
    const ids = new Set<string>([taskId])
    for (const child of children) ids.add(child.id)
    return ids
  }, [children, taskId])

  const entries = React.useMemo<DrawerEntry[]>(() => {
    const rows = entriesQuery.data?.rows ?? []
    return rows
      .map(toDrawerEntry)
      .filter((entry): entry is DrawerEntry => entry !== null && !!entry.taskId && taskIdsForEntries.has(entry.taskId))
  }, [entriesQuery.data, taskIdsForEntries])

  const totals = React.useMemo(
    () => summarizeEntries(entries, entriesQuery.data?.partial ?? false),
    [entries, entriesQuery.data],
  )

  const invalidate = React.useCallback(
    (part: 'task' | 'children' | 'entries' | 'comments' | 'attachments') => {
      queryClient.invalidateQueries({ queryKey: [...DRAWER_QUERY_ROOT, part] }).catch(() => {})
    },
    [queryClient],
  )

  const refreshVersion = React.useCallback(async (): Promise<void> => {
    const refreshed = await taskQuery.refetch()
    const updatedAt = refreshed.data?.task.updatedAt ?? null
    if (updatedAt) versionRef.current = updatedAt
  }, [taskQuery])

  /**
   * A failed save is reported inside the drawer, which covers the page-level
   * conflict bar. It is a conflict when the server says so, or when the task
   * moved underneath the save (a guard can refuse it before any request leaves);
   * either way the drawer refetches, so the next attempt starts from what it shows.
   */
  const reportError = React.useCallback(
    (error: unknown, fallback: string) => {
      const conflictNotice = {
        status: 'warning' as const,
        message: t(
          'staff.time_tracking.taskDrawer.conflict',
          'Someone else changed this task. It now shows the latest version. Check it and try again.',
        ),
      }
      const seenVersion = versionRef.current
      invalidate('children')
      if (surfaceRecordConflict(error, t)) {
        setNotice(conflictNotice)
        invalidate('task')
        return
      }
      logger.error('staff.time_tracking task drawer mutation failed', { err: error })
      setNotice({ status: 'error', message: error instanceof Error && error.message ? error.message : fallback })
      void taskQuery.refetch().then((refreshed) => {
        const currentVersion = refreshed.data?.task.updatedAt ?? null
        if (seenVersion && currentVersion && currentVersion !== seenVersion) setNotice(conflictNotice)
      })
    },
    [invalidate, t, taskQuery],
  )

  const handleQuickLog = React.useCallback(
    async ({ minutes, description, date, isBillable, startClock, endClock }: QuickLogSubmission): Promise<boolean> => {
      if (!selfStaffMemberId || !projectId) {
        flash(t('staff.time_tracking.taskDrawer.quickLog.error', 'Could not save the time entry.'), 'error')
        return false
      }
      setBusy(true)
      try {
        await runMutation({
          operation: () =>
            apiCallOrThrow(
              '/api/staff/timesheets/time-entries',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  // US-C5 defaults — today, me, billable — unless the Details block
                  // overrode them. The person is never overridable here: logging
                  // for somebody else is a different act with different permissions.
                  staffMemberId: selfStaffMemberId,
                  date,
                  durationMinutes: minutes,
                  taskId,
                  timeProjectId: projectId,
                  isBillable,
                  description,
                  // The clocks are sent as a pair or not at all. A lone
                  // `started_at` is indistinguishable from a running timer —
                  // `started_at IS NOT NULL AND ended_at IS NULL` is exactly how
                  // the list identifies one — so an entry with a start and no end
                  // shows up as a timer running since that moment, and stopping it
                  // fails because no timer segment was ever opened for it.
                  //
                  // The duration is authoritative here, so the missing half is
                  // derived from it rather than left blank: the same 2-of-3
                  // arithmetic the full entry form does.
                  ...buildEntryClocks({ date, startClock, endClock, minutes }),
                  source: 'manual',
                }),
              },
              { errorMessage: t('staff.time_tracking.taskDrawer.quickLog.error', 'Could not save the time entry.') },
            ),
          context: {
            formId: taskDrawerFormId(taskId),
            retryLastMutation,
          },
        })
        flash(t('staff.time_tracking.taskDrawer.quickLog.saved', 'Time logged.'), 'success')
        invalidate('task')
        invalidate('entries')
        onChanged?.()
        return true
      } catch (error) {
        reportError(error, t('staff.time_tracking.taskDrawer.quickLog.error', 'Could not save the time entry.'))
        return false
      } finally {
        setBusy(false)
      }
    },
    [invalidate, onChanged, projectId, reportError, retryLastMutation, runMutation, selfStaffMemberId, t, taskId],
  )

  const stopTimerEntry = React.useCallback(
    async (entryId: string) => {
      await runMutation({
        operation: () =>
          apiCallOrThrow(
            `/api/staff/timesheets/time-entries/${encodeURIComponent(entryId)}/timer-stop`,
            { method: 'POST' },
            { errorMessage: t('staff.time_tracking.board.timer.stopError', 'Could not stop the timer.') },
          ),
        context: {
          formId: taskDrawerFormId(taskId),
          retryLastMutation,
        },
      })
    },
    [retryLastMutation, runMutation, t, taskId],
  )

  const handleStopTimer = React.useCallback(async () => {
    if (!runningTimer.entryId) return
    setTimerBusy(true)
    try {
      await stopTimerEntry(runningTimer.entryId)
      await runningTimerQuery.refetch()
      invalidate('task')
      invalidate('entries')
      onChanged?.()
    } catch (error) {
      reportError(error, t('staff.time_tracking.board.timer.stopError', 'Could not stop the timer.'))
    } finally {
      setTimerBusy(false)
    }
  }, [invalidate, onChanged, reportError, runningTimer.entryId, runningTimerQuery, stopTimerEntry, t])

  const handleStartTimer = React.useCallback(async () => {
    if (!selfStaffMemberId || !projectId) return
    // Note 2 / US-D4: one timer at a time. A timer running on another task is
    // stopped only after the person says so — never silently.
    if (runningTimer.entryId && runningTimer.taskId !== taskId) {
      const confirmed = await confirm({
        title: t('staff.time_tracking.taskDrawer.timer.switchTitle', 'A timer is running on another task'),
        text: t(
          'staff.time_tracking.taskDrawer.timer.switchText',
          'Only one timer can run at a time. Stop the other one and start it here?',
        ),
      })
      if (!confirmed) return
    }
    setTimerBusy(true)
    try {
      if (runningTimer.entryId && runningTimer.taskId !== taskId) {
        await stopTimerEntry(runningTimer.entryId)
      }
      const started = await runMutation({
        operation: () =>
          apiCallOrThrow<Record<string, unknown>>(
            '/api/staff/timesheets/time-entries/start-timer',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                staffMemberId: selfStaffMemberId,
                timeProjectId: projectId,
                date: todayIsoDate(),
                notes: task?.title ?? null,
              }),
            },
            { errorMessage: t('staff.time_tracking.board.timer.startError', 'Could not start the timer.') },
          ),
        context: {
          formId: taskDrawerFormId(taskId),
          retryLastMutation,
        },
      })
      const entryId = typeof started?.result?.id === 'string' ? started.result.id : null
      if (entryId) {
        // `start-timer` is atomic but takes no task, so the link is a second
        // write — the board does the same. A failure leaves a running,
        // project-level timer rather than no timer at all.
        const linked = await apiCall('/api/staff/timesheets/time-entries', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: entryId, taskId }),
        })
        if (!linked.ok) {
          flash(
            t(
              'staff.time_tracking.board.timer.linkWarning',
              'The timer is running but is not linked to this task yet.',
            ),
            'warning',
          )
        }
      }
      await runningTimerQuery.refetch()
      onChanged?.()
    } catch (error) {
      reportError(error, t('staff.time_tracking.board.timer.startError', 'Could not start the timer.'))
    } finally {
      setTimerBusy(false)
    }
  }, [
    confirm,
    onChanged,
    projectId,
    reportError,
    retryLastMutation,
    runMutation,
    runningTimer.entryId,
    runningTimer.taskId,
    runningTimerQuery,
    selfStaffMemberId,
    stopTimerEntry,
    t,
    task?.title,
    taskId,
  ])

  /**
   * Property saves are serialized. Each one leaves with the version the previous
   * one produced, so the second blur cannot 409 against the first.
   */
  const runSerialized = React.useCallback(async (job: () => Promise<void>): Promise<void> => {
    const chained = saveChainRef.current.then(job, job)
    saveChainRef.current = chained.catch(() => {})
    return chained
  }, [])

  const saveTaskField = React.useCallback(
    async (patch: Record<string, unknown>) => {
      if (!task) return
      setBusy(true)
      try {
        await runSerialized(async () => {
          await runMutation({
            operation: () =>
              withScopedApiRequestHeaders(buildOptimisticLockHeader(versionRef.current), () =>
                apiCallOrThrow(
                  '/api/staff/timesheets/tasks',
                  {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ id: taskId, ...patch }),
                  },
                  {
                    errorMessage: t(
                      'staff.time_tracking.taskDrawer.properties.saveError',
                      'Could not save the change.',
                    ),
                  },
                ),
              ),
            context: {
              formId: taskDrawerFormId(taskId),
              retryLastMutation,
            },
          })
          // The CRUD update answers `{ok:true}`, so the new version comes from
          // the row itself — and it must land before the next field saves.
          await refreshVersion()
        })
        onChanged?.()
      } catch (error) {
        reportError(error, t('staff.time_tracking.taskDrawer.properties.saveError', 'Could not save the change.'))
      } finally {
        setBusy(false)
      }
    },
    [onChanged, refreshVersion, reportError, retryLastMutation, runMutation, runSerialized, t, task, taskId],
  )

  const handleStatusChange = React.useCallback(
    (statusId: string) => {
      if (!task || statusId === task.taskStatusId) return
      setBusy(true)
      void runSerialized(async () => {
        try {
          const moved = await runMutation({
            operation: () =>
              withScopedApiRequestHeaders(buildOptimisticLockHeader(versionRef.current), () =>
                apiCallOrThrow<Record<string, unknown>>(
                  `/api/staff/timesheets/tasks/${encodeURIComponent(taskId)}/status`,
                  {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ taskStatusId: statusId }),
                  },
                  { errorMessage: t('staff.time_tracking.board.move.error', 'Could not move the task.') },
                ),
              ),
            context: {
              formId: taskDrawerFormId(taskId),
              retryLastMutation,
            },
          })
          // This route does return the new version, so the token refreshes from
          // the response instead of costing a refetch.
          const updatedAt = typeof moved?.result?.updatedAt === 'string' ? moved.result.updatedAt : null
          if (updatedAt) versionRef.current = updatedAt
          else await refreshVersion()
          invalidate('task')
          onChanged?.()
        } catch (error) {
          reportError(error, t('staff.time_tracking.board.move.error', 'Could not move the task.'))
        } finally {
          setBusy(false)
        }
      })
    },
    [
      invalidate,
      onChanged,
      refreshVersion,
      reportError,
      retryLastMutation,
      runMutation,
      runSerialized,
      t,
      task,
      taskId,
    ],
  )

  const handleAssigneeChange = React.useCallback(
    (value: string) => {
      void saveTaskField({ assigneeStaffMemberId: value === '' ? null : value })
    },
    [saveTaskField],
  )

  const canClaim = taskQuery.data?.assignment.canClaim === true
  const canRelease = taskQuery.data?.assignment.canRelease === true

  const runAssignmentAction = React.useCallback(
    (action: 'claim' | 'release') => {
      if (!task) return
      const errorMessage =
        action === 'claim'
          ? t('staff.time_tracking.taskDrawer.assignment.claimError', 'Could not claim the task.')
          : t('staff.time_tracking.taskDrawer.assignment.releaseError', 'Could not release the task.')
      setBusy(true)
      void runSerialized(async () => {
        try {
          // No optimistic-lock header: claim and release are atomic conditional
          // updates on the assignee, so a lost race answers with its own reason
          // instead of a generic "record changed".
          const done = await runMutation({
            operation: () =>
              apiCallOrThrow<Record<string, unknown>>(
                `/api/staff/timesheets/tasks/${encodeURIComponent(taskId)}/${action}`,
                { method: 'POST' },
                { errorMessage },
              ),
            context: {
              formId: taskDrawerFormId(taskId),
              retryLastMutation,
            },
          })
          const updatedAt = typeof done?.result?.updatedAt === 'string' ? done.result.updatedAt : null
          if (updatedAt) versionRef.current = updatedAt
          else await refreshVersion()
          invalidate('task')
          flash(
            action === 'claim'
              ? t('staff.time_tracking.taskDrawer.assignment.claimed', 'Task claimed.')
              : t('staff.time_tracking.taskDrawer.assignment.released', 'Task released.'),
            'success',
          )
          onChanged?.()
        } catch (error) {
          if (!isAssignmentRace(error)) {
            reportError(error, errorMessage)
            return
          }
          const refreshed = await taskQuery.refetch()
          const assigneeId = refreshed.data?.task.assigneeStaffMemberId ?? null
          const takenByOther = action === 'claim' && assigneeId !== null && assigneeId !== selfStaffMemberId
          setNotice({
            status: 'warning',
            message: takenByOther
              ? t('staff.timesheets.errors.taskAlreadyClaimed', 'Someone else already took this task.')
              : t(
                  'staff.time_tracking.taskDrawer.conflict',
                  'Someone else changed this task. It now shows the latest version. Check it and try again.',
                ),
          })
          invalidate('task')
          onChanged?.()
        } finally {
          setBusy(false)
        }
      })
    },
    [
      invalidate,
      onChanged,
      refreshVersion,
      reportError,
      retryLastMutation,
      runMutation,
      runSerialized,
      selfStaffMemberId,
      t,
      task,
      taskId,
      taskQuery,
    ],
  )

  const handleToggleSubtask = React.useCallback(
    async (child: BoardTask, done: boolean) => {
      const targetStatusId = done ? resolveDoneStatusId(statuses) : resolveDefaultStatusId(statuses)
      if (!targetStatusId) return
      setBusy(true)
      try {
        await runMutation({
          operation: () =>
            // The child's own version, not the parent's — this write touches the
            // child row.
            withScopedApiRequestHeaders(buildOptimisticLockHeader(child.updatedAt), () =>
              apiCallOrThrow(
                `/api/staff/timesheets/tasks/${encodeURIComponent(child.id)}/status`,
                {
                  method: 'PATCH',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ taskStatusId: targetStatusId }),
                },
                {
                  errorMessage: t(
                    'staff.time_tracking.taskDrawer.subtasks.toggleError',
                    'Could not change the subtask status.',
                  ),
                },
              ),
            ),
          context: {
            formId: taskDrawerFormId(taskId),
            retryLastMutation,
          },
        })
        invalidate('children')
        invalidate('task')
        onChanged?.()
      } catch (error) {
        reportError(
          error,
          t('staff.time_tracking.taskDrawer.subtasks.toggleError', 'Could not change the subtask status.'),
        )
      } finally {
        setBusy(false)
      }
    },
    [invalidate, onChanged, reportError, retryLastMutation, runMutation, statuses, t, taskId],
  )

  const handleAddSubtask = React.useCallback(async () => {
    const title = subtaskDraft.trim()
    if (!title || !projectId) {
      setComposingSubtask(false)
      setSubtaskDraft('')
      return
    }
    setBusy(true)
    try {
      await runMutation({
        operation: () =>
          apiCallOrThrow(
            '/api/staff/timesheets/tasks',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                timeProjectId: projectId,
                parentTaskId: taskId,
                title,
                assigneeStaffMemberId: selfStaffMemberId,
              }),
            },
            {
              errorMessage: t('staff.time_tracking.taskDrawer.subtasks.addError', 'Could not add the subtask.'),
            },
          ),
        context: {
          formId: taskDrawerFormId(taskId),
          retryLastMutation,
        },
      })
      setSubtaskDraft('')
      setComposingSubtask(false)
      invalidate('children')
      invalidate('task')
      onChanged?.()
    } catch (error) {
      reportError(error, t('staff.time_tracking.taskDrawer.subtasks.addError', 'Could not add the subtask.'))
    } finally {
      setBusy(false)
    }
  }, [
    invalidate,
    onChanged,
    projectId,
    reportError,
    retryLastMutation,
    runMutation,
    selfStaffMemberId,
    subtaskDraft,
    t,
    taskId,
  ])

  useAppEvent(
    SUPPORT_ACTIVITY_EVENT,
    (event) => {
      const eventTaskId = (event.payload as { taskId?: unknown } | undefined)?.taskId
      if (!open || eventTaskId !== taskId) return
      invalidate('task')
      invalidate('comments')
      invalidate('attachments')
    },
    [invalidate, open, taskId],
  )

  useAppEvent(
    TASK_ASSIGNMENT_CHANGED_EVENT,
    (event) => {
      if (!open || !isAssignmentEventForTask(event.payload, taskId)) return
      invalidate('task')
    },
    [invalidate, open, taskId],
  )

  const handleMakeInternal = React.useCallback(
    async (comment: DrawerComment): Promise<void> => {
      setBusy(true)
      try {
        await runMutation({
          operation: () =>
            withScopedApiRequestHeaders(buildOptimisticLockHeader(comment.updatedAt), () =>
              apiCallOrThrow(
                `/api/staff/timesheets/tasks/${encodeURIComponent(taskId)}/comments`,
                {
                  method: 'PUT',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ id: comment.id, visibility: 'internal' }),
                },
                { errorMessage: t('staff.time_tracking.taskComments.makeInternalError', 'Could not change the reply.') },
              ),
            ),
          context: {
            formId: taskDrawerFormId(taskId),
            retryLastMutation,
          },
        })
        invalidate('comments')
      } catch (error) {
        if (surfaceRecordConflict(error, t)) {
          invalidate('comments')
          return
        }
        reportError(error, t('staff.time_tracking.taskComments.makeInternalError', 'Could not change the reply.'))
      } finally {
        setBusy(false)
      }
    },
    [invalidate, reportError, retryLastMutation, runMutation, t, taskId],
  )

  const handlePostComment = React.useCallback(
    async (body: string, visibility: CommentVisibility = 'internal'): Promise<boolean> => {
      setBusy(true)
      try {
        await runMutation({
          operation: () =>
            apiCallOrThrow(
              `/api/staff/timesheets/tasks/${encodeURIComponent(taskId)}/comments`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ body, visibility }),
              },
              { errorMessage: t('staff.time_tracking.taskDrawer.comments.error', 'Could not post the comment.') },
            ),
          context: {
            formId: taskDrawerFormId(taskId),
            retryLastMutation,
          },
        })
        invalidate('comments')
        return true
      } catch (error) {
        reportError(error, t('staff.time_tracking.taskDrawer.comments.error', 'Could not post the comment.'))
        return false
      } finally {
        setBusy(false)
      }
    },
    [invalidate, reportError, retryLastMutation, runMutation, t, taskId],
  )

  const handleTagChange = React.useCallback(
    async (tagId: string, assign: boolean) => {
      setBusy(true)
      const previous = tagIds
      setTagIds((current) =>
        assign ? Array.from(new Set([...current, tagId])) : current.filter((id) => id !== tagId),
      )
      try {
        await runMutation({
          operation: () =>
            apiCallOrThrow(
              '/api/staff/timesheets/tags/task-assignments',
              {
                method: assign ? 'POST' : 'DELETE',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ taskId, tagIds: [tagId] }),
              },
              { errorMessage: t('staff.time_tracking.taskDrawer.properties.tagError', 'Could not save the tags.') },
            ),
          context: {
            formId: taskDrawerFormId(taskId),
            retryLastMutation,
          },
        })
        onChanged?.()
      } catch (error) {
        setTagIds(previous)
        reportError(error, t('staff.time_tracking.taskDrawer.properties.tagError', 'Could not save the tags.'))
      } finally {
        setBusy(false)
      }
    },
    [onChanged, reportError, retryLastMutation, runMutation, t, tagIds, taskId],
  )

  /**
   * Creates the tag and hands it back so the picker can assign it through the
   * drawer's own `handleTagChange` — the task-assignments write is untouched, the
   * new row simply becomes assignable without leaving the drawer. The list is
   * invalidated rather than patched so the server-assigned colour arrives with it.
   */
  const createTag = React.useCallback(
    async (label: string): Promise<TagOption | null> => {
      try {
        const created = await apiCallOrThrow<Record<string, unknown>>(
          '/api/staff/timesheets/tags',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ label, slug: slugifyProjectName(label).toLowerCase() }),
          },
          {
            errorMessage: t(
              'staff.time_tracking.entryDialog.errors.createTag',
              'Could not create the tag.',
            ),
          },
        )
        const id = typeof created?.result?.id === 'string' ? created.result.id : null
        if (!id) return null
        await queryClient.invalidateQueries({ queryKey: [...DRAWER_QUERY_ROOT, 'tags'] })
        return { id, label, color: null }
      } catch (error) {
        logger.warn('staff.time_tracking task drawer tag create failed', { err: error })
        flash(t('staff.time_tracking.entryDialog.errors.createTag', 'Could not create the tag.'), 'error')
        return null
      }
    },
    [queryClient, t],
  )

  const status = React.useMemo(
    () => statuses.find((entry) => entry.id === task?.taskStatusId) ?? null,
    [statuses, task?.taskStatusId],
  )

  const statusVariant = status?.isDone ? 'success' : status?.isDefault ? 'neutral' : 'info'

  const recentEntries = React.useMemo(() => entries.slice(0, RECENT_ENTRY_COUNT), [entries])

  const assignedTags = React.useMemo<TagOption[]>(() => {
    const byId = new Map(tagOptions.map((tag) => [tag.id, tag]))
    return tagIds.map((id) => byId.get(id) ?? { id, label: id, color: null })
  }, [tagIds, tagOptions])

  const availableTags = React.useMemo(
    () => tagOptions.filter((tag) => !tagIds.includes(tag.id)),
    [tagIds, tagOptions],
  )

  const doneStatusId = resolveDoneStatusId(statuses)

  const body = (() => {
    if (taskQuery.isLoading) {
      return <LoadingMessage label={t('staff.time_tracking.taskDrawer.loading', 'Loading the task…')} />
    }
    if (taskQuery.isError) {
      return <ErrorMessage label={t('staff.time_tracking.taskDrawer.loadError', 'Could not load the task.')} />
    }
    if (!task) {
      return (
        <ErrorMessage
          label={t('staff.time_tracking.tasks.errors.notFound', 'Task not found or not accessible.')}
        />
      )
    }

    return (
      <div className="flex flex-col gap-6">
        {notice ? (
          <Alert status={notice.status} data-testid="task-drawer-notice">
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
        ) : null}
        {support ? <SupportRequestPanel ticket={support} /> : null}
        {support ? <SupportAttachmentsSection taskId={taskId} /> : null}
        <TaskQuickLog
          onLog={handleQuickLog}
          logging={busy}
          timerRunningHere={timerRunningHere}
          elapsed={timerRunningHere ? formatElapsed(runningTimer.startedAt, now) : null}
          timerBusy={timerBusy}
          onStartTimer={() => { void handleStartTimer() }}
          onStopTimer={() => { void handleStopTimer() }}
          autoFocus={focusPanel === 'time'}
          disabled={!canManage}
          today={todayIsoDate()}
        />

        <section className="flex flex-col gap-2" data-testid="task-drawer-logged">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('staff.time_tracking.taskDrawer.logged.title', 'Logged time')}
            </h3>
            <span className="font-mono text-base font-semibold tabular-nums text-foreground" data-testid="task-drawer-logged-total">
              {formatBoardMinutes(task.loggedMinutes)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="task-drawer-logged-split">
            {t('staff.time_tracking.taskDrawer.logged.split', 'own {own} · subtasks {children}', {
              own: formatSplitMinutes(task.ownMinutes),
              children: formatSplitMinutes(childMinutes(task.loggedMinutes, task.ownMinutes)),
            })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success">
              {t('staff.time_tracking.taskDrawer.logged.billable', 'billable {hours}', {
                hours: formatBoardMinutes(totals.billableMinutes),
              })}
            </Badge>
            <Badge variant="neutral">
              {t('staff.time_tracking.taskDrawer.logged.nonBillable', 'non-billable {hours}', {
                hours: formatBoardMinutes(totals.nonBillableMinutes),
              })}
            </Badge>
            {canSeeMoney && totals.cost !== null ? (
              <Badge variant="info" data-testid="task-drawer-cost">
                {t('staff.time_tracking.taskDrawer.logged.cost', 'cost {amount}', {
                  amount: formatCurrency(totals.cost, totals.currencyCode) ?? String(totals.cost),
                })}
              </Badge>
            ) : null}
          </div>
          {totals.partial ? (
            <p className="text-xs text-muted-foreground">
              {t(
                'staff.time_tracking.taskDrawer.logged.partialHint',
                'The split is counted from the most recent entries in this project.',
              )}
            </p>
          ) : null}
        </section>

        {isChildTask ? null : (
          <section className="flex flex-col gap-3" data-testid="task-drawer-subtasks">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('staff.time_tracking.taskDrawer.subtasks.title', 'Subtasks')}
              </h3>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {t('staff.time_tracking.taskDrawer.subtasks.count', '{done}/{total}', {
                  done: progress.done,
                  total: subtaskTotal,
                })}
              </span>
            </div>
            {subtaskTotal > 0 ? (
              <Progress value={subtaskTotal > 0 ? (progress.done / subtaskTotal) * 100 : 0} max={100} />
            ) : null}
            {children.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('staff.time_tracking.taskDrawer.subtasks.empty', 'No subtasks yet.')}
              </p>
            ) : (
              <ul className="flex flex-col">
                {children.map((child) => {
                  const done = (child.taskStatusId && doneStatusIds.has(child.taskStatusId)) || !!child.closedAt
                  const assigneeName = child.assigneeStaffMemberId
                    ? memberNames.get(child.assigneeStaffMemberId) ?? child.assigneeStaffMemberId
                    : t('staff.time_tracking.taskDrawer.properties.unassigned', 'Unassigned')
                  return (
                    <li
                      key={child.id}
                      className="flex items-center gap-2.5 border-b border-border py-2 last:border-b-0"
                      data-subtask-id={child.id}
                    >
                      <Checkbox
                        checked={done}
                        disabled={!canManage || busy || !doneStatusId}
                        aria-label={t('staff.time_tracking.taskDrawer.subtasks.toggle', 'Mark {title} as done', {
                          title: child.title,
                        })}
                        onCheckedChange={(next) => { void handleToggleSubtask(child, next === true) }}
                      />
                      <span
                        className={`min-w-0 flex-1 truncate text-sm ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                      >
                        {child.title}
                      </span>
                      <Avatar label={assigneeName} size="xs" />
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {formatBoardMinutes(child.loggedMinutes)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
            {!doneStatusId && children.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t(
                  'staff.time_tracking.taskDrawer.subtasks.noDoneColumn',
                  'This project has no done column, so a subtask has no way to close.',
                )}
              </p>
            ) : null}
            {canManage ? (
              composingSubtask ? (
                <Input
                  autoFocus
                  size="sm"
                  value={subtaskDraft}
                  disabled={busy}
                  onChange={(event) => setSubtaskDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleAddSubtask()
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      event.stopPropagation()
                      setComposingSubtask(false)
                      setSubtaskDraft('')
                    }
                  }}
                  placeholder={t('staff.time_tracking.taskDrawer.subtasks.placeholder', 'Subtask title')}
                  aria-label={t('staff.time_tracking.taskDrawer.subtasks.add', 'Add subtask')}
                  data-testid="task-drawer-subtask-input"
                />
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => setComposingSubtask(true)}
                  data-testid="task-drawer-add-subtask"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  {t('staff.time_tracking.taskDrawer.subtasks.add', 'Add subtask')}
                </Button>
              )
            ) : null}
          </section>
        )}

        <section className="flex flex-col gap-3" data-testid="task-drawer-entries">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('staff.time_tracking.taskDrawer.entries.title', 'Time entries ({count})', { count: entries.length })}
          </h3>
          {recentEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('staff.time_tracking.taskDrawer.entries.empty', 'No time entries yet.')}
            </p>
          ) : (
            <ul className="flex flex-col">
              {recentEntries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-3 border-b border-border py-2 text-sm last:border-b-0"
                  data-entry-id={entry.id}
                >
                  <span className="w-20 shrink-0 text-xs text-muted-foreground">
                    {formatDate(entry.date) ?? ''}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {entry.description
                      ?? t('staff.time_tracking.taskDrawer.entries.noDescription', 'No description')}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatBoardMinutes(entry.durationMinutes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => router.push(`${ENTRIES_LIST_PATH}?taskId=${encodeURIComponent(taskId)}`)}
          >
            {t('staff.time_tracking.taskDrawer.entries.showAll', 'Show all')}
          </Button>
        </section>

        <TaskCommentThread
          comments={commentsQuery.data ?? []}
          loading={commentsQuery.isLoading}
          loadError={commentsQuery.isError}
          posting={busy}
          canComment={canManage}
          onPost={handlePostComment}
          mode={support ? 'support' : 'internal'}
          onMakeInternal={support ? handleMakeInternal : undefined}
        />

        <section className="flex flex-col gap-3" data-testid="task-drawer-properties">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('staff.time_tracking.taskDrawer.properties.title', 'Properties')}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t('staff.time_tracking.taskDrawer.properties.status', 'Status')}
              </span>
              <Select
                value={task.taskStatusId ?? undefined}
                disabled={!canManage || busy}
                onValueChange={handleStatusChange}
              >
                <SelectTrigger
                  aria-label={t('staff.time_tracking.taskDrawer.properties.status', 'Status')}
                  data-testid="task-drawer-status-select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statuses.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t('staff.time_tracking.taskDrawer.properties.assignee', 'Assignee')}
              </span>
              <Select
                value={task.assigneeStaffMemberId ?? undefined}
                disabled={!canManage || busy}
                onValueChange={handleAssigneeChange}
              >
                <SelectTrigger
                  aria-label={t('staff.time_tracking.taskDrawer.properties.assignee', 'Assignee')}
                  data-testid="task-drawer-assignee-select"
                >
                  <SelectValue
                    placeholder={t('staff.time_tracking.taskDrawer.properties.unassigned', 'Unassigned')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canClaim ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => runAssignmentAction('claim')}
                  data-testid="task-drawer-claim"
                >
                  {t('staff.time_tracking.taskDrawer.assignment.claim', 'Claim')}
                </Button>
              ) : null}
              {canRelease ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => runAssignmentAction('release')}
                  data-testid="task-drawer-release"
                >
                  {t('staff.time_tracking.taskDrawer.assignment.release', 'Release')}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t('staff.time_tracking.taskDrawer.properties.tags', 'Tags')}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {assignedTags.map((tag) => (
                <Badge key={tag.id} variant="neutral" className="gap-1" style={tagChipStyle(tag)}>
                  {tag.label}
                  {canManage ? (
                    <button
                      type="button"
                      aria-label={t('staff.time_tracking.taskDrawer.properties.removeTag', 'Remove tag {label}', {
                        label: tag.label,
                      })}
                      onClick={() => { void handleTagChange(tag.id, false) }}
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  ) : null}
                </Badge>
              ))}
              {canManage ? (
                <TagPicker
                  available={availableTags}
                  disabled={busy}
                  onAssign={(id) => { void handleTagChange(id, true) }}
                  onCreate={createTag}
                  labels={{
                    add: t('staff.time_tracking.taskDrawer.properties.addTag', 'Add tag'),
                    create: (name) =>
                      t('staff.time_tracking.entryDialog.createTag', 'Create "{name}"', { name }),
                    empty: t('staff.time_tracking.entryDialog.noTags', 'No matching tag'),
                  }}
                  testIdPrefix="task-drawer"
                />
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                'staff.time_tracking.taskDrawer.properties.tagsPending',
                'Tags already saved on this task appear here once the task list returns them.',
              )}
            </p>
          </div>
          <InjectionSpot
            spotId={extensionPoints.hosts.taskDetailSidebar.spotId}
            context={taskInjectionContext}
            data={task}
          />
        </section>

        <InjectionSpot
          spotId={extensionPoints.hosts.taskDetailTabs.spotId}
          context={taskInjectionContext}
          data={task}
        />
      </div>
    )
  })()

  const createdLabel = formatDate(createdAt)
  const headerLine = [
    projectName ?? null,
    createdLabel
      ? t('staff.time_tracking.taskDrawer.created', 'created {date}', { date: createdLabel })
      : null,
  ]
    .filter((part): part is string => !!part)
    .join(' · ')

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="sm:max-w-xl"
        closeAriaLabel={t('staff.time_tracking.taskDrawer.close', 'Close')}
        data-testid="task-drawer"
      >
        <DrawerHeader>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center gap-2">
              {status ? <Badge variant={statusVariant}>{status.name}</Badge> : null}
              {task?.reference ? (
                <span className="text-xs text-muted-foreground">{task.reference}</span>
              ) : null}
              <InjectionSpot
                spotId={extensionPoints.hosts.taskDetailStatusBadges.spotId}
                context={taskInjectionContext}
                data={task}
              />
            </div>
            <DrawerTitle className="truncate">{task?.title ?? ''}</DrawerTitle>
            <DrawerDescription>{headerLine}</DrawerDescription>
            <InjectionSpot
              spotId={extensionPoints.hosts.taskDetailHeader.spotId}
              context={taskInjectionContext}
              data={task}
            />
          </div>
        </DrawerHeader>
        <DrawerBody>{body}</DrawerBody>
        <DrawerFooter
          leading={
            <span className="text-xs text-muted-foreground">
              {t('staff.time_tracking.taskDrawer.autoSave', 'Changes are saved automatically')}
            </span>
          }
        >
          <InjectionSpot
            spotId={extensionPoints.hosts.taskDetailFooter.spotId}
            context={taskInjectionContext}
            data={task}
          />
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('staff.time_tracking.taskDrawer.close', 'Close')}
          </Button>
        </DrawerFooter>
        {ConfirmDialogElement}
      </DrawerContent>
    </Drawer>
  )
}

export default TaskDrawer
