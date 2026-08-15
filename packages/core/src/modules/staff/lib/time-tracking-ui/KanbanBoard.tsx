"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { Plus, RotateCcw } from 'lucide-react'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Input } from '@open-mercato/ui/primitives/input'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { sumTaskLoggedMinutes } from '../timesheets-tasks/taskHoursTotals'
import { KanbanColumn, KANBAN_COLUMN_DROPPABLE_PREFIX } from './KanbanColumn'
import { TaskDrawer } from './TaskDrawer'
import type { KanbanTagOption } from './KanbanCard'
import {
  BOARD_DIRECTORY_PAGE_SIZE,
  BOARD_PAGE_SIZE,
  BOARD_QUERY_ROOT,
  boardColumnQueryKey,
  fetchTaskPages,
  useAssigneeNames,
  useBoardSelf,
  useBoardStatuses,
  useTagLabels,
} from './boardDirectory'
import {
  EMPTY_BOARD_FILTERS,
  boardServerFilterKey,
  boardServerFilterParams,
  visibleBoardStatusIds,
  type BoardFilters,
} from './boardFilters'
import type { BoardSummary } from './boardSummary'
import {
  computeSubtaskProgress,
  formatBoardMinutes,
  nextPositionAtColumnTop,
  readItems,
  readString,
  sortByPosition,
  toBoardTask,
  type BoardApiRow,
  type BoardTask,
} from './kanbanBoardData'

const logger = createLogger('staff').child({ component: 'KanbanBoard' })

export { BOARD_PAGE_SIZE, BOARD_DIRECTORY_PAGE_SIZE }
export const BOARD_MAX_CHILD_PAGES = 5
export const MOVE_MUTATION_CONTEXT_ID = 'staff.time_tracking.board.move'
export const CREATE_MUTATION_CONTEXT_ID = 'staff.time_tracking.board.create'
export const MANAGE_COLUMNS_FEATURE = 'staff.timesheets.projects.manage'
export const MANAGE_TASKS_FEATURE = 'staff.timesheets.tasks.manage'
export const TASK_STATUS_CHANGED_EVENT = 'staff.timesheets.time_task.status_changed'

/** Window a locally-originated move stays "mine" for, so a lost SSE cannot wedge the filter. */
const OWN_MOVE_ECHO_TTL_MS = 15_000

type ColumnCache = { items: BoardApiRow[]; total: number }

type PendingMove = {
  taskId: string
  targetStatusId: string
}

export type KanbanBoardProps = {
  timeProjectId: string
  /** Used by the drawer's header; the page owns the breadcrumb and the rest of the chrome. */
  projectName?: string | null
  /** Board filters (T3.8). Assignee narrows the request, status picks columns, tag filters rows. */
  filters?: BoardFilters
  /** Reports what is on screen so the page head can describe it without a second fetch. */
  onSummaryChange?: (summary: BoardSummary) => void
}

function statusIdFromColumnKey(key: readonly unknown[]): string | null {
  const part = key.find((entry) => typeof entry === 'string' && entry.startsWith('status:'))
  return typeof part === 'string' ? part.slice('status:'.length) : null
}

/**
 * The Kanban board of screen 6 (T3.6, US-C1/US-C2).
 *
 * Three things carry the design intent and are worth reading before changing anything:
 *
 *  1. **The move is optimistic and the rollback is exact.** Before the PATCH the board
 *     snapshots every column cache; the card is moved between them immediately. On any
 *     failure the whole snapshot is written back, which returns the card to the column
 *     it came from even when the drag crossed columns whose pages had shifted.
 *  2. **A 409 is not a retryable failure.** The PATCH carries the card's `updatedAt` in
 *     the optimistic-lock header, so a 409 means somebody else moved this card while the
 *     drag was in flight. `surfaceRecordConflict` raises the shared conflict bar, the
 *     board refetches, and no Retry is offered — retrying would overwrite the other
 *     move. Every other failure gets the retry affordance of note 2.
 *  3. **Echoes of your own move are ignored.** `status_changed` is broadcast to every
 *     connected board, including the one that caused it. Each locally-issued move
 *     registers a `taskId|statusId` key that the event handler consumes instead of
 *     refetching, so a colleague's drag moves the card here and yours does not fight the
 *     optimistic update that already landed.
 */
export function KanbanBoard({
  timeProjectId,
  projectName,
  filters = EMPTY_BOARD_FILTERS,
  onSummaryChange,
}: KanbanBoardProps): React.ReactElement {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const { payload } = useBackendChrome()
  const canManageColumns = hasFeature(payload?.grantedFeatures, MANAGE_COLUMNS_FEATURE)
  const canManageTasks = hasFeature(payload?.grantedFeatures, MANAGE_TASKS_FEATURE)
  const serverFilterKey = boardServerFilterKey(filters)
  const serverFilterParams = boardServerFilterParams(filters)

  const [pagesByStatus, setPagesByStatus] = React.useState<Record<string, number>>({})
  const [activeDragTaskId, setActiveDragTaskId] = React.useState<string | null>(null)
  const [pendingTaskIds, setPendingTaskIds] = React.useState<ReadonlySet<string>>(new Set())
  const [failedMove, setFailedMove] = React.useState<PendingMove | null>(null)
  const [quickAddPendingStatusId, setQuickAddPendingStatusId] = React.useState<string | null>(null)
  const [composingStatus, setComposingStatus] = React.useState(false)
  const [statusDraft, setStatusDraft] = React.useState('')

  const ownMoveKeysRef = React.useRef(new Map<string, number>())

  const { runMutation: runMoveMutation, retryLastMutation: retryMoveMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: MOVE_MUTATION_CONTEXT_ID,
    blockedMessage: t('staff.time_tracking.board.move.error', 'Could not move the task.'),
  })

  const { runMutation: runCreateMutation, retryLastMutation: retryCreateMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: CREATE_MUTATION_CONTEXT_ID,
    blockedMessage: t('staff.time_tracking.board.quickAdd.error', 'Could not create the task.'),
  })

  const statusesQuery = useBoardStatuses(timeProjectId)

  const statuses = React.useMemo(() => statusesQuery.data ?? [], [statusesQuery.data])

  // A status filter is not a request parameter here — it selects which columns exist.
  const visibleStatuses = React.useMemo(
    () => visibleBoardStatusIds(statuses, filters),
    [filters, statuses],
  )

  const columnQueries = useQueries({
    queries: visibleStatuses.map((status) => {
      const pages = pagesByStatus[status.id] ?? 1
      return {
        queryKey: boardColumnQueryKey(scopeVersion, timeProjectId, status.id, pages, serverFilterKey),
        staleTime: 15_000,
        queryFn: async (): Promise<ColumnCache> =>
          fetchTaskPages(
            (page) =>
              `timeProjectId=${encodeURIComponent(timeProjectId)}&taskStatusId=${encodeURIComponent(status.id)}&topLevelOnly=true&page=${page}&pageSize=${BOARD_PAGE_SIZE}&sortField=position&sortDir=asc${serverFilterParams}`,
            pages,
          ),
      }
    }),
  })

  const tasksByStatusId = React.useMemo(() => {
    const map = new Map<string, { tasks: BoardTask[]; loaded: number; total: number }>()
    visibleStatuses.forEach((status, index) => {
      const data = columnQueries[index]?.data
      const loaded = (data?.items ?? [])
        .map(toBoardTask)
        .filter((task): task is BoardTask => task !== null)
      map.set(status.id, {
        tasks: sortByPosition(loaded),
        loaded: loaded.length,
        total: data?.total ?? loaded.length,
      })
    })
    return map
  }, [columnQueries, visibleStatuses])

  const allTasks = React.useMemo(() => {
    const rows: BoardTask[] = []
    for (const entry of tasksByStatusId.values()) rows.push(...entry.tasks)
    return rows
  }, [tasksByStatusId])

  const hasChildren = React.useMemo(() => allTasks.some((task) => task.childCount > 0), [allTasks])

  const childrenQuery = useQuery<BoardTask[]>({
    queryKey: [...BOARD_QUERY_ROOT, 'children', `scope:${scopeVersion}`, `project:${timeProjectId}`],
    enabled: hasChildren,
    staleTime: 30_000,
    queryFn: async () => {
      // The list route filters children only by a single `parentTaskId`, so a board-wide
      // sweep is the one request that answers "how many of each card's subtasks are done"
      // without one call per card. Bounded, because the count is decoration, not data.
      const { items } = await fetchTaskPages(
        (page) =>
          `timeProjectId=${encodeURIComponent(timeProjectId)}&page=${page}&pageSize=${BOARD_PAGE_SIZE}&sortField=position&sortDir=asc`,
        BOARD_MAX_CHILD_PAGES,
      )
      return items
        .map(toBoardTask)
        .filter((task): task is BoardTask => task !== null && !!task.parentTaskId)
    },
  })

  const doneStatusIds = React.useMemo(
    () => new Set(statuses.filter((status) => status.isDone).map((status) => status.id)),
    [statuses],
  )

  const subtasksByTaskId = React.useMemo(
    () => computeSubtaskProgress(childrenQuery.data ?? [], doneStatusIds),
    [childrenQuery.data, doneStatusIds],
  )

  const assigneeIds = React.useMemo(() => {
    const ids = new Set<string>()
    for (const task of allTasks) {
      if (task.assigneeStaffMemberId) ids.add(task.assigneeStaffMemberId)
    }
    return Array.from(ids).sort()
  }, [allTasks])

  const assigneeQuery = useAssigneeNames(assigneeIds)

  const tagIds = React.useMemo(() => {
    const ids = new Set<string>()
    for (const task of allTasks) {
      for (const id of task.tagIds) ids.add(id)
    }
    return Array.from(ids).sort()
  }, [allTasks])

  const tagQuery = useTagLabels(tagIds)

  const tagsByTaskId = React.useMemo(() => {
    const labels = tagQuery.data ?? new Map<string, string>()
    const map = new Map<string, KanbanTagOption[]>()
    for (const task of allTasks) {
      if (task.tagIds.length === 0) continue
      map.set(
        task.id,
        task.tagIds.map((id) => ({ id, label: labels.get(id) ?? id })),
      )
    }
    return map
  }, [allTasks, tagQuery.data])

  const selfQuery = useBoardSelf()

  const selfStaffMemberId = selfQuery.data?.id ?? null

  const runningTimerQuery = useQuery<{ entryId: string | null; taskId: string | null }>({
    queryKey: [...BOARD_QUERY_ROOT, 'running-timer', `scope:${scopeVersion}`, selfStaffMemberId ?? 'none'],
    enabled: !!selfStaffMemberId,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!selfStaffMemberId) return { entryId: null, taskId: null }
      const call = await apiCall<Record<string, unknown>>(
        `/api/staff/timesheets/time-entries?staffMemberId=${encodeURIComponent(selfStaffMemberId)}&running=true&pageSize=${BOARD_PAGE_SIZE}`,
      )
      if (!call.ok) return { entryId: null, taskId: null }
      for (const row of readItems(call.result)) {
        const endedAt = readString(row, 'ended_at', 'endedAt')
        const startedAt = readString(row, 'started_at', 'startedAt')
        if (!startedAt || endedAt) continue
        return { entryId: readString(row, 'id'), taskId: readString(row, 'task_id', 'taskId') }
      }
      return { entryId: null, taskId: null }
    },
  })

  const runningTimerTaskId = runningTimerQuery.data?.taskId ?? null
  const runningTimerEntryId = runningTimerQuery.data?.entryId ?? null

  const invalidateBoard = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [...BOARD_QUERY_ROOT, 'column'] }).catch(() => {})
    queryClient.invalidateQueries({ queryKey: [...BOARD_QUERY_ROOT, 'children'] }).catch(() => {})
  }, [queryClient])

  const invalidateStatuses = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [...BOARD_QUERY_ROOT, 'statuses'] }).catch(() => {})
  }, [queryClient])

  const markOwnMove = React.useCallback((taskId: string, statusId: string) => {
    ownMoveKeysRef.current.set(`${taskId}|${statusId}`, Date.now())
  }, [])

  const consumeOwnMove = React.useCallback((taskId: string, statusId: string): boolean => {
    const keys = ownMoveKeysRef.current
    const key = `${taskId}|${statusId}`
    const stamped = keys.get(key)
    // Drop stale entries so a broadcast that never arrived cannot suppress a later,
    // genuinely remote move of the same card into the same column.
    for (const [entry, at] of keys) {
      if (Date.now() - at > OWN_MOVE_ECHO_TTL_MS) keys.delete(entry)
    }
    if (stamped === undefined) return false
    keys.delete(key)
    return true
  }, [])

  useAppEvent(
    TASK_STATUS_CHANGED_EVENT,
    (event) => {
      const eventPayload = event.payload as Record<string, unknown> | null | undefined
      if (!eventPayload) return
      const projectId = typeof eventPayload.timeProjectId === 'string' ? eventPayload.timeProjectId : null
      if (projectId && projectId !== timeProjectId) return
      const taskId =
        typeof eventPayload.taskId === 'string'
          ? eventPayload.taskId
          : typeof eventPayload.id === 'string'
            ? eventPayload.id
            : null
      const statusId = typeof eventPayload.taskStatusId === 'string' ? eventPayload.taskStatusId : null
      if (taskId && statusId && consumeOwnMove(taskId, statusId)) return
      invalidateBoard()
    },
    [consumeOwnMove, invalidateBoard, timeProjectId],
  )

  const setTaskPending = React.useCallback((taskId: string, pending: boolean) => {
    setPendingTaskIds((previous) => {
      const next = new Set(previous)
      if (pending) next.add(taskId)
      else next.delete(taskId)
      return next
    })
  }, [])

  const moveTask = React.useCallback(
    (taskId: string, targetStatusId: string) => {
      const columnCaches = queryClient.getQueriesData<ColumnCache>({
        queryKey: [...BOARD_QUERY_ROOT, 'column'],
      })
      // The full pre-move picture. Restoring it wholesale is what puts the card back in
      // its origin column on failure, regardless of how many columns the drag touched.
      const snapshot = columnCaches.map(([key, data]) => [key, data] as const)

      let sourceStatusId: string | null = null
      let movingRow: BoardApiRow | null = null
      for (const [key, data] of columnCaches) {
        if (!data) continue
        const statusId = statusIdFromColumnKey(key as readonly unknown[])
        if (!statusId) continue
        const index = data.items.findIndex((item) => readString(item, 'id') === taskId)
        if (index < 0) continue
        sourceStatusId = statusId
        movingRow = { ...data.items[index], task_status_id: targetStatusId, taskStatusId: targetStatusId }
        queryClient.setQueryData(key, {
          items: data.items.filter((item) => readString(item, 'id') !== taskId),
          total: Math.max(0, data.total - 1),
        })
        break
      }

      if (!movingRow || !sourceStatusId || sourceStatusId === targetStatusId) {
        for (const [key, data] of snapshot) queryClient.setQueryData(key, data)
        return
      }

      const targetTasks = tasksByStatusId.get(targetStatusId)?.tasks ?? []
      const position = nextPositionAtColumnTop(targetTasks)
      const landed: BoardApiRow = { ...movingRow, position }

      for (const [key, data] of columnCaches) {
        if (!data) continue
        if (statusIdFromColumnKey(key as readonly unknown[]) !== targetStatusId) continue
        queryClient.setQueryData(key, {
          items: [landed, ...data.items],
          total: data.total + 1,
        })
      }

      const taskVersion = readString(movingRow, 'updated_at', 'updatedAt')
      setTaskPending(taskId, true)
      setFailedMove(null)
      markOwnMove(taskId, targetStatusId)

      runMoveMutation({
        operation: async () => {
          await withScopedApiRequestHeaders(buildOptimisticLockHeader(taskVersion), () =>
            apiCallOrThrow(
              `/api/staff/timesheets/tasks/${encodeURIComponent(taskId)}/status`,
              {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ taskStatusId: targetStatusId, position }),
              },
              { errorMessage: t('staff.time_tracking.board.move.error', 'Could not move the task.') },
            ),
          )
        },
        context: {
          formId: MOVE_MUTATION_CONTEXT_ID,
          resourceKind: 'staff.timesheets.task',
          resourceId: taskId,
          retryLastMutation: retryMoveMutation,
        },
      })
        .then(() => {
          invalidateBoard()
        })
        .catch((error: unknown) => {
          // Card first: it goes back where it came from before anything else is decided.
          for (const [key, data] of snapshot) queryClient.setQueryData(key, data)
          consumeOwnMove(taskId, targetStatusId)
          if (surfaceRecordConflict(error, t)) {
            // Somebody else moved this card. Refetch and let the conflict bar speak —
            // retrying here would silently overwrite their move.
            invalidateBoard()
            return
          }
          setFailedMove({ taskId, targetStatusId })
          const message =
            error instanceof Error && error.message
              ? error.message
              : t('staff.time_tracking.board.move.error', 'Could not move the task.')
          flash(message, 'error')
        })
        .finally(() => {
          setTaskPending(taskId, false)
        })
    },
    [
      consumeOwnMove,
      invalidateBoard,
      markOwnMove,
      queryClient,
      retryMoveMutation,
      runMoveMutation,
      setTaskPending,
      t,
      tasksByStatusId,
    ],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const collisionDetection = React.useCallback<CollisionDetection>((args) => pointerWithin(args), [])

  const measuringConfig = React.useMemo(
    () => ({ droppable: { strategy: MeasuringStrategy.BeforeDragging } }),
    [],
  )

  const statusIdByTaskId = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const [statusId, entry] of tasksByStatusId) {
      for (const task of entry.tasks) map.set(task.id, statusId)
    }
    return map
  }, [tasksByStatusId])

  const activeDragTask = React.useMemo(
    () => (activeDragTaskId ? allTasks.find((task) => task.id === activeDragTaskId) ?? null : null),
    [activeDragTaskId, allTasks],
  )

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveDragTaskId(typeof event.active.id === 'string' ? event.active.id : null)
  }, [])

  const handleDragCancel = React.useCallback(() => setActiveDragTaskId(null), [])

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      setActiveDragTaskId(null)
      const taskId = typeof event.active.id === 'string' ? event.active.id : null
      const overId = event.over?.id
      if (!taskId || typeof overId !== 'string') return
      const targetStatusId = overId.startsWith(KANBAN_COLUMN_DROPPABLE_PREFIX)
        ? overId.slice(KANBAN_COLUMN_DROPPABLE_PREFIX.length)
        : statusIdByTaskId.get(overId) ?? null
      if (!targetStatusId) return
      if (statusIdByTaskId.get(taskId) === targetStatusId) return
      moveTask(taskId, targetStatusId)
    },
    [moveTask, statusIdByTaskId],
  )

  const handleQuickAdd = React.useCallback(
    async (statusId: string, title: string) => {
      setQuickAddPendingStatusId(statusId)
      try {
        await runCreateMutation({
          operation: () =>
            apiCallOrThrow(
              '/api/staff/timesheets/tasks',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  timeProjectId,
                  taskStatusId: statusId,
                  title,
                  // US-C1: the creator owns what they just typed until somebody reassigns it.
                  assigneeStaffMemberId: selfStaffMemberId,
                }),
              },
              { errorMessage: t('staff.time_tracking.board.quickAdd.error', 'Could not create the task.') },
            ),
          context: {
            formId: CREATE_MUTATION_CONTEXT_ID,
            resourceKind: 'staff.timesheets.task',
            resourceId: statusId,
            retryLastMutation: retryCreateMutation,
          },
        })
        invalidateBoard()
      } catch (error) {
        if (surfaceRecordConflict(error, t)) return
        logger.error('staff.time_tracking board quick add failed', { err: error })
        flash(
          error instanceof Error && error.message
            ? error.message
            : t('staff.time_tracking.board.quickAdd.error', 'Could not create the task.'),
          'error',
        )
      } finally {
        setQuickAddPendingStatusId(null)
      }
    },
    [invalidateBoard, retryCreateMutation, runCreateMutation, selfStaffMemberId, t, timeProjectId],
  )

  const handleCreateStatus = React.useCallback(async () => {
    const name = statusDraft.trim()
    if (!name) {
      setComposingStatus(false)
      setStatusDraft('')
      return
    }
    try {
      await runCreateMutation({
        operation: () =>
          apiCallOrThrow(
            '/api/staff/timesheets/task-statuses',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ timeProjectId, name }),
            },
            { errorMessage: t('staff.time_tracking.board.addStatus.error', 'Could not add the column.') },
          ),
        context: {
          formId: CREATE_MUTATION_CONTEXT_ID,
          resourceKind: 'staff.timesheets.task_status',
          resourceId: timeProjectId,
          retryLastMutation: retryCreateMutation,
        },
      })
      setStatusDraft('')
      setComposingStatus(false)
      invalidateStatuses()
    } catch (error) {
      if (surfaceRecordConflict(error, t)) return
      flash(
        error instanceof Error && error.message
          ? error.message
          : t('staff.time_tracking.board.addStatus.error', 'Could not add the column.'),
        'error',
      )
    }
  }, [invalidateStatuses, retryCreateMutation, runCreateMutation, statusDraft, t, timeProjectId])

  const handleLoadMore = React.useCallback((statusId: string) => {
    setPagesByStatus((previous) => ({ ...previous, [statusId]: (previous[statusId] ?? 1) + 1 }))
  }, [])

  const openTask = React.useCallback(
    (taskId: string) => {
      // Seam for the task drawer (T3.7): the drawer reads `?task=` and the board keeps
      // rendering underneath it.
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      params.set('task', taskId)
      router.push(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  const handleAddTime = React.useCallback(
    (taskId: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      params.set('task', taskId)
      params.set('panel', 'time')
      router.push(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  const drawerTaskId = searchParams?.get('task') ?? null
  const drawerPanel = searchParams?.get('panel') ?? null

  const closeTaskDrawer = React.useCallback(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('task')
    params.delete('panel')
    const query = params.toString()
    router.push(query.length > 0 ? `?${query}` : '?', { scroll: false })
  }, [router, searchParams])

  const handleStartTimer = React.useCallback(
    async (taskId: string) => {
      if (!selfStaffMemberId) return
      const task = allTasks.find((entry) => entry.id === taskId) ?? null
      try {
        const started = await runCreateMutation({
          operation: () =>
            apiCallOrThrow<Record<string, unknown>>(
              '/api/staff/timesheets/time-entries/start-timer',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  staffMemberId: selfStaffMemberId,
                  timeProjectId,
                  date: new Date().toISOString().slice(0, 10),
                  notes: task?.title ?? null,
                }),
              },
              { errorMessage: t('staff.time_tracking.board.timer.startError', 'Could not start the timer.') },
            ),
          context: {
            formId: CREATE_MUTATION_CONTEXT_ID,
            resourceKind: 'staff.timesheets.time_entry',
            resourceId: taskId,
            retryLastMutation: retryCreateMutation,
          },
        })
        const entryId = typeof started?.result?.id === 'string' ? started.result.id : null
        if (entryId) {
          // `start-timer` creates the entry atomically but takes no task, so the link is a
          // second write. A failure here leaves a running, project-level timer rather than
          // no timer at all — the lesser of the two wrong states.
          const linked = await apiCall(`/api/staff/timesheets/time-entries`, {
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
      } catch (error) {
        if (surfaceRecordConflict(error, t)) return
        flash(
          error instanceof Error && error.message
            ? error.message
            : t('staff.time_tracking.board.timer.startError', 'Could not start the timer.'),
          'error',
        )
      }
    },
    [allTasks, retryCreateMutation, runCreateMutation, runningTimerQuery, selfStaffMemberId, t, timeProjectId],
  )

  const handleStopTimer = React.useCallback(async () => {
    if (!runningTimerEntryId) return
    try {
      await runCreateMutation({
        operation: () =>
          apiCallOrThrow(
            `/api/staff/timesheets/time-entries/${encodeURIComponent(runningTimerEntryId)}/timer-stop`,
            { method: 'POST' },
            { errorMessage: t('staff.time_tracking.board.timer.stopError', 'Could not stop the timer.') },
          ),
        context: {
          formId: CREATE_MUTATION_CONTEXT_ID,
          resourceKind: 'staff.timesheets.time_entry',
          resourceId: runningTimerEntryId,
          retryLastMutation: retryCreateMutation,
        },
      })
      await runningTimerQuery.refetch()
      invalidateBoard()
    } catch (error) {
      if (surfaceRecordConflict(error, t)) return
      flash(
        error instanceof Error && error.message
          ? error.message
          : t('staff.time_tracking.board.timer.stopError', 'Could not stop the timer.'),
        'error',
      )
    }
  }, [invalidateBoard, retryCreateMutation, runCreateMutation, runningTimerEntryId, runningTimerQuery, t])

  // Never fold `loggedMinutes` inline: a parent's figure already contains its children's,
  // so the shared helper — which drops any row whose parent is in the same set — is the
  // only thing standing between this number and risk R10.
  const summary = React.useMemo<BoardSummary>(
    () => ({ taskCount: allTasks.length, loggedMinutes: sumTaskLoggedMinutes(allTasks) }),
    [allTasks],
  )

  React.useEffect(() => {
    onSummaryChange?.(summary)
  }, [onSummaryChange, summary])

  if (statusesQuery.isLoading) {
    return <LoadingMessage label={t('staff.time_tracking.board.loading', 'Loading the board…')} />
  }

  if (statusesQuery.isError) {
    return (
      <ErrorMessage
        label={t('staff.time_tracking.board.loadError', 'Could not load the board.')}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => void statusesQuery.refetch()}>
            {t('staff.time_tracking.board.reload', 'Try again')}
          </Button>
        }
      />
    )
  }

  if (statuses.length === 0) {
    return (
      <EmptyState
        title={t('staff.time_tracking.board.empty.title', 'This project has no columns yet')}
        description={t(
          'staff.time_tracking.board.empty.description',
          'A Team Leader configures the board columns for each project.',
        )}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {failedMove ? (
        <Alert status="error" data-testid="kanban-move-retry">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>
              {t('staff.time_tracking.board.move.rolledBack', 'The task was moved back — the change was not saved.')}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const retry = failedMove
                setFailedMove(null)
                moveTask(retry.taskId, retry.targetStatusId)
              }}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              {t('staff.time_tracking.board.move.retry', 'Retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        measuring={measuringConfig}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div
          className={`flex min-w-0 gap-3.5 overflow-x-auto pb-6 ${
            activeDragTaskId ? 'cursor-grabbing select-none' : ''
          }`}
        >
          {visibleStatuses.map((status, index) => {
            const entry = tasksByStatusId.get(status.id)
            const serverTotal = entry?.total ?? 0
            const loaded = entry?.loaded ?? 0
            return (
              <KanbanColumn
                key={status.id}
                status={status}
                tasks={entry?.tasks ?? []}
                total={serverTotal}
                remaining={Math.max(0, serverTotal - loaded)}
                canQuickAdd={canManageTasks}
                loadingMore={columnQueries[index]?.isFetching ?? false}
                activeDragTaskId={activeDragTaskId}
                pendingTaskIds={pendingTaskIds}
                runningTimerTaskId={runningTimerTaskId}
                assigneeNames={assigneeQuery.data ?? new Map<string, string>()}
                tagsByTaskId={tagsByTaskId}
                subtasksByTaskId={subtasksByTaskId}
                quickAddPending={quickAddPendingStatusId === status.id}
                onQuickAdd={handleQuickAdd}
                onLoadMore={handleLoadMore}
                onOpenTask={openTask}
                onStartTimer={handleStartTimer}
                onStopTimer={handleStopTimer}
                onAddTime={handleAddTime}
              />
            )
          })}

          {canManageColumns ? (
            <div className="flex w-72 flex-none flex-col gap-3">
              {composingStatus ? (
                <Input
                  autoFocus
                  value={statusDraft}
                  onChange={(event) => setStatusDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleCreateStatus()
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setComposingStatus(false)
                      setStatusDraft('')
                    }
                  }}
                  placeholder={t('staff.time_tracking.board.addStatus.placeholder', 'Column name')}
                  aria-label={t('staff.time_tracking.board.addStatus.cta', 'Add status')}
                  data-testid="kanban-add-status-input"
                />
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setComposingStatus(true)}
                  data-testid="kanban-add-status"
                  className="flex h-24 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-muted-foreground/60 bg-muted/40 text-sm font-semibold leading-normal text-muted-foreground hover:text-foreground"
                >
                  <Plus className="size-5" aria-hidden="true" />
                  {t('staff.time_tracking.board.addStatus.cta', 'Add status')}
                </Button>
              )}
            </div>
          ) : null}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDragTask ? (
            <div
              data-testid="kanban-drag-overlay"
              className="pointer-events-none w-72 rotate-2 cursor-grabbing select-none rounded-lg border border-border bg-card px-4 py-3 opacity-80 shadow-xl"
            >
              <div className="text-sm font-semibold leading-normal text-foreground">
                {activeDragTask.title}
              </div>
              <div className="mt-2 text-xs font-semibold tabular-nums leading-normal text-muted-foreground">
                {formatBoardMinutes(activeDragTask.loggedMinutes)}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {drawerTaskId ? (
        <TaskDrawer
          taskId={drawerTaskId}
          open
          onOpenChange={(next) => {
            if (!next) closeTaskDrawer()
          }}
          projectName={projectName ?? null}
          focusPanel={drawerPanel}
          onChanged={invalidateBoard}
        />
      ) : null}
    </div>
  )
}

export default KanbanBoard
