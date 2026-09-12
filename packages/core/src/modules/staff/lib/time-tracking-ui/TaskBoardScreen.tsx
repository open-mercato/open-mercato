"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { LayoutGrid, List, Plus, SlidersHorizontal } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { BOARD_QUERY_ROOT, useBoardSelf, useBoardStatuses } from './boardDirectory'
import { countActiveBoardFilters } from './boardFilters'
import { BoardFilterChips, AddBoardFilterPopover } from './BoardFilterChips'
import { EMPTY_BOARD_SUMMARY, type BoardSummary } from './boardSummary'
import { KanbanBoard, MANAGE_TASKS_FEATURE } from './KanbanBoard'
import { formatBoardMinutes } from './kanbanBoardData'
import { NewTaskDialog } from './NewTaskDialog'
import { TaskDrawer } from './TaskDrawer'
import { TaskListView } from './TaskListView'
import { useBoardFilters, useBoardViewMode } from './useBoardFilters'

/**
 * Screen 6 in one piece — the page head, the filter chip row and whichever view is
 * selected.
 *
 * Both board routes (the module-level `?projectId=` one and the per-project one) render
 * this, so the chrome cannot drift between them. The head's subtitle is reported upward
 * by the active view rather than fetched again here: the count and the hours then always
 * describe the rows on screen, filters included.
 */
export function TaskBoardScreen({
  timeProjectId,
  projectName,
  headerActions,
}: {
  timeProjectId: string
  projectName?: string | null
  /** Route-specific controls (the project picker, "back to project") placed before the switch. */
  headerActions?: React.ReactNode
}): React.ReactElement {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const { payload } = useBackendChrome()
  const canManageTasks = hasFeature(payload?.grantedFeatures, MANAGE_TASKS_FEATURE)

  const selfQuery = useBoardSelf()
  const statusesQuery = useBoardStatuses(timeProjectId)
  const statuses = React.useMemo(() => statusesQuery.data ?? [], [statusesQuery.data])

  const [filters, setFilters] = useBoardFilters({ timeProjectId })
  const [view, setView] = useBoardViewMode()
  const [summary, setSummary] = React.useState<BoardSummary>(EMPTY_BOARD_SUMMARY)
  const [newTaskOpen, setNewTaskOpen] = React.useState(false)

  const handleSummaryChange = React.useCallback((next: BoardSummary) => {
    setSummary((previous) =>
      previous.taskCount === next.taskCount && previous.loggedMinutes === next.loggedMinutes
        ? previous
        : next,
    )
  }, [])

  const openTask = React.useCallback(
    (taskId: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      params.set('task', taskId)
      router.push(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  const closeTask = React.useCallback(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('task')
    params.delete('panel')
    const query = params.toString()
    router.push(query.length > 0 ? `?${query}` : '?', { scroll: false })
  }, [router, searchParams])

  const invalidateTasks = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [...BOARD_QUERY_ROOT] }).catch(() => {})
  }, [queryClient])

  const description = React.useMemo(() => {
    const parts = [
      projectName ?? null,
      t('staff.time_tracking.board.summary.tasks', '{count} tasks', { count: summary.taskCount }),
      t('staff.time_tracking.board.summary.logged', '{hours} logged', {
        hours: formatBoardMinutes(summary.loggedMinutes),
      }),
    ].filter((part): part is string => !!part && part.length > 0)
    return parts.join(' · ')
  }, [projectName, summary, t])

  const activeFilterCount = countActiveBoardFilters(filters)
  const boardLabel = t('staff.time_tracking.board.view.board', 'Board')
  const listLabel = t('staff.time_tracking.board.view.list', 'List')

  const drawerTaskId = searchParams?.get('task') ?? null
  const drawerPanel = searchParams?.get('panel') ?? null

  return (
    <>
      <PageHeader
        title={t('staff.time_tracking.nav.tasks', 'Tasks')}
        description={description}
        actions={
          <>
            {headerActions}
            <div
              role="group"
              aria-label={t('staff.time_tracking.board.view.label', 'View')}
              className="inline-flex items-center rounded-md border border-border p-0.5"
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={view === 'board'}
                data-testid="board-view-board"
                className={`h-auto gap-1.5 px-2.5 py-1 text-xs ${
                  view === 'board'
                    ? 'bg-foreground text-background hover:bg-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
                onClick={() => setView('board')}
              >
                <LayoutGrid className="size-3.5" aria-hidden="true" />
                {boardLabel}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={view === 'list'}
                data-testid="board-view-list"
                className={`h-auto gap-1.5 px-2.5 py-1 text-xs ${
                  view === 'list'
                    ? 'bg-foreground text-background hover:bg-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
                onClick={() => setView('list')}
              >
                <List className="size-3.5" aria-hidden="true" />
                {listLabel}
              </Button>
            </div>

            <AddBoardFilterPopover
              filters={filters}
              onChange={setFilters}
              self={selfQuery.data ?? null}
              statuses={statuses}
              testId="board-filters-button"
              trigger={
                <Button type="button" variant="outline" size="sm" data-testid="board-filters-button">
                  <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                  {t('staff.time_tracking.board.filters.cta', 'Filters')}
                  {activeFilterCount > 0 ? (
                    <Badge variant="neutral" size="sm" data-testid="board-filters-count">
                      {activeFilterCount}
                    </Badge>
                  ) : null}
                </Button>
              }
            />

            {canManageTasks ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setNewTaskOpen(true)}
                data-testid="board-new-task"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                {t('staff.time_tracking.board.newTask.cta', 'New task')}
              </Button>
            ) : null}
          </>
        }
      />

      <PageBody>
        <BoardFilterChips
          filters={filters}
          onChange={setFilters}
          self={selfQuery.data ?? null}
          statuses={statuses}
        />

        {view === 'board' ? (
          <KanbanBoard
            timeProjectId={timeProjectId}
            projectName={projectName ?? null}
            filters={filters}
            onSummaryChange={handleSummaryChange}
          />
        ) : (
          <TaskListView
            timeProjectId={timeProjectId}
            filters={filters}
            statuses={statuses}
            onOpenTask={openTask}
            onSummaryChange={handleSummaryChange}
          />
        )}
      </PageBody>

      {canManageTasks ? (
        <NewTaskDialog
          open={newTaskOpen}
          onOpenChange={setNewTaskOpen}
          timeProjectId={timeProjectId}
          statuses={statuses}
          assigneeStaffMemberId={selfQuery.data?.id ?? null}
          onCreated={(taskId) => {
            invalidateTasks()
            if (taskId) openTask(taskId)
          }}
        />
      ) : null}

      {view === 'list' && drawerTaskId ? (
        <TaskDrawer
          taskId={drawerTaskId}
          open
          onOpenChange={(next) => {
            if (!next) closeTask()
          }}
          projectName={projectName ?? null}
          focusPanel={drawerPanel}
          onChanged={invalidateTasks}
        />
      ) : null}
    </>
  )
}

export default TaskBoardScreen
