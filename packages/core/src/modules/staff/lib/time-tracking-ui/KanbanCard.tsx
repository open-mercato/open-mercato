"use client"

import * as React from 'react'
import { z } from 'zod'
import { useDraggable } from '@dnd-kit/core'
import { ArrowRightLeft, Check, Play, Plus, Square } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { registerComponent } from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { callbackProp, opaqueProp, optionalCallbackProp } from '../time-tracking/componentContracts'
import {
  formatBoardMinutes,
  initialsFromName,
  type BoardTask,
  type SubtaskProgress,
} from './kanbanBoardData'

/**
 * Quick actions are hover- and focus-revealed on a pointer device (mockup note 3),
 * which leaves them unreachable on a touch screen where neither state exists. The
 * media query is read at runtime rather than expressed as a Tailwind variant so the
 * card can hand the same `visible` decision to both the class list and the tests.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = React.useState(false)
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(hover: none)')
    setCoarse(query.matches)
    const listener = (event: MediaQueryListEvent) => setCoarse(event.matches)
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', listener)
      return () => query.removeEventListener('change', listener)
    }
    return undefined
  }, [])
  return coarse
}

const TASK_ENTITY_ID = 'staff:staff_time_task'

export type KanbanTagOption = {
  id: string
  label: string
}

/** A column this card can be moved into — every board column except its own. */
export type KanbanMoveTarget = {
  id: string
  name: string
}

export type KanbanCardProps = {
  task: BoardTask
  assigneeName: string | null
  tags: KanbanTagOption[]
  subtasks: SubtaskProgress | null
  /** A running timer marks the card permanently — never hover-dependent (note 3). */
  timerRunning: boolean
  pending: boolean
  isActiveDrag: boolean
  /**
   * Columns offered by the keyboard move menu. Empty (the default) hides the
   * control, which is what a single-column board should do.
   */
  moveTargets?: readonly KanbanMoveTarget[]
  onOpen: (taskId: string) => void
  onStartTimer: (taskId: string) => void
  onStopTimer: (taskId: string) => void
  onAddTime: (taskId: string) => void
  /** Same move the drag performs — optimistic update, lock header, rollback and all. */
  onMoveToColumn?: (taskId: string, targetStatusId: string) => void
}

const EMPTY_MOVE_TARGETS: readonly KanbanMoveTarget[] = []

function KanbanCardImpl({
  task,
  assigneeName,
  tags,
  subtasks,
  timerRunning,
  pending,
  isActiveDrag,
  moveTargets = EMPTY_MOVE_TARGETS,
  onOpen,
  onStartTimer,
  onStopTimer,
  onAddTime,
  onMoveToColumn,
}: KanbanCardProps): React.ReactElement {
  const t = useT()
  const coarsePointer = useCoarsePointer()
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { type: 'task', taskStatusId: task.taskStatusId },
  })
  const dimmed = isActiveDrag || isDragging

  // dnd-kit's draggable listeners take pointer capture on the card, which rewrites the
  // subsequent click's target to the card itself and swallows the inner buttons. Cutting
  // the pointerdown at the action row keeps Start / Stop / Add time clickable.
  const stopPointerDown = React.useCallback((event: React.PointerEvent) => {
    event.stopPropagation()
  }, [])

  const handleCardClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement
      if (target.closest('[data-card-action="true"]')) return
      onOpen(task.id)
    },
    [onOpen, task.id],
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter') return
      const target = event.target as HTMLElement
      if (target.closest('[data-card-action="true"]')) return
      event.preventDefault()
      onOpen(task.id)
    },
    [onOpen, task.id],
  )

  // Keyboard operability of the board does NOT go through dnd-kit: its keyboard sensor
  // would have to own Enter/Space on the card, and Enter is what opens the drawer. The
  // move is an explicit menu instead — same `onMoveToColumn` the drop calls, so a keyboard
  // move is the identical optimistic, version-locked request a drag issues.
  const [moveMenuOpen, setMoveMenuOpen] = React.useState(false)
  const moveTriggerRef = React.useRef<HTMLButtonElement | null>(null)
  const moveMenuRef = React.useRef<HTMLDivElement | null>(null)
  const moveItemRefs = React.useRef<(HTMLButtonElement | null)[]>([])
  const showMoveMenu = moveTargets.length > 0 && typeof onMoveToColumn === 'function'

  React.useEffect(() => {
    if (!moveMenuOpen) return
    moveItemRefs.current[0]?.focus()
  }, [moveMenuOpen])

  React.useEffect(() => {
    if (!moveMenuOpen) return
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (moveMenuRef.current?.contains(target)) return
      if (moveTriggerRef.current?.contains(target)) return
      setMoveMenuOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [moveMenuOpen])

  const closeMoveMenu = React.useCallback(() => {
    setMoveMenuOpen(false)
    moveTriggerRef.current?.focus()
  }, [])

  const handleMoveMenuKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMoveMenu()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const items = moveItemRefs.current.filter(
        (item): item is HTMLButtonElement => item !== null && item.isConnected,
      )
      if (items.length === 0) return
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      const step = event.key === 'ArrowDown' ? 1 : -1
      const next = current < 0 ? 0 : (current + step + items.length) % items.length
      items[next]?.focus()
    },
    [closeMoveMenu],
  )

  const handleMoveSelect = React.useCallback(
    (targetStatusId: string) => {
      setMoveMenuOpen(false)
      moveTriggerRef.current?.focus()
      onMoveToColumn?.(task.id, targetStatusId)
    },
    [onMoveToColumn, task.id],
  )

  const quickActionsVisible = coarsePointer
    ? 'opacity-100'
    : 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'

  const cardInjectionContext = React.useMemo(
    () => ({
      entityId: TASK_ENTITY_ID,
      recordId: task.id,
      taskId: task.id,
      timeProjectId: task.timeProjectId ?? null,
      taskStatusId: task.taskStatusId ?? null,
      timerRunning,
    }),
    [task.id, task.taskStatusId, task.timeProjectId, timerRunning],
  )

  const subtaskPercent = subtasks && subtasks.total > 0
    ? Math.round((subtasks.done / subtasks.total) * 100)
    : 0

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-task-card={task.id}
      aria-label={t('staff.time_tracking.board.card.aria', 'Task: {title}', { title: task.title })}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      className={`group relative flex w-full flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3 shadow-xs transition-shadow ${
        dimmed ? 'cursor-grabbing opacity-30' : 'cursor-grab hover:shadow-sm active:cursor-grabbing'
      } ${pending ? 'opacity-70' : ''}`}
    >
      <div className="text-sm font-semibold leading-normal text-foreground">{task.title}</div>

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Badge key={tag.id} variant="info" size="sm">
              {tag.label}
            </Badge>
          ))}
        </div>
      ) : null}

      <InjectionSpot
        spotId={extensionPoints.hosts.taskBoardCardBadges.spotId}
        context={cardInjectionContext}
        data={task}
      />

      {subtasks && subtasks.total > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1 text-xs font-medium leading-normal text-muted-foreground">
            <Check className="size-3" aria-hidden="true" />
            {t('staff.time_tracking.board.card.subtasks', '{done}/{total} subtasks', {
              done: subtasks.done,
              total: subtasks.total,
            })}
          </span>
          <Progress value={subtaskPercent} size="sm" tone="success" />
        </div>
      ) : null}

      <div className="h-px w-full bg-border" aria-hidden="true" />

      <div className="flex items-center gap-2">
        <Avatar
          size="xs"
          label={initialsFromName(assigneeName)}
          ariaLabel={
            assigneeName
              ? t('staff.time_tracking.board.card.assignee', 'Assigned to {name}', { name: assigneeName })
              : t('staff.time_tracking.board.card.unassigned', 'Unassigned')
          }
        />
        {timerRunning ? (
          <Badge variant="success" size="sm" dot>
            {t('staff.time_tracking.board.card.timerRunning', 'timer')}
          </Badge>
        ) : null}
        <span className="grow" />
        <span className="text-xs font-semibold tabular-nums leading-normal text-foreground">
          {formatBoardMinutes(task.loggedMinutes)}
        </span>
      </div>

      <div
        data-card-action="true"
        data-testid={`kanban-card-actions-${task.id}`}
        onPointerDown={stopPointerDown}
        className={`flex flex-wrap items-center gap-1.5 ${moveMenuOpen ? 'opacity-100' : quickActionsVisible}`}
      >
        {timerRunning ? (
          <Button
            type="button"
            variant="outline"
            size="2xs"
            aria-label={t('staff.time_tracking.board.card.stopTimerAria', 'Stop the timer for {title}', {
              title: task.title,
            })}
            onClick={() => onStopTimer(task.id)}
          >
            <Square className="size-3" aria-hidden="true" />
            {t('staff.time_tracking.board.card.stopTimer', 'Stop')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="2xs"
            aria-label={t('staff.time_tracking.board.card.startTimerAria', 'Start a timer for {title}', {
              title: task.title,
            })}
            onClick={() => onStartTimer(task.id)}
          >
            <Play className="size-3" aria-hidden="true" />
            {t('staff.time_tracking.board.card.startTimer', 'Start')}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="2xs"
          aria-label={t('staff.time_tracking.board.card.addTimeAria', 'Add time to {title}', {
            title: task.title,
          })}
          onClick={() => onAddTime(task.id)}
        >
          <Plus className="size-3" aria-hidden="true" />
          {t('staff.time_tracking.board.card.addTime', 'Add time')}
        </Button>
        {showMoveMenu ? (
          <div className="relative">
            <Button
              ref={moveTriggerRef}
              type="button"
              variant="outline"
              size="2xs"
              aria-haspopup="menu"
              aria-expanded={moveMenuOpen}
              aria-label={t('staff.time_tracking.board.card.moveTo.aria', 'Move {title} to another column', {
                title: task.title,
              })}
              data-testid={`kanban-card-move-${task.id}`}
              onClick={() => setMoveMenuOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown') return
                event.preventDefault()
                setMoveMenuOpen(true)
              }}
            >
              <ArrowRightLeft className="size-3" aria-hidden="true" />
              {t('staff.time_tracking.board.card.moveTo.cta', 'Move')}
            </Button>
            {moveMenuOpen ? (
              <div
                ref={moveMenuRef}
                role="menu"
                aria-label={t('staff.time_tracking.board.card.moveTo.menu', 'Move {title} to', {
                  title: task.title,
                })}
                data-testid={`kanban-card-move-menu-${task.id}`}
                onKeyDown={handleMoveMenuKeyDown}
                className="absolute bottom-full left-0 z-dropdown mb-1 flex min-w-40 flex-col gap-0.5 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
              >
                {moveTargets.map((target, index) => (
                  <Button
                    key={target.id}
                    ref={(node: HTMLButtonElement | null) => {
                      moveItemRefs.current[index] = node
                    }}
                    type="button"
                    variant="ghost"
                    size="2xs"
                    role="menuitem"
                    className="justify-start"
                    data-testid={`kanban-card-move-option-${task.id}-${target.id}`}
                    onClick={() => handleMoveSelect(target.id)}
                  >
                    {target.name}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <InjectionSpot
        spotId={extensionPoints.hosts.taskBoardCardFooter.spotId}
        context={cardInjectionContext}
        data={task}
      />
    </div>
  )
}

const DefaultKanbanCard = React.memo(KanbanCardImpl)

const kanbanTagOptionSchema = z.object({ id: z.string(), label: z.string() })

const kanbanMoveTargetSchema = z.object({ id: z.string(), name: z.string() })

const kanbanCardPropsSchema: z.ZodType<KanbanCardProps> = z.object({
  task: opaqueProp<BoardTask>(),
  assigneeName: z.string().nullable(),
  tags: z.array(kanbanTagOptionSchema),
  subtasks: opaqueProp<SubtaskProgress>().nullable(),
  timerRunning: z.boolean(),
  pending: z.boolean(),
  isActiveDrag: z.boolean(),
  moveTargets: z.array(kanbanMoveTargetSchema).optional(),
  onOpen: callbackProp<(taskId: string) => void>(),
  onStartTimer: callbackProp<(taskId: string) => void>(),
  onStopTimer: callbackProp<(taskId: string) => void>(),
  onAddTime: callbackProp<(taskId: string) => void>(),
  onMoveToColumn: optionalCallbackProp<(taskId: string, targetStatusId: string) => void>(),
})

registerComponent<KanbanCardProps>({
  id: extensionPoints.hosts.kanbanCardComponent.componentId,
  component: DefaultKanbanCard,
  metadata: {
    module: 'staff',
    description: 'One task card on the time-tracking Kanban board.',
    propsSchema: kanbanCardPropsSchema,
  },
})

function KanbanCardHost(props: KanbanCardProps): React.ReactElement {
  const Resolved = useRegisteredComponent<KanbanCardProps>(
    extensionPoints.hosts.kanbanCardComponent.componentId,
    DefaultKanbanCard,
  )
  return <Resolved {...props} />
}

export const KanbanCard = React.memo(KanbanCardHost)

export default KanbanCard
