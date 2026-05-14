'use client'

import * as React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { Tag } from '@open-mercato/ui/primitives/tag'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { GripVertical, Trash2 } from '../lucide-icons'
import { GridSlot } from './GridSlot'
import type { ResolvedSectionView } from '../../../../../services/form-version-compiler'

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
  onTitleCommit: (sectionKey: string, title: string) => void
  /** Currently active locale for inline title edits (Decision 26b). */
  activeLocale: string
  pageIndex: number | null
  pageChipLabel: string | null
  emptyDropCopy: string
  titlePlaceholder: string
  deleteAriaLabel: string
  dragHandleAriaLabel: string
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
    onTitleCommit,
    activeLocale,
    pageChipLabel,
    titlePlaceholder,
    deleteAriaLabel,
    dragHandleAriaLabel,
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
    'rounded-lg border bg-background p-4 ' +
    (isSelected ? 'border-primary/30' : 'border-border')

  const visibleTitle = initialTitle.length > 0 ? initialTitle : titlePlaceholder

  return (
    <div ref={setNodeRef} style={style} data-section-key={view.key} className={containerClass}>
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
 */
export function SectionGridBody({
  view,
  isEmpty,
  emptyCopy,
  children,
}: {
  view: ResolvedSectionView
  isEmpty: boolean
  emptyCopy: string
  children: React.ReactNode
}) {
  if (isEmpty) {
    return <GridSlot sectionKey={view.key} columnIndex={null} isEmpty copy={emptyCopy} />
  }
  return (
    <div className={sectionGridClasses(view.columns, view.gap)}>
      {children}
    </div>
  )
}
