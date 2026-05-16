'use client'

import * as React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { Tag } from '@open-mercato/ui/primitives/tag'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from '../lucide-icons'
import {
  GridSlot,
  SectionCellSlot,
  SectionColGapDrop,
  SectionRowGapDrop,
} from './GridSlot'
import { GhostCell, HorizontalDropBar, VerticalDropBar } from './DropIndicator'
import type { RowLayout } from './row-layout'
import type { ActiveDropTarget } from '../types'
import type { ResolvedSectionView } from '../../../../../services/form-version-compiler'

type GridDropTarget = Exclude<ActiveDropTarget, null | { kind: 'sortable' }>

type RowGapTarget = Extract<GridDropTarget, { kind: 'row-gap' }>
type ColGapTarget = Extract<GridDropTarget, { kind: 'col-gap' }>
type CellTarget = Extract<GridDropTarget, { kind: 'cell' }>

export const SECTION_DRAGGABLE_PREFIX = 'section:'

export const sectionDraggableId = (sectionKey: string): string =>
  `${SECTION_DRAGGABLE_PREFIX}${sectionKey}`

const COLUMNS_TO_GRID_CLASS: Record<1 | 2 | 3 | 4, string> = {
  1: 'grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 md:grid-cols-3',
  4: 'sm:grid-cols-2 md:grid-cols-4',
}

const GAP_TO_CLASS: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'gap-2',
  md: 'gap-4',
  lg: 'gap-6',
}

export type SectionContainerProps = {
  view: ResolvedSectionView
  isSelected: boolean
  onSelect: (sectionKey: string) => void
  onDelete: (sectionKey: string) => void
  onMove: (sectionKey: string, direction: 'up' | 'down') => void
  onTitleCommit: (sectionKey: string, title: string) => void
  /** Currently active locale for inline title edits (Decision 26b). */
  activeLocale: string
  pageIndex: number | null
  pageChipLabel: string | null
  emptyDropCopy: string
  titlePlaceholder: string
  deleteAriaLabel: string
  dragHandleAriaLabel: string
  moveUpAriaLabel: string
  moveDownAriaLabel: string
  canMoveUp: boolean
  canMoveDown: boolean
  dropIndicator?: 'before' | 'after' | null
  t: TranslateFn
  children: React.ReactNode
  isFocusedForTitleEdit?: boolean
  onTitleEditConsumed?: () => void
}

/**
 * Renders one `OmSection` (or `kind: 'page'` boundary) including header,
 * inline-editable title, drag handle, optional divider, and grid body.
 *
 * Phase C wires the section reorder DnD via `useSortable` keyed on
 * `section:<key>` so the parent `SortableContext` can list all sections.
 */
export function SectionContainer(props: SectionContainerProps) {
  const {
    view,
    isSelected,
    onSelect,
    onDelete,
    onMove,
    onTitleCommit,
    activeLocale,
    pageChipLabel,
    titlePlaceholder,
    deleteAriaLabel,
    dragHandleAriaLabel,
    moveUpAriaLabel,
    moveDownAriaLabel,
    canMoveUp,
    canMoveDown,
    dropIndicator,
    children,
    isFocusedForTitleEdit,
    onTitleEditConsumed,
  } = props

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sectionDraggableId(view.key) })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const initialTitle = view.title?.[activeLocale] ?? ''
  const [editingTitle, setEditingTitle] = React.useState(false)
  const [titleDraft, setTitleDraft] = React.useState(initialTitle)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (!editingTitle) setTitleDraft(initialTitle)
  }, [initialTitle, editingTitle])

  React.useEffect(() => {
    if (isFocusedForTitleEdit) {
      setEditingTitle(true)
      onTitleEditConsumed?.()
    }
  }, [isFocusedForTitleEdit, onTitleEditConsumed])

  React.useEffect(() => {
    if (editingTitle) {
      const node = inputRef.current
      if (node) {
        node.focus()
        node.select()
      }
    }
  }, [editingTitle])

  const commit = React.useCallback(() => {
    setEditingTitle(false)
    if (titleDraft !== initialTitle) {
      onTitleCommit(view.key, titleDraft)
    }
  }, [titleDraft, initialTitle, onTitleCommit, view.key])

  const cancel = React.useCallback(() => {
    setEditingTitle(false)
    setTitleDraft(initialTitle)
  }, [initialTitle])

  const handleHeaderClick = React.useCallback(() => {
    if (!editingTitle) onSelect(view.key)
  }, [editingTitle, onSelect, view.key])

  const showTitleHeader = !view.hideTitle
  const containerClass =
    'relative rounded-lg border bg-background p-4 ' +
    (isSelected ? 'border-primary/30' : 'border-border') +
    (dropIndicator ? ' ring-1 ring-primary/30' : '')

  const visibleTitle = initialTitle.length > 0 ? initialTitle : titlePlaceholder

  return (
    <div ref={setNodeRef} style={style} data-section-key={view.key} className={containerClass}>
      {dropIndicator ? (
        <span
          className={[
            'pointer-events-none absolute left-4 right-4 h-0.5 rounded-full bg-primary',
            dropIndicator === 'before' ? '-top-2' : '-bottom-2',
          ].join(' ')}
          aria-hidden="true"
        />
      ) : null}
      {view.kind === 'ending' ? (
        <div className="mb-2">
          <Tag variant="neutral" dot>
            {props.t('forms.studio.canvas.ending.chip')}
          </Tag>
        </div>
      ) : pageChipLabel ? (
        <div className="mb-2">
          <Tag variant="neutral" dot>
            {pageChipLabel}
          </Tag>
        </div>
      ) : null}
      <header
        className="mb-3 flex items-center justify-between gap-2"
        onClick={handleHeaderClick}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button
            type="button"
            className="shrink-0 cursor-grab active:cursor-grabbing rounded-md p-1 text-muted-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={dragHandleAriaLabel}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </button>
          {showTitleHeader ? (
            editingTitle ? (
              <input
                ref={inputRef}
                data-no-dnd="true"
                value={titleDraft}
                placeholder={titlePlaceholder}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commit()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    cancel()
                  }
                }}
                className="flex-1 min-w-0 rounded-md border border-input bg-background px-2 py-1 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onSelect(view.key)
                  setEditingTitle(true)
                }}
                className="flex-1 min-w-0 truncate text-left text-sm font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
              >
                {visibleTitle}
              </button>
            )
          ) : (
            <span className="flex-1 text-sm italic text-muted-foreground">{titlePlaceholder}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            type="button"
            aria-label={moveUpAriaLabel}
            variant="ghost"
            size="sm"
            disabled={!canMoveUp}
            onClick={(event) => {
              event.stopPropagation()
              onMove(view.key, 'up')
            }}
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton
            type="button"
            aria-label={moveDownAriaLabel}
            variant="ghost"
            size="sm"
            disabled={!canMoveDown}
            onClick={(event) => {
              event.stopPropagation()
              onMove(view.key, 'down')
            }}
          >
            <ArrowDown className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton
            type="button"
            aria-label={deleteAriaLabel}
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation()
              onDelete(view.key)
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </IconButton>
        </div>
      </header>
      {view.divider ? <Separator className="mb-3" /> : null}
      {children}
    </div>
  )
}

export const sectionGridClasses = (
  columns: 1 | 2 | 3 | 4,
  gap: 'sm' | 'md' | 'lg',
): string => `grid grid-cols-1 ${COLUMNS_TO_GRID_CLASS[columns]} ${GAP_TO_CLASS[gap]}`

/**
 * Body wrapper that lays out child rows in a CSS grid based on the
 * resolved `columns` value. Empty sections fall back to a single
 * full-width drop zone (Decision 28).
 *
 * Phase 1 grid DnD — when `columns > 1` and a `layoutPlan` is provided,
 * the body owns layout: it walks the `RowLayout` rows, renders each
 * field via `renderField(fieldKey, fieldIndex)`, and interleaves
 * per-cell + per-gap droppables. `columns === 1` keeps legacy children
 * rendering for regression safety.
 */
export function SectionGridBody({
  view,
  isEmpty,
  emptyCopy,
  children,
  layoutPlan,
  renderField,
  gridDropTarget,
  resizingFieldKey,
  resizingPreviewSpan,
  gridRef,
}: {
  view: ResolvedSectionView
  isEmpty: boolean
  emptyCopy: string
  children?: React.ReactNode
  layoutPlan?: RowLayout
  renderField?: (fieldKey: string, fieldIndex: number) => React.ReactNode
  gridDropTarget?: GridDropTarget | null
  resizingFieldKey?: string | null
  resizingPreviewSpan?: 1 | 2 | 3 | 4 | null
  gridRef?: React.Ref<HTMLDivElement>
}) {
  if (isEmpty) {
    return <GridSlot sectionKey={view.key} columnIndex={null} isEmpty copy={emptyCopy} />
  }

  if (view.columns === 1 || !layoutPlan || !renderField) {
    return (
      <div ref={gridRef} className={sectionGridClasses(view.columns, view.gap)}>
        {children}
        <div className="sm:col-span-full md:col-span-full">
          <GridSlot sectionKey={view.key} columnIndex={null} copy={emptyCopy} />
        </div>
      </div>
    )
  }

  const rowGapTarget: RowGapTarget | null =
    gridDropTarget && gridDropTarget.kind === 'row-gap' ? gridDropTarget : null
  const colGapTarget: ColGapTarget | null =
    gridDropTarget && gridDropTarget.kind === 'col-gap' ? gridDropTarget : null
  const cellTarget: CellTarget | null =
    gridDropTarget && gridDropTarget.kind === 'cell' ? gridDropTarget : null

  // Decision 6b — per-cell + per-gap droppables; column hint is informational.
  return (
    <div ref={gridRef} className={sectionGridClasses(view.columns, view.gap)}>
      {layoutPlan.rows.map((row, rowIndex) => (
        <React.Fragment key={`row-${rowIndex}`}>
          <SectionRowGapDrop sectionKey={view.key} rowIndex={rowIndex} />
          {rowGapTarget && rowGapTarget.rowIndex === rowIndex ? (
            <div className="relative col-span-full h-0">
              <HorizontalDropBar position="top" />
            </div>
          ) : null}
          {row.cells.map((cell, cellIndex) => {
            const showLeftColGap =
              !!colGapTarget &&
              colGapTarget.rowIndex === rowIndex &&
              colGapTarget.columnIndex === cellIndex
            const showRightColGap =
              !!colGapTarget &&
              colGapTarget.rowIndex === rowIndex &&
              colGapTarget.columnIndex === view.columns &&
              cellIndex === row.cells.length - 1
            if (cell.kind === 'field') {
              const isResizingThis =
                !!resizingFieldKey &&
                resizingFieldKey === cell.fieldKey &&
                !!resizingPreviewSpan
              const previewSpan = isResizingThis
                ? (Math.min(resizingPreviewSpan ?? cell.span, view.columns) as 1 | 2 | 3 | 4)
                : cell.span
              const spanClass = SPAN_TO_GRID_CLASS[previewSpan]
              const isLastCell = cellIndex === row.cells.length - 1
              return (
                <div key={`cell-${rowIndex}-${cellIndex}`} className={`relative ${spanClass}`}>
                  <SectionColGapDrop
                    sectionKey={view.key}
                    rowIndex={rowIndex}
                    columnIndex={cellIndex}
                    edge="left"
                  />
                  {showLeftColGap ? <VerticalDropBar position="left" /> : null}
                  {renderField(cell.fieldKey, cell.linearIndex)}
                  {isResizingThis ? <GhostCell /> : null}
                  {isLastCell ? (
                    <SectionColGapDrop
                      sectionKey={view.key}
                      rowIndex={rowIndex}
                      columnIndex={view.columns}
                      edge="right"
                    />
                  ) : null}
                  {showRightColGap ? <VerticalDropBar position="right" /> : null}
                </div>
              )
            }
            const showCellGhost =
              !!cellTarget &&
              cellTarget.rowIndex === rowIndex &&
              cellTarget.columnIndex === cellIndex
            return (
              <div key={`cell-${rowIndex}-${cellIndex}`} className="relative">
                {showLeftColGap ? <VerticalDropBar position="left" /> : null}
                <SectionCellSlot
                  sectionKey={view.key}
                  rowIndex={rowIndex}
                  columnIndex={cellIndex}
                  copy={emptyCopy}
                />
                {showCellGhost ? <GhostCell /> : null}
              </div>
            )
          })}
        </React.Fragment>
      ))}
      <SectionRowGapDrop sectionKey={view.key} rowIndex={layoutPlan.rows.length} />
      {rowGapTarget && rowGapTarget.rowIndex === layoutPlan.rows.length ? (
        <div className="relative col-span-full h-0">
          <HorizontalDropBar position="top" />
        </div>
      ) : null}
      <div className="sm:col-span-full md:col-span-full">
        <GridSlot sectionKey={view.key} columnIndex={null} copy={emptyCopy} />
      </div>
    </div>
  )
}

const SPAN_TO_GRID_CLASS: Record<1 | 2 | 3 | 4, string> = {
  1: 'sm:col-span-1',
  2: 'sm:col-span-2',
  3: 'md:col-span-3',
  4: 'md:col-span-4',
}
