"use client"

import * as React from 'react'
import { useDraggable } from '@dnd-kit/core'
import { Check, Play, Plus, Square } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { useT } from '@open-mercato/shared/lib/i18n/context'
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

export type KanbanTagOption = {
  id: string
  label: string
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
  onOpen: (taskId: string) => void
  onStartTimer: (taskId: string) => void
  onStopTimer: (taskId: string) => void
  onAddTime: (taskId: string) => void
}

function KanbanCardImpl({
  task,
  assigneeName,
  tags,
  subtasks,
  timerRunning,
  pending,
  isActiveDrag,
  onOpen,
  onStartTimer,
  onStopTimer,
  onAddTime,
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

  const quickActionsVisible = coarsePointer
    ? 'opacity-100'
    : 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'

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
        className={`flex flex-wrap items-center gap-1.5 ${quickActionsVisible}`}
      >
        {timerRunning ? (
          <Button
            type="button"
            variant="outline"
            size="2xs"
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
            onClick={() => onStartTimer(task.id)}
          >
            <Play className="size-3" aria-hidden="true" />
            {t('staff.time_tracking.board.card.startTimer', 'Start')}
          </Button>
        )}
        <Button type="button" variant="outline" size="2xs" onClick={() => onAddTime(task.id)}>
          <Plus className="size-3" aria-hidden="true" />
          {t('staff.time_tracking.board.card.addTime', 'Add time')}
        </Button>
      </div>
    </div>
  )
}

export const KanbanCard = React.memo(KanbanCardImpl)

export default KanbanCard
