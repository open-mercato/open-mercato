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
import { Columns3, GripVertical, Move } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
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
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
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

const COLUMN_CLASS =
  'flex min-w-72 max-w-sm flex-1 basis-0 snap-start sm:min-w-64 flex-col gap-3 rounded-card border-2 border-transparent bg-muted/40 p-3'

const CARD_SURFACE_CLASS = 'rounded-card border border-border bg-card p-3 shadow-sm'

const CARD_CORNER_CLASS =
  'absolute right-0 top-0 flex items-start rounded-card bg-linear-to-l from-card from-70% to-transparent py-1 pl-5 pr-1'

const SKELETON_BOARD_COLUMNS = [3, 2, 2, 1]

type ScrollEdges = { start: boolean; end: boolean }

function SkeletonCard() {
  return (
    <li data-slot="kanban-skeleton-card" className={cn('flex flex-col gap-3', CARD_SURFACE_CLASS)}>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <div className="flex min-h-7 items-center justify-between gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton shape="circle" className="size-7" />
      </div>
    </li>
  )
}

function SkeletonCards({ count, label }: { count: number; label: string }) {
  return (
    <div data-slot="kanban-column-loading" aria-busy="true">
      <span className="sr-only">{label}</span>
      <ul role="list" aria-hidden="true" className="flex flex-col gap-2">
        {Array.from({ length: count }, (_unused, index) => (
          <SkeletonCard key={index} />
        ))}
      </ul>
    </div>
  )
}

function isColumnReady(column: KanbanColumn): boolean {
  return (column.status ?? 'ready') === 'ready'
}

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

function focusMenuList(event: Event) {
  const content = event.currentTarget
  if (!(content instanceof HTMLElement)) return
  const list = content.querySelector<HTMLElement>('[cmdk-root]')
  if (!list) return
  event.preventDefault()
  list.focus()
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
          disabled={disabled}
          aria-label={t('ui.blocks.kanban.moveCard', 'Move card')}
          data-slot="kanban-card-move"
        >
          <Move aria-hidden="true" />
        </IconButton>
      </DropdownTrigger>
      <DropdownContent align="end" className="w-72" onOpenAutoFocus={focusMenuList}>
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
        'group relative text-left text-sm text-foreground outline-none transition-opacity focus-visible:shadow-focus',
        CARD_SURFACE_CLASS,
        pending ? 'cursor-progress' : 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-50',
      )}
    >
      {reorderable && !pending ? (
        <span
          aria-hidden="true"
          data-slot="kanban-card-grip"
          className="pointer-events-none absolute inset-y-0 left-0 flex w-3 items-center justify-center text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <GripVertical className="size-3" />
        </span>
      ) : null}
      <div
        data-slot="kanban-card-content"
        className={cn('min-w-0 transition-opacity [@media(hover:none)]:pr-7', pending && 'opacity-60')}
      >
        {renderCard(card, { pending, dragging })}
      </div>
      {pending ? (
        <span data-slot="kanban-card-pending" className={CARD_CORNER_CLASS}>
          <span className="inline-flex size-8 items-center justify-center">
            <Spinner size="sm" />
          </span>
        </span>
      ) : moveTargets.length > 0 ? (
        <div
          {...{ [CARD_ACTION_ATTRIBUTE]: '' }}
          data-slot="kanban-card-actions"
          className={cn(
            CARD_CORNER_CLASS,
            'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100 [@media(hover:none)]:opacity-100',
          )}
          onPointerDown={stopPointerDown}
        >
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
    disabled: !isColumnReady(column),
  })
  const isDropTarget = dropIndicator?.columnId === column.id && dropAllowed
  const restCards = activeCardId ? column.cards.filter((card) => card.id !== activeCardId) : column.cards
  const insertBeforeId =
    isDropTarget && reorderable && dropIndicator ? restCards[dropIndicator.toIndex]?.id ?? null : null
  const insertAtEnd = isDropTarget && reorderable && dropIndicator !== null && insertBeforeId === null

  let body: React.ReactNode
  const onRetryColumn = props.onRetryColumn
  if (columnStatus === 'loading') {
    body = <SkeletonCards count={2} label={t('ui.blocks.kanban.columnLoading', 'Loading cards')} />
  } else if (columnStatus === 'error') {
    body = (
      <div data-slot="kanban-column-error">
        <ErrorMessage
          className="rounded-card border-status-error-border bg-status-error-bg p-3 text-status-error-text"
          iconClassName="text-status-error-icon"
          label={column.errorMessage ?? t('ui.blocks.kanban.columnError', 'Could not load cards')}
          action={
            onRetryColumn ? (
              <Button type="button" size="sm" variant="outline" className="text-foreground" onClick={() => onRetryColumn(column.id)}>
                {t('ui.blocks.kanban.retry', 'Try again')}
              </Button>
            ) : undefined
          }
        />
      </div>
    )
  } else if (column.cards.length === 0) {
    body = props.emptyColumn ? (
      props.emptyColumn(column)
    ) : (
      <p data-slot="kanban-empty-column" className="mx-px px-3 py-2 text-sm text-muted-foreground">
        {t('ui.blocks.kanban.emptyColumn', 'No cards')}
      </p>
    )
  } else {
    body = (
      <ul role="list" className="flex flex-col gap-2">
        {column.cards.map((card) => {
          const pending = pendingCardIds.has(card.id)
          const moveTargets: MoveTarget[] = columns
            .filter((target) => target.id !== column.id && isColumnReady(target))
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
      className={cn(COLUMN_CLASS, isDropTarget && 'border-dashed border-primary')}
    >
      {props.columnHeader ? (
        <div data-slot="kanban-column-header">
          <span id={titleId} className="sr-only">
            {column.title}
          </span>
          {props.columnHeader(column)}
        </div>
      ) : (
        <header data-slot="kanban-column-header" className="mx-px flex flex-col gap-1 px-3 pt-1">
          <div className="flex min-h-6 items-center justify-between gap-2">
            <h3 id={titleId} className="min-w-0 truncate text-base text-foreground">
              {column.title}
            </h3>
            {columnStatus === 'ready' && column.count !== undefined && column.count > 0 ? (
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
    onRetry,
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
  const scrollerRef = React.useRef<HTMLDivElement>(null)
  const [scrollEdges, setScrollEdges] = React.useState<ScrollEdges>({ start: false, end: false })

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const displayColumns = React.useMemo(() => applyPendingMoves(columns, moves), [columns, moves])
  const columnsRef = React.useRef(displayColumns)
  columnsRef.current = displayColumns

  const externalPendingCardIds = props.pendingCardIds
  const pendingCardIds = React.useMemo(
    () =>
      new Set([
        ...(externalPendingCardIds ?? []),
        ...moves.filter((move) => !move.settled).map((move) => move.cardId),
      ]),
    [externalPendingCardIds, moves],
  )

  const measureScrollEdges = React.useCallback(() => {
    const node = scrollerRef.current
    if (!node) return
    const start = node.scrollLeft > 1
    const end = node.scrollLeft + node.clientWidth < node.scrollWidth - 1
    setScrollEdges((current) => (current.start === start && current.end === end ? current : { start, end }))
  }, [])

  const boardVisible = status !== 'loading' && status !== 'error' && status !== 'empty' && columns.length > 0

  React.useEffect(() => {
    if (!boardVisible) return
    measureScrollEdges()
    const node = scrollerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measureScrollEdges)
    observer.observe(node)
    Array.from(node.children).forEach((child) => observer.observe(child))
    return () => observer.disconnect()
  }, [boardVisible, displayColumns, measureScrollEdges, trailing])

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
      const destination = columnsRef.current.find((column) => column.id === toColumnId)
      if (!destination || !isColumnReady(destination)) return
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
    return (
      <div data-slot="kanban" aria-busy="true" className={cn('min-w-0', className)}>
        <span className="sr-only">{t('ui.blocks.kanban.loading', 'Loading board')}</span>
        <div aria-hidden="true" className="flex items-start gap-4 overflow-hidden pb-2">
          {SKELETON_BOARD_COLUMNS.map((cardCount, index) => (
            <div key={index} data-slot="kanban-skeleton-column" className={COLUMN_CLASS}>
              <div className="mx-px flex min-h-6 items-center justify-between gap-2 px-3 pt-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-6" />
              </div>
              <ul role="list" className="flex flex-col gap-2">
                {Array.from({ length: cardCount }, (_unused, cardIndex) => (
                  <SkeletonCard key={cardIndex} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <ErrorMessage
        className={cn('max-w-xl rounded-md', className)}
        label={errorMessage ?? t('ui.blocks.kanban.error', 'Could not load the board')}
        action={
          onRetry ? (
            <Button type="button" size="sm" variant="outline" className="text-foreground" onClick={onRetry}>
              {t('ui.blocks.kanban.retry', 'Try again')}
            </Button>
          ) : undefined
        }
      />
    )
  }
  if (status === 'empty' || columns.length === 0) {
    return (
      emptyState ?? (
        <EmptyState
          size="sm"
          className={cn('items-start px-0 text-left', className)}
          icon={<Columns3 aria-hidden="true" />}
          title={t('ui.blocks.kanban.empty', 'No columns to show')}
          description={t('ui.blocks.kanban.emptyDescription', 'Add a column to start organizing cards on this board.')}
        />
      )
    )
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
        <div data-slot="kanban-viewport" className="relative">
          <div
            ref={scrollerRef}
            role="group"
            aria-label={t('ui.blocks.kanban.boardLabel', 'Board columns')}
            tabIndex={scrollEdges.start || scrollEdges.end ? 0 : undefined}
            onScroll={measureScrollEdges}
            data-slot="kanban-board"
            data-overflow-start={scrollEdges.start ? 'true' : undefined}
            data-overflow-end={scrollEdges.end ? 'true' : undefined}
            className="relative flex snap-x snap-mandatory items-start gap-4 overflow-x-auto rounded-card pb-2 outline-none focus-visible:shadow-focus md:snap-none"
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
          <div
            aria-hidden="true"
            data-slot="kanban-scroll-fade-start"
            className={cn(
              'pointer-events-none absolute bottom-2 left-0 top-0 w-12 bg-linear-to-r from-background to-transparent transition-opacity',
              scrollEdges.start ? 'opacity-100' : 'opacity-0',
            )}
          />
          <div
            aria-hidden="true"
            data-slot="kanban-scroll-fade-end"
            className={cn(
              'pointer-events-none absolute bottom-2 right-0 top-0 w-12 bg-linear-to-l from-background to-transparent transition-opacity',
              scrollEdges.end ? 'opacity-100' : 'opacity-0',
            )}
          />
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
