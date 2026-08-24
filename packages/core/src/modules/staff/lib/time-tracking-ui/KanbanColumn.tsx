"use client"

import * as React from 'react'
import { z } from 'zod'
import { useDroppable } from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { registerComponent } from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { callbackProp, opaqueProp, optionalCallbackProp } from '../time-tracking/componentContracts'
import { KanbanCard, type KanbanMoveTarget, type KanbanTagOption } from './KanbanCard'
import {
  columnLoggedMinutes,
  formatBoardMinutes,
  statusAccentColor,
  type BoardStatus,
  type BoardTask,
  type SubtaskProgress,
} from './kanbanBoardData'

export const KANBAN_COLUMN_DROPPABLE_PREFIX = 'kanban-column:'

export type KanbanColumnProps = {
  status: BoardStatus
  tasks: BoardTask[]
  /** What the count badge says — the number of cards this column is presenting. */
  total: number
  /**
   * Rows the server still holds beyond what was loaded. Defaults to `total - tasks.length`,
   * which is right whenever every loaded row is rendered; the board overrides it under a
   * client-side tag filter, where the badge counts matches but "show more" must keep
   * counting unfetched rows.
   */
  remaining?: number
  /** `staff.timesheets.tasks.manage` — the quick-add is absent without it, never disabled. */
  canQuickAdd?: boolean
  loadingMore: boolean
  activeDragTaskId: string | null
  pendingTaskIds: ReadonlySet<string>
  runningTimerTaskId: string | null
  assigneeNames: ReadonlyMap<string, string>
  tagsByTaskId: ReadonlyMap<string, KanbanTagOption[]>
  subtasksByTaskId: ReadonlyMap<string, SubtaskProgress>
  quickAddPending: boolean
  /** Every board column; the card menu is offered the ones other than this column. */
  moveTargets?: readonly KanbanMoveTarget[]
  onQuickAdd: (statusId: string, title: string) => Promise<void>
  onLoadMore: (statusId: string) => void
  onOpenTask: (taskId: string) => void
  onStartTimer: (taskId: string) => void
  onStopTimer: (taskId: string) => void
  onAddTime: (taskId: string) => void
  onMoveTask?: (taskId: string, targetStatusId: string) => void
}

const EMPTY_MOVE_TARGETS: readonly KanbanMoveTarget[] = []

/**
 * One board column (mockup `kcol`): accent bar in the status colour, name, count
 * badge and the column's summed hours, then the in-place quick-add and the cards.
 *
 * The droppable is the card list, so `isOver` reads exactly when the pointer is over
 * the area a card would land in. While a drag is live the list renders a dashed drop
 * placeholder at the top — the slot the optimistic update will put the card into
 * (note 1), so the preview and the landing position agree.
 */
function KanbanColumnImpl({
  status,
  tasks,
  total,
  remaining,
  canQuickAdd = true,
  loadingMore,
  activeDragTaskId,
  pendingTaskIds,
  runningTimerTaskId,
  assigneeNames,
  tagsByTaskId,
  subtasksByTaskId,
  quickAddPending,
  moveTargets = EMPTY_MOVE_TARGETS,
  onQuickAdd,
  onLoadMore,
  onOpenTask,
  onStartTimer,
  onStopTimer,
  onAddTime,
  onMoveTask,
}: KanbanColumnProps): React.ReactElement {
  const t = useT()
  const [composing, setComposing] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const { setNodeRef, isOver } = useDroppable({
    id: `${KANBAN_COLUMN_DROPPABLE_PREFIX}${status.id}`,
    data: { type: 'kanban-column', statusId: status.id },
  })

  const isDragActive = activeDragTaskId !== null
  const isSourceColumn = isDragActive && tasks.some((task) => task.id === activeDragTaskId)
  const showDropPlaceholder = isDragActive && (isOver || !isSourceColumn)

  React.useEffect(() => {
    if (composing) inputRef.current?.focus()
  }, [composing])

  const minutes = React.useMemo(() => columnLoggedMinutes(tasks), [tasks])

  const cardMoveTargets = React.useMemo(
    () => moveTargets.filter((target) => target.id !== status.id),
    [moveTargets, status.id],
  )

  const submitDraft = React.useCallback(async () => {
    const title = draft.trim()
    if (!title) {
      setComposing(false)
      setDraft('')
      return
    }
    await onQuickAdd(status.id, title)
    // Stay open so a run of tasks can be typed without re-opening the field.
    setDraft('')
    inputRef.current?.focus()
  }, [draft, onQuickAdd, status.id])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        void submitDraft()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setComposing(false)
        setDraft('')
      }
    },
    [submitDraft],
  )

  const remainingRows = remaining ?? total - tasks.length
  const hasMore = remainingRows > 0
  const countBadgeVariant = status.isDone ? 'success' : 'neutral'

  return (
    <div className="flex w-72 flex-none flex-col gap-3" data-kanban-column={status.id}>
      <div className="flex flex-col gap-2.5 overflow-clip rounded-lg bg-muted/40 px-4 py-3.5">
        <div
          className="h-1.5 w-full rounded-sm"
          style={{ backgroundColor: statusAccentColor(status) }}
          aria-hidden="true"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="truncate text-sm font-bold uppercase leading-normal text-foreground">
              {status.name}
            </span>
            <Badge variant={countBadgeVariant} size="sm" data-testid={`kanban-count-${status.id}`}>
              {total}
            </Badge>
          </div>
          <span
            className="shrink-0 text-sm font-bold tabular-nums leading-normal text-foreground"
            data-testid={`kanban-hours-${status.id}`}
          >
            {formatBoardMinutes(minutes)}
          </span>
          <InjectionSpot
            spotId={extensionPoints.hosts.taskBoardColumnHeader.spotId}
            context={{ statusId: status.id, statusName: status.name, isDone: status.isDone, total, loggedMinutes: minutes }}
            data={tasks}
          />
        </div>
      </div>

      {!canQuickAdd ? null : composing ? (
        <Input
          ref={inputRef}
          value={draft}
          disabled={quickAddPending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (!draft.trim()) setComposing(false)
          }}
          placeholder={t('staff.time_tracking.board.quickAdd.placeholder', 'Task title')}
          aria-label={t('staff.time_tracking.board.quickAdd.label', 'Quickly add a task')}
          data-testid={`kanban-quick-add-input-${status.id}`}
        />
      ) : (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setComposing(true)}
          data-testid={`kanban-quick-add-${status.id}`}
          className="flex h-11 items-center justify-center gap-2.5 rounded-lg border border-dashed border-muted-foreground/60 bg-muted/40 text-sm font-semibold leading-normal text-foreground hover:bg-muted/70"
        >
          <Plus className="size-4" aria-hidden="true" />
          {t('staff.time_tracking.board.quickAdd.cta', 'Quickly add a task')}
        </Button>
      )}

      <div
        ref={setNodeRef}
        data-testid={`kanban-dropzone-${status.id}`}
        className={`flex min-h-40 flex-col gap-3 rounded-lg p-1.5 ${
          isOver ? 'bg-muted/60 outline-dashed outline-2 outline-muted-foreground -outline-offset-2' : ''
        }`}
      >
        {showDropPlaceholder ? (
          <div
            data-testid={`kanban-drop-placeholder-${status.id}`}
            className="h-16 rounded-lg border border-dashed border-muted-foreground/60 bg-muted/30"
            aria-hidden="true"
          />
        ) : null}
        {tasks.map((task) => (
          <KanbanCard
            key={task.id}
            task={task}
            assigneeName={
              task.assigneeStaffMemberId ? assigneeNames.get(task.assigneeStaffMemberId) ?? null : null
            }
            tags={tagsByTaskId.get(task.id) ?? []}
            subtasks={subtasksByTaskId.get(task.id) ?? null}
            timerRunning={runningTimerTaskId === task.id}
            pending={pendingTaskIds.has(task.id)}
            isActiveDrag={activeDragTaskId === task.id}
            moveTargets={cardMoveTargets}
            onOpen={onOpenTask}
            onStartTimer={onStartTimer}
            onStopTimer={onStopTimer}
            onAddTime={onAddTime}
            onMoveToColumn={onMoveTask}
          />
        ))}
        {hasMore ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loadingMore}
            onClick={() => onLoadMore(status.id)}
            data-testid={`kanban-load-more-${status.id}`}
            className="rounded-lg border border-dashed border-muted-foreground/60 text-muted-foreground"
          >
            {loadingMore ? (
              <Spinner className="size-4" />
            ) : (
              t('staff.time_tracking.board.loadMore', 'Show more ({remaining})', {
                remaining: remainingRows,
              })
            )}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

const DefaultKanbanColumn = React.memo(KanbanColumnImpl)

const kanbanColumnPropsSchema: z.ZodType<KanbanColumnProps> = z.object({
  status: opaqueProp<BoardStatus>(),
  tasks: z.array(opaqueProp<BoardTask>()),
  total: z.number(),
  remaining: z.number().optional(),
  canQuickAdd: z.boolean().optional(),
  loadingMore: z.boolean(),
  activeDragTaskId: z.string().nullable(),
  pendingTaskIds: opaqueProp<ReadonlySet<string>>(),
  runningTimerTaskId: z.string().nullable(),
  assigneeNames: opaqueProp<ReadonlyMap<string, string>>(),
  tagsByTaskId: opaqueProp<ReadonlyMap<string, KanbanTagOption[]>>(),
  subtasksByTaskId: opaqueProp<ReadonlyMap<string, SubtaskProgress>>(),
  quickAddPending: z.boolean(),
  moveTargets: opaqueProp<readonly KanbanMoveTarget[]>().optional(),
  onQuickAdd: callbackProp<(statusId: string, title: string) => Promise<void>>(),
  onLoadMore: callbackProp<(statusId: string) => void>(),
  onOpenTask: callbackProp<(taskId: string) => void>(),
  onStartTimer: callbackProp<(taskId: string) => void>(),
  onStopTimer: callbackProp<(taskId: string) => void>(),
  onAddTime: callbackProp<(taskId: string) => void>(),
  onMoveTask: optionalCallbackProp<(taskId: string, targetStatusId: string) => void>(),
})

registerComponent<KanbanColumnProps>({
  id: extensionPoints.hosts.kanbanColumnComponent.componentId,
  component: DefaultKanbanColumn,
  metadata: {
    module: 'staff',
    description: 'One status column of the time-tracking Kanban board.',
    propsSchema: kanbanColumnPropsSchema,
  },
})

function KanbanColumnHost(props: KanbanColumnProps): React.ReactElement {
  const Resolved = useRegisteredComponent<KanbanColumnProps>(
    extensionPoints.hosts.kanbanColumnComponent.componentId,
    DefaultKanbanColumn,
  )
  return <Resolved {...props} />
}

export const KanbanColumn = React.memo(KanbanColumnHost)

export default KanbanColumn
