'use client'

import * as React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from '../lucide-icons'
import { resolveLucideIcon } from '../lucide-icons'
import { buildPaletteEntries } from '../palette/entries'
import { resolveTypeLabel } from '../type-label'
import type { FieldNode } from '../schema-helpers'
import { readSpan as readSpanShared } from './row-layout'
import { computeResizedSpan, GAP_PX } from './resize-math'

export const FIELD_DRAGGABLE_PREFIX = 'field:'

export const fieldDraggableId = (fieldKey: string): string =>
  `${FIELD_DRAGGABLE_PREFIX}${fieldKey}`

const SPAN_TO_CLASS: Record<1 | 2 | 3 | 4, string> = {
  1: 'sm:col-span-1',
  2: 'sm:col-span-2',
  3: 'md:col-span-3',
  4: 'md:col-span-4',
}

function readSpan(value: unknown): 1 | 2 | 3 | 4 {
  return readSpanShared(value) ?? 1
}

export function FieldRow({
  fieldKey,
  node,
  isSelected,
  onSelect,
  onDelete,
  onMove,
  canMoveUp,
  canMoveDown,
  dropIndicator,
  dropIndicatorGap,
  columns,
  gap,
  getSectionRect,
  onResizeStart,
  onResizePreview,
  onResizeCommit,
  t,
}: {
  fieldKey: string
  node: FieldNode
  isSelected: boolean
  onSelect: (fieldKey: string) => void
  onDelete: (fieldKey: string) => void
  onMove: (fieldKey: string, direction: 'up' | 'down') => void
  canMoveUp: boolean
  canMoveDown: boolean
  dropIndicator?: 'before' | 'after' | null
  dropIndicatorGap?: 'sm' | 'md' | 'lg'
  columns?: 1 | 2 | 3 | 4
  gap?: 'sm' | 'md' | 'lg'
  getSectionRect?: () => DOMRect | null
  onResizeStart?: (fieldKey: string, startSpan: 1 | 2 | 3 | 4) => void
  onResizePreview?: (fieldKey: string, previewSpan: 1 | 2 | 3 | 4) => void
  onResizeCommit?: (fieldKey: string, finalSpan: 1 | 2 | 3 | 4) => void
  t: TranslateFn
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: fieldDraggableId(fieldKey) })
  const palette = React.useMemo(() => buildPaletteEntries(), [])
  const omType = String(node['x-om-type'] ?? 'text')
  const paletteEntry = [...palette.input, ...palette.survey, ...palette.layout].find(
    (entry) => entry.fieldTypeKey === omType || entry.id === omType || entry.id === `layout:field:${omType}`,
  )
  const Icon = resolveLucideIcon(paletteEntry?.iconName)
  const label = node['x-om-label']?.en || fieldKey
  const help = node['x-om-help']?.en
  const span = readSpan(node['x-om-grid-span'])
  const indicatorOffset =
    dropIndicatorGap === 'sm'
      ? dropIndicator === 'before' ? '-top-1' : '-bottom-1'
      : dropIndicatorGap === 'lg'
        ? dropIndicator === 'before' ? '-top-3' : '-bottom-3'
        : dropIndicator === 'before' ? '-top-2' : '-bottom-2'

  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node)
      containerRef.current = node
    },
    [setNodeRef],
  )

  const resizeStateRef = React.useRef<{
    pointerId: number
    fieldLeft: number
    sectionLeft: number
    sectionWidth: number
    columns: 1 | 2 | 3 | 4
    gapPx: number
    startSpan: 1 | 2 | 3 | 4
    lastPreview: 1 | 2 | 3 | 4
  } | null>(null)

  const canResize = !!columns && columns > 1 && !!getSectionRect && !!onResizeCommit

  const handleResizePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canResize) return
      if (event.button !== 0) return
      const fieldNode = containerRef.current
      const sectionRect = getSectionRect?.()
      if (!fieldNode || !sectionRect) return
      const fieldRect = fieldNode.getBoundingClientRect()
      const gapPx = GAP_PX[gap ?? 'md']
      const startSpan = span
      const targetCols = (columns ?? 1) as 1 | 2 | 3 | 4
      resizeStateRef.current = {
        pointerId: event.pointerId,
        fieldLeft: fieldRect.left,
        sectionLeft: sectionRect.left,
        sectionWidth: sectionRect.width,
        columns: targetCols,
        gapPx,
        startSpan,
        lastPreview: startSpan,
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Some browsers throw if capture is unavailable — safe to ignore.
      }
      event.preventDefault()
      event.stopPropagation()
      onResizeStart?.(fieldKey, startSpan)
    },
    [canResize, columns, fieldKey, gap, getSectionRect, onResizeStart, span],
  )

  const handleResizePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const state = resizeStateRef.current
      if (!state || state.pointerId !== event.pointerId) return
      const next = computeResizedSpan({
        sectionLeft: state.sectionLeft,
        sectionWidth: state.sectionWidth,
        fieldLeft: state.fieldLeft,
        pointerClientX: event.clientX,
        columns: state.columns,
        startSpan: state.startSpan,
        gapPx: state.gapPx,
      })
      if (next !== state.lastPreview) {
        state.lastPreview = next
        onResizePreview?.(fieldKey, next)
      }
      event.preventDefault()
    },
    [fieldKey, onResizePreview],
  )

  const finishResize = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const state = resizeStateRef.current
      if (!state || state.pointerId !== event.pointerId) return
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      } catch {
        // Ignore release errors — pointer capture may already be gone.
      }
      const final = state.lastPreview
      resizeStateRef.current = null
      onResizeCommit?.(fieldKey, final)
    },
    [fieldKey, onResizeCommit],
  )

  return (
    <div
      ref={setRefs}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className={[
        'group relative min-w-0 rounded-md border bg-background p-3',
        SPAN_TO_CLASS[span],
        isSelected ? 'border-primary/40' : 'border-border',
        dropIndicator ? 'ring-1 ring-primary/30' : '',
      ].join(' ')}
      data-field-key={fieldKey}
    >
      {dropIndicator ? (
        <span
          className={[
            'pointer-events-none absolute left-3 right-3 h-0.5 rounded-full bg-primary',
            indicatorOffset,
          ].join(' ')}
          aria-hidden="true"
        />
      ) : null}
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-0.5 shrink-0 cursor-grab rounded-md p-1 text-muted-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          aria-label={t('forms.studio.canvas.field.dragHandle')}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onSelect(fieldKey)}
        >
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {resolveTypeLabel(omType, t)}
          </span>
          {help ? <span className="mt-1 block text-xs text-muted-foreground">{help}</span> : null}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            aria-label={t('forms.studio.canvas.field.moveUp')}
            variant="ghost"
            size="sm"
            type="button"
            disabled={!canMoveUp}
            onClick={(event) => {
              event.stopPropagation()
              onMove(fieldKey, 'up')
            }}
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton
            aria-label={t('forms.studio.canvas.field.moveDown')}
            variant="ghost"
            size="sm"
            type="button"
            disabled={!canMoveDown}
            onClick={(event) => {
              event.stopPropagation()
              onMove(fieldKey, 'down')
            }}
          >
            <ArrowDown className="size-4" aria-hidden="true" />
          </IconButton>
        </div>
        <IconButton
          aria-label={t('forms.studio.fields.deleteButton')}
          variant="ghost"
          size="sm"
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onDelete(fieldKey)
          }}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
      {canResize ? (
        <div
          className="absolute inset-y-0 -right-1 hidden sm:flex w-2 cursor-col-resize items-center justify-center touch-none select-none"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('forms.studio.canvas.field.resizeHandle')}
          data-no-dnd="true"
        >
          <span className="h-6 w-0.5 rounded-full bg-border opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      ) : null}
    </div>
  )
}
