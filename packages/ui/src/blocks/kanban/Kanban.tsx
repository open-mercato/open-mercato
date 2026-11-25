"use client"

import * as React from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { Move } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import { LoadingMessage } from '@open-mercato/ui/backend/detail/LoadingMessage'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dropdown,
  DropdownCaption,
  DropdownContent,
  DropdownItem,
  DropdownList,
  DropdownTrigger,
} from '@open-mercato/ui/primitives/dropdown'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import type { KanbanCard, KanbanColumn, KanbanMoveRejection, KanbanProps } from '../contracts/kanban'
import {
  KANBAN_CARD_DROPPABLE_PREFIX,
  KANBAN_COLUMN_DROPPABLE_PREFIX,
  applyPendingMoves,
  computeToIndex,
  findCardLocation,
  isNoopMove,
  resolveDropTarget,
  type KanbanPendingMove,
} from './board-state'

type TranslateFn = ReturnType<typeof useT>

type DropIndicator = { columnId: string; toIndex: number }

type MoveTarget = { id: string; title: string; rejection: KanbanMoveRejection | null }

const CARD_ACTION_ATTRIBUTE = 'data-kanban-card-action'

function rejectionOf(
  canMove: KanbanProps['canMove'],
  cardId: string,
  toColumnId: string,
): KanbanMoveRejection | null {
  if (!canMove) return null
  const result = canMove(cardId, toColumnId)
  return result === true ? null : result
}

function asId(value: UniqueIdentifier | null | undefined): string | null {
  return typeof value === 'string' ? value : null
}

function isPlacedAfter(event: DragMoveEvent | DragOverEvent | DragEndEvent): boolean {
  const activeRect = event.active.rect.current.translated
  const overRect = event.over?.rect
  if (!activeRect || !overRect) return false
  return activeRect.top + activeRect.height / 2 > overRect.top + overRect.height / 2
}

const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  const cardHit = hits.find((hit) => String(hit.id).startsWith(KANBAN_CARD_DROPPABLE_PREFIX))
  return cardHit ? [cardHit] : hits
}

function InsertionLine() {
  return <li aria-hidden="true" data-slot="kanban-insertion-line" className="h-0.5 rounded-full bg-primary" />
}

type MoveMenuProps = {
  targets: MoveTarget[]
  disabled: boolean
  onSelect: (columnId: string) => void
  t: TranslateFn
}

function MoveMenu({ targets, disabled, onSelect, t }: MoveMenuProps) {
  const [open, setOpen] = React.useState(false)
  return (
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild>
        <IconButton
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={t('ui.blocks.kanban.moveCard', 'Move card')}
          data-slot="kanban-card-move"
          className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <Move aria-hidden="true" />
        </IconButton>
      </DropdownTrigger>
      <DropdownContent align="end" className="w-72">
        <DropdownCaption>{t('ui.blocks.kanban.moveTo', 'Move to')}</DropdownCaption>
        <DropdownList>
          {targets.map((target) => (
            <DropdownItem
              key={target.id}
              value={`${target.id} ${target.title}`}
              size={target.rejection ? 56 : 36}
              disabled={target.rejection !== null}
              description={target.rejection?.reason}
              title={target.rejection?.reason}
              onSelect={() => {
                setOpen(false)
                onSelect(target.id)
              }}
            >
              {target.title}
            </DropdownItem>
          ))}
        </DropdownList>
      </DropdownContent>
    </Dropdown>
  )
}

type CardShellProps = {
  card: KanbanCard
  pending: boolean
  dragging: boolean
  reorderable: boolean
  moveTargets: MoveTarget[]
  renderCard: KanbanProps['renderCard']
  onCardOpen: KanbanProps['onCardOpen']
  onMoveSelect: (cardId: string, columnId: string) => void
  t: TranslateFn
}

function CardShell({
  card,
  pending,
  dragging,
  reorderable,
  moveTargets,
  renderCard,
  onCardOpen,
  onMoveSelect,
  t,
}: CardShellProps) {
  const draggable = useDraggable({ id: card.id, disabled: pending })
  const droppable = useDroppable({ id: `${KANBAN_CARD_DROPPABLE_PREFIX}${card.id}`, disabled: !reorderable })
  const setNodeRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      draggable.setNodeRef(node)
      droppable.setNodeRef(node)
    },
    [draggable, droppable],
  )

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest(`[${CARD_ACTION_ATTRIBUTE}]`)) return
      onCardOpen?.(card.id)
    },
    [card.id, onCardOpen],
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onCardOpen?.(card.id)
    },
    [card.id, onCardOpen],
  )

  const stopPointerDown = React.useCallback((event: React.PointerEvent) => {
    event.stopPropagation()
  }, [])

  return (
    <div
      ref={setNodeRef}
      {...draggable.attributes}
      {...draggable.listeners}
      data-slot="kanban-card"
      data-kanban-card-id={card.id}
      data-pending={pending ? 'true' : undefined}
      aria-busy={pending || undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'group relative flex items-start gap-2 rounded-card border border-border bg-card p-3 text-left text-sm text-foreground shadow-xs outline-none transition-opacity focus-visible:shadow-focus',
        pending ? 'cursor-progress opacity-60' : 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-50',
      )}
    >
      <div className="min-w-0 flex-1">{renderCard(card, { pending, dragging })}</div>
      {pending ? (
        <span data-slot="kanban-card-pending" className="inline-flex size-7 shrink-0 items-center justify-center">
          <Spinner size="sm" />
        </span>
      ) : moveTargets.length > 0 ? (
        <div {...{ [CARD_ACTION_ATTRIBUTE]: '' }} className="shrink-0" onPointerDown={stopPointerDown}>
          <MoveMenu
            targets={moveTargets}
            disabled={pending}
            onSelect={(columnId) => onMoveSelect(card.id, columnId)}
            t={t}
          />
        </div>
      ) : null}
    </div>
  )
}

type ColumnViewProps = {
  column: KanbanColumn
  columns: KanbanColumn[]
  pendingCardIds: ReadonlySet<string>
  activeCardId: string | null
  dropIndicator: DropIndicator | null
  dropAllowed: boolean
  reorderable: boolean
  loadingMore: boolean
  props: KanbanProps
  onMoveSelect: (cardId: string, columnId: string) => void
  onLoadMore: (columnId: string) => void
  t: TranslateFn
}

function ColumnView({
  column,
  columns,
  pendingCardIds,
  activeCardId,
  dropIndicator,
  dropAllowed,
  reorderable,
  loadingMore,
  props,
  onMoveSelect,
  onLoadMore,
  t,
}: ColumnViewProps) {
  const titleId = React.useId()
  const columnStatus = column.status ?? 'ready'
  const { setNodeRef } = useDroppable({
    id: `${KANBAN_COLUMN_DROPPABLE_PREFIX}${column.id}`,
    disabled: columnStatus !== 'ready',
  })
  const isDropTarget = dropIndicator?.columnId === column.id && dropAllowed
  const restCards = activeCardId ? column.cards.filter((card) => card.id !== activeCardId) : column.cards
  const insertBeforeId =
    isDropTarget && reorderable && dropIndicator ? restCards[dropIndicator.toIndex]?.id ?? null : null
  const insertAtEnd = isDropTarget && reorderable && dropIndicator !== null && insertBeforeId === null

  let body: React.ReactNode
  if (columnStatus === 'loading') {
    body = <LoadingMessage label={t('ui.blocks.kanban.columnLoading', 'Loading cards')} />
  } else if (columnStatus === 'error') {
    body = <ErrorMessage label={column.errorMessage ?? t('ui.blocks.kanban.columnError', 'Could not load cards')} />
  } else if (column.cards.length === 0) {
    body = props.emptyColumn ? (
      props.emptyColumn(column)
    ) : (
      <p data-slot="kanban-empty-column" className="px-1 py-2 text-sm text-muted-foreground">
        {t('ui.blocks.kanban.emptyColumn', 'No cards')}
      </p>
    )
  } else {
    body = (
      <ul role="list" className="flex flex-col gap-2">
        {column.cards.map((card) => {
          const pending = pendingCardIds.has(card.id)
          const moveTargets: MoveTarget[] = columns
            .filter((target) => target.id !== column.id)
            .map((target) => ({
              id: target.id,
              title: target.title,
              rejection: rejectionOf(props.canMove, card.id, target.id),
            }))
          return (
            <React.Fragment key={card.id}>
              {insertBeforeId === card.id ? <InsertionLine /> : null}
              <li>
                <CardShell
                  card={card}
                  pending={pending}
                  dragging={activeCardId === card.id}
                  reorderable={reorderable}
                  moveTargets={moveTargets}
                  renderCard={props.renderCard}
                  onCardOpen={props.onCardOpen}
                  onMoveSelect={onMoveSelect}
                  t={t}
                />
              </li>
            </React.Fragment>
          )
        })}
        {insertAtEnd ? <InsertionLine /> : null}
      </ul>
    )
  }

  const showMore =
    columnStatus === 'ready' && column.hasMore === true && props.onLoadMoreColumn !== undefined
  const showMoreLabel =
    column.remaining !== undefined
      ? t('ui.blocks.kanban.showMore', 'Show more ({count})', { count: column.remaining })
      : t('ui.blocks.kanban.showMoreNoCount', 'Show more')

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={titleId}
      data-slot="kanban-column"
      data-kanban-column-id={column.id}
      data-drop-target={isDropTarget ? 'true' : undefined}
      className={cn(
        'flex w-72 shrink-0 snap-start flex-col gap-3 rounded-card border-2 border-transparent bg-muted p-3',
        isDropTarget && 'border-dashed border-primary',
      )}
    >
      {props.columnHeader ? (
        <div data-slot="kanban-column-header">
          <span id={titleId} className="sr-only">
            {column.title}
          </span>
          {props.columnHeader(column)}
        </div>
      ) : (
        <header data-slot="kanban-column-header" className="flex flex-col gap-1 px-1">
          <div className="flex items-center justify-between gap-2">
            <h3 id={titleId} className="min-w-0 truncate text-sm text-foreground">
              {column.title}
            </h3>
            {column.count !== undefined ? (
              <Badge variant="neutral" size={20} data-slot="kanban-column-count">
                <span aria-hidden="true">{column.count}</span>
                <span className="sr-only">
                  {t('ui.blocks.kanban.cardCount', '{count} cards', { count: column.count })}
                </span>
              </Badge>
            ) : null}
          </div>
          {column.summary !== undefined && column.summary !== null ? (
            <div data-slot="kanban-column-summary" className="text-xs text-muted-foreground">
              {column.summary}
            </div>
          ) : null}
        </header>
      )}
      {body}
      {showMore ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={loadingMore}
          onClick={() => onLoadMore(column.id)}
        >
          {loadingMore ? <Spinner size="sm" /> : null}
          {showMoreLabel}
        </Button>
      ) : null}
      {columnStatus === 'ready' && props.columnFooter ? (
        <div data-slot="kanban-column-footer">{props.columnFooter(column)}</div>
      ) : null}
    </section>
  )
}

export function Kanban(props: KanbanProps) {
  const {
    columns,
    reorderable = false,
    onMove,
    canMove,
    onLoadMoreColumn,
    renderCard,
    renderDragPreview,
    trailing,
    status,
    errorMessage,
    emptyState,
    className,
  } = props
  const t = useT()
  const [moves, setMoves] = React.useState<KanbanPendingMove[]>([])
  const [loadingColumns, setLoadingColumns] = React.useState<ReadonlySet<string>>(() => new Set())
  const [activeCardId, setActiveCardId] = React.useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = React.useState<DropIndicator | null>(null)
  const [message, setMessage] = React.useState('')
  const [focusCardId, setFocusCardId] = React.useState<string | null>(null)
  const mountedRef = React.useRef(true)
  const boardRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const displayColumns = React.useMemo(() => applyPendingMoves(columns, moves), [columns, moves])
  const columnsRef = React.useRef(displayColumns)
  columnsRef.current = displayColumns

  const pendingCardIds = React.useMemo(
    () => new Set(moves.filter((move) => !move.settled).map((move) => move.cardId)),
    [moves],
  )

  React.useEffect(() => {
    setMoves((current) => (current.some((move) => move.settled) ? current.filter((move) => !move.settled) : current))
  }, [columns])

  React.useEffect(() => {
    if (!focusCardId) return
    const nodes = boardRef.current?.querySelectorAll<HTMLElement>('[data-kanban-card-id]') ?? []
    Array.from(nodes)
      .find((node) => node.getAttribute('data-kanban-card-id') === focusCardId)
      ?.focus()
    setFocusCardId(null)
  }, [focusCardId, displayColumns])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const columnTitle = React.useCallback(
    (columnId: string) => columnsRef.current.find((column) => column.id === columnId)?.title ?? columnId,
    [],
  )

  const startMove = React.useCallback(
    async (cardId: string, toColumnId: string, toIndex: number, source: 'drag' | 'menu') => {
      if (pendingCardIds.has(cardId)) return
      const rejection = rejectionOf(canMove, cardId, toColumnId)
      if (rejection) {
        setMessage(
          t('ui.blocks.kanban.rejected', 'The card cannot move to {column}: {reason}', {
            column: columnTitle(toColumnId),
            reason: rejection.reason,
          }),
        )
        return
      }
      setMoves((current) => [...current.filter((move) => move.cardId !== cardId), { cardId, toColumnId, toIndex }])
      if (source === 'menu') {
        setFocusCardId(cardId)
        setMessage(t('ui.blocks.kanban.moved', 'The card was moved to {column}.', { column: columnTitle(toColumnId) }))
      }
      try {
        await onMove(cardId, toColumnId, toIndex)
        if (mountedRef.current) {
          setMoves((current) => current.map((move) => (move.cardId === cardId ? { ...move, settled: true } : move)))
        }
      } catch {
        if (mountedRef.current) {
          setMessage(t('ui.blocks.kanban.reverted', 'The move was undone.'))
          setMoves((current) => current.filter((move) => move.cardId !== cardId))
        }
      }
    },
    [canMove, columnTitle, onMove, pendingCardIds, t],
  )

  const handleMenuMove = React.useCallback(
    (cardId: string, toColumnId: string) => {
      void startMove(cardId, toColumnId, 0, 'menu')
    },
    [startMove],
  )

  const handleLoadMore = React.useCallback(
    async (columnId: string) => {
      if (!onLoadMoreColumn) return
      setLoadingColumns((current) => new Set(current).add(columnId))
      try {
        await onLoadMoreColumn(columnId)
      } catch {
        return
      } finally {
        if (mountedRef.current) {
          setLoadingColumns((current) => {
            const next = new Set(current)
            next.delete(columnId)
            return next
          })
        }
      }
    },
    [onLoadMoreColumn],
  )

  const indicatorFor = React.useCallback(
    (event: DragMoveEvent | DragOverEvent | DragEndEvent): DropIndicator | null => {
      const cardId = asId(event.active.id)
      if (!cardId) return null
      const target = resolveDropTarget(columnsRef.current, asId(event.over?.id))
      if (!target) return null
      if (!reorderable) return { columnId: target.columnId, toIndex: 0 }
      const cards = columnsRef.current.find((column) => column.id === target.columnId)?.cards ?? []
      return { columnId: target.columnId, toIndex: computeToIndex(cards, cardId, target.overCardId, isPlacedAfter(event)) }
    },
    [reorderable],
  )

  const updateIndicator = React.useCallback(
    (event: DragMoveEvent | DragOverEvent) => {
      const next = indicatorFor(event)
      const cardId = asId(event.active.id)
      const visible =
        next && cardId && !isNoopMove(columnsRef.current, cardId, next.columnId, next.toIndex, reorderable) ? next : null
      setDropIndicator((current) => {
        if (current?.columnId === visible?.columnId && current?.toIndex === visible?.toIndex) return current
        return visible
      })
    },
    [indicatorFor, reorderable],
  )

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveCardId(asId(event.active.id))
  }, [])

  const handleDragCancel = React.useCallback(() => {
    setActiveCardId(null)
    setDropIndicator(null)
  }, [])

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      setActiveCardId(null)
      setDropIndicator(null)
      const cardId = asId(event.active.id)
      const target = indicatorFor(event)
      if (!cardId || !target) return
      if (isNoopMove(columnsRef.current, cardId, target.columnId, target.toIndex, reorderable)) return
      void startMove(cardId, target.columnId, target.toIndex, 'drag')
    },
    [indicatorFor, reorderable, startMove],
  )

  const describePickUp = React.useCallback(
    (cardId: string) => {
      const location = findCardLocation(columnsRef.current, cardId)
      if (!location) return ''
      const column = columnsRef.current.find((entry) => entry.id === location.columnId)
      return t('ui.blocks.kanban.dnd.pickedUp', 'Picked up card {position} of {total} from {column}.', {
        position: location.index + 1,
        total: column?.cards.length ?? 0,
        column: column?.title ?? location.columnId,
      })
    },
    [t],
  )

  const announcements = React.useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) => {
        const cardId = asId(active.id)
        return cardId ? describePickUp(cardId) : undefined
      },
      onDragOver: ({ over }) => {
        const target = resolveDropTarget(columnsRef.current, asId(over?.id))
        return target
          ? t('ui.blocks.kanban.dnd.over', 'The card is over {column}.', { column: columnTitle(target.columnId) })
          : t('ui.blocks.kanban.dnd.overNothing', 'The card is not over a column.')
      },
      onDragEnd: ({ active, over }) => {
        const cardId = asId(active.id)
        const target = resolveDropTarget(columnsRef.current, asId(over?.id))
        if (!target || !cardId) {
          return t('ui.blocks.kanban.dnd.droppedOutside', 'The card was dropped outside the columns and returned to its place.')
        }
        if (rejectionOf(canMove, cardId, target.columnId)) return undefined
        return t('ui.blocks.kanban.dnd.dropped', 'The card was dropped into {column}.', {
          column: columnTitle(target.columnId),
        })
      },
      onDragCancel: () => t('ui.blocks.kanban.dnd.cancelled', 'Moving the card was cancelled.'),
    }),
    [canMove, columnTitle, describePickUp, t],
  )

  const screenReaderInstructions = React.useMemo<ScreenReaderInstructions>(
    () => ({
      draggable: t(
        'ui.blocks.kanban.dnd.instructions',
        'Drag a card with the pointer to move it to another column. With the keyboard, press Enter to open the card or use its Move card button to choose a column.',
      ),
    }),
    [t],
  )

  const accessibility = React.useMemo(
    () => ({ announcements, screenReaderInstructions }),
    [announcements, screenReaderInstructions],
  )

  if (status === 'loading') {
    return <LoadingMessage className={className} label={t('ui.blocks.kanban.loading', 'Loading board')} />
  }
  if (status === 'error') {
    return (
      <ErrorMessage className={className} label={errorMessage ?? t('ui.blocks.kanban.error', 'Could not load the board')} />
    )
  }
  if (status === 'empty' || columns.length === 0) {
    return emptyState ?? <EmptyState className={className} title={t('ui.blocks.kanban.empty', 'No columns to show')} />
  }

  const activeCard = activeCardId
    ? displayColumns.flatMap((column) => column.cards).find((card) => card.id === activeCardId) ?? null
    : null
  const dropAllowed =
    activeCardId !== null && dropIndicator !== null && rejectionOf(canMove, activeCardId, dropIndicator.columnId) === null

  return (
    <div ref={boardRef} data-slot="kanban" className={cn('min-w-0', className)}>
      <DndContext
        sensors={sensors}
        accessibility={accessibility}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={updateIndicator}
        onDragMove={reorderable ? updateIndicator : undefined}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div
          data-slot="kanban-board"
          className="relative flex snap-x snap-mandatory items-start gap-4 overflow-x-auto pb-2 md:snap-none"
        >
          {displayColumns.map((column) => (
            <ColumnView
              key={column.id}
              column={column}
              columns={displayColumns}
              pendingCardIds={pendingCardIds}
              activeCardId={activeCardId}
              dropIndicator={dropIndicator}
              dropAllowed={dropAllowed}
              reorderable={reorderable}
              loadingMore={loadingColumns.has(column.id)}
              props={props}
              onMoveSelect={handleMenuMove}
              onLoadMore={(columnId) => {
                void handleLoadMore(columnId)
              }}
              t={t}
            />
          ))}
          {trailing !== undefined && trailing !== null ? (
            <div data-slot="kanban-trailing" className="shrink-0 snap-start">
              {trailing}
            </div>
          ) : null}
        </div>
        <DragOverlay>
          {activeCard ? (
            <div
              data-slot="kanban-drag-preview"
              className="cursor-grabbing rounded-card border border-border bg-card p-3 text-sm text-foreground shadow-md"
            >
              {renderDragPreview
                ? renderDragPreview(activeCard, { count: 1 })
                : renderCard(activeCard, { pending: false, dragging: true })}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <div role="status" aria-live="polite" aria-atomic="true" data-slot="kanban-live-region" className="sr-only">
        {message}
      </div>
    </div>
  )
}
