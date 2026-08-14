"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { sumTaskLoggedMinutes } from '../timesheets-tasks/taskHoursTotals'
import {
  BOARD_PAGE_SIZE,
  BOARD_QUERY_ROOT,
  fetchTaskPages,
  useAssigneeNames,
  useTagLabels,
} from './boardDirectory'
import {
  boardServerFilterKey,
  boardServerFilterParams,
  matchesBoardTagFilter,
  type BoardFilters,
} from './boardFilters'
import {
  formatBoardMinutes,
  sortByPosition,
  toBoardTask,
  type BoardStatus,
  type BoardTask,
} from './kanbanBoardData'
import type { BoardSummary } from './boardSummary'

/**
 * "Lista" — the flat half of the screen-6 view switch.
 *
 * It is a real view over the same tasks, not a placeholder: the filter set, the hours
 * arithmetic and the drawer are already built, so the only thing missing was a table to
 * put them in. Unlike the board it asks the server for the status filter (it has no
 * columns to select), which is the one place the two views build their request
 * differently — see `boardFilters.ts`.
 */
export function TaskListView({
  timeProjectId,
  filters,
  statuses,
  onOpenTask,
  onSummaryChange,
}: {
  timeProjectId: string
  filters: BoardFilters
  statuses: readonly BoardStatus[]
  onOpenTask: (taskId: string) => void
  onSummaryChange?: (summary: BoardSummary) => void
}): React.ReactElement {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [pages, setPages] = React.useState(1)
  const filterKey = boardServerFilterKey(filters, { includeStatus: true })

  React.useEffect(() => {
    setPages(1)
  }, [filterKey, timeProjectId])

  const tasksQuery = useQuery({
    queryKey: [
      ...BOARD_QUERY_ROOT,
      'list',
      `scope:${scopeVersion}`,
      `project:${timeProjectId}`,
      `pages:${pages}`,
      `filters:${filterKey}`,
    ],
    staleTime: 15_000,
    queryFn: () =>
      fetchTaskPages(
        (page) =>
          `timeProjectId=${encodeURIComponent(timeProjectId)}&topLevelOnly=true&page=${page}&pageSize=${BOARD_PAGE_SIZE}&sortField=position&sortDir=asc${boardServerFilterParams(
            filters,
            { includeStatus: true },
          )}`,
        pages,
      ),
  })

  const loadedTasks = React.useMemo(() => {
    const rows = (tasksQuery.data?.items ?? [])
      .map(toBoardTask)
      .filter((task): task is BoardTask => task !== null)
    return sortByPosition(rows)
  }, [tasksQuery.data])

  const tasks = React.useMemo(
    () => loadedTasks.filter((task) => matchesBoardTagFilter(task.tagIds, filters)),
    [filters, loadedTasks],
  )

  const assigneeIds = React.useMemo(
    () =>
      tasks
        .map((task) => task.assigneeStaffMemberId)
        .filter((id): id is string => typeof id === 'string'),
    [tasks],
  )
  const tagIds = React.useMemo(() => tasks.flatMap((task) => task.tagIds), [tasks])
  const assigneeNames = useAssigneeNames(assigneeIds)
  const tagLabels = useTagLabels(tagIds)

  const statusNames = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const status of statuses) map.set(status.id, status.name)
    return map
  }, [statuses])

  const summary = React.useMemo<BoardSummary>(
    () => ({
      taskCount: tasks.length,
      loggedMinutes: sumTaskLoggedMinutes(tasks),
    }),
    [tasks],
  )

  React.useEffect(() => {
    onSummaryChange?.(summary)
  }, [onSummaryChange, summary])

  if (tasksQuery.isLoading) {
    return <LoadingMessage label={t('staff.time_tracking.board.loading', 'Loading the board…')} />
  }

  if (tasksQuery.isError) {
    return (
      <ErrorMessage
        label={t('staff.time_tracking.board.loadError', 'Could not load the board.')}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => void tasksQuery.refetch()}>
            {t('staff.time_tracking.board.reload', 'Try again')}
          </Button>
        }
      />
    )
  }

  if (tasks.length === 0) {
    return (
      <EmptyState
        title={t('staff.time_tracking.board.list.empty.title', 'No tasks match these filters')}
        description={t(
          'staff.time_tracking.board.list.empty.description',
          'Remove a filter chip to widen the view.',
        )}
      />
    )
  }

  const total = tasksQuery.data?.total ?? loadedTasks.length
  const remaining = Math.max(0, total - loadedTasks.length)

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm" data-testid="board-task-list">
          <caption className="sr-only">
            {t('staff.time_tracking.board.list.caption', 'Tasks')}
          </caption>
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left">
              <th scope="col" className="px-3 py-2.5 font-semibold text-muted-foreground">
                {t('staff.time_tracking.board.list.columns.reference', 'Ref.')}
              </th>
              <th scope="col" className="px-3 py-2.5 font-semibold text-muted-foreground">
                {t('staff.time_tracking.board.list.columns.title', 'Task')}
              </th>
              <th scope="col" className="px-3 py-2.5 font-semibold text-muted-foreground">
                {t('staff.time_tracking.board.list.columns.status', 'Status')}
              </th>
              <th scope="col" className="px-3 py-2.5 font-semibold text-muted-foreground">
                {t('staff.time_tracking.board.list.columns.assignee', 'Assignee')}
              </th>
              <th scope="col" className="px-3 py-2.5 font-semibold text-muted-foreground">
                {t('staff.time_tracking.board.list.columns.tags', 'Tags')}
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold text-muted-foreground">
                {t('staff.time_tracking.board.list.columns.hours', 'Logged')}
              </th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr
                key={task.id}
                data-task-row={task.id}
                className="border-b border-border last:border-b-0 hover:bg-muted/40"
              >
                <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">
                  {task.reference ?? '—'}
                </td>
                <td className="px-3 py-2.5">
                  <Button
                    type="button"
                    variant="link"
                    size="2xs"
                    onClick={() => onOpenTask(task.id)}
                    className="h-auto px-0 text-left text-sm font-semibold text-foreground"
                  >
                    {task.title}
                  </Button>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  {task.taskStatusId ? statusNames.get(task.taskStatusId) ?? '—' : '—'}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  {task.assigneeStaffMemberId
                    ? assigneeNames.data?.get(task.assigneeStaffMemberId) ??
                      t('staff.time_tracking.board.card.unassigned', 'Unassigned')
                    : t('staff.time_tracking.board.card.unassigned', 'Unassigned')}
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex flex-wrap gap-1">
                    {task.tagIds.map((tagId) => (
                      <Badge key={tagId} variant="neutral" size="sm">
                        {tagLabels.data?.get(tagId) ?? tagId}
                      </Badge>
                    ))}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">
                  {formatBoardMinutes(task.loggedMinutes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {remaining > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={tasksQuery.isFetching}
          onClick={() => setPages((previous) => previous + 1)}
          data-testid="board-task-list-load-more"
          className="self-start rounded-lg border border-dashed border-muted-foreground/60 text-muted-foreground"
        >
          {tasksQuery.isFetching ? (
            <Spinner className="size-4" />
          ) : (
            t('staff.time_tracking.board.loadMore', 'Show more ({remaining})', { remaining })
          )}
        </Button>
      ) : null}
    </div>
  )
}

export default TaskListView
