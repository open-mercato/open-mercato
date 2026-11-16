"use client"

import * as React from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type {
  DashboardLayoutItem,
  DashboardWidgetSize,
} from '@open-mercato/shared/modules/dashboard/widgets'
import { fractionToSize } from './sizeSnap'

export type DashboardSortableHandle = {
  setActivatorNodeRef: (element: HTMLElement | null) => void
  attributes: React.HTMLAttributes<HTMLElement>
  listeners?: React.HTMLAttributes<HTMLElement>
}

type GridLayoutProps = {
  items: DashboardLayoutItem[]
  editing: boolean
  onReorder: (activeId: string, overId: string) => void
  onResize: (id: string, size: DashboardWidgetSize) => void
  renderItem: (item: DashboardLayoutItem, handle: DashboardSortableHandle, isDragging: boolean) => React.ReactNode
}

export { fractionToSize, sizeToFraction } from './sizeSnap'

export function sizeToSpanClass(size: DashboardWidgetSize | undefined): string {
  switch (size) {
    case 'sm':
      return 'md:col-span-3 xl:col-span-3'
    case 'lg':
      return 'md:col-span-6 xl:col-span-9'
    case 'full':
      return 'md:col-span-6 xl:col-span-12'
    case 'md':
    default:
      return 'md:col-span-6 xl:col-span-6'
  }
}

export function GridLayout({ items, editing, onReorder, onResize, renderItem }: GridLayoutProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    if (!editing || !event.over || event.active.id === event.over.id) return
    onReorder(String(event.active.id), String(event.over.id))
  }, [editing, onReorder])

  const ids = React.useMemo(() => items.map((item) => item.id), [items])

  return (
    <DndContext id="dashboard-v2-grid" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div ref={containerRef} className="grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">
          {items.map((item) => (
            <SortableGridItem
              key={item.id}
              item={item}
              editing={editing}
              containerRef={containerRef}
              onResize={onResize}
              renderItem={renderItem}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function SortableGridItem({
  item,
  editing,
  containerRef,
  onResize,
  renderItem,
}: {
  item: DashboardLayoutItem
  editing: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
  onResize: (id: string, size: DashboardWidgetSize) => void
  renderItem: GridLayoutProps['renderItem']
}) {
  const t = useT()
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !editing })

  const cardRef = React.useRef<HTMLDivElement | null>(null)
  const resizingRef = React.useRef(false)
  const cardLeftRef = React.useRef(0)
  const containerWidthRef = React.useRef(0)
  const [previewSize, setPreviewSize] = React.useState<DashboardWidgetSize | null>(null)

  const beginResize = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!editing) return
    const container = containerRef.current
    const card = cardRef.current
    if (!container || !card) return
    event.preventDefault()
    event.stopPropagation()
    containerWidthRef.current = container.getBoundingClientRect().width
    cardLeftRef.current = card.getBoundingClientRect().left
    resizingRef.current = true
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
    setPreviewSize(item.size ?? 'md')
  }, [containerRef, editing, item.size])

  const moveResize = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current || containerWidthRef.current <= 0) return
    const fraction = (event.clientX - cardLeftRef.current) / containerWidthRef.current
    setPreviewSize(fractionToSize(Math.min(1, Math.max(0.25, fraction))))
  }, [])

  const endResize = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current) return
    resizingRef.current = false
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {}
    setPreviewSize((current) => {
      if (current && current !== (item.size ?? 'md')) onResize(item.id, current)
      return null
    })
  }, [item.id, item.size, onResize])

  const style: React.CSSProperties = {
    // Translate only — never Transform. On a mixed-size grid (sm=3 … full=12 cols)
    // dnd-kit's Transform bakes in scaleX/scaleY to match each neighbour's dimensions,
    // which stretches the dragged card horizontally/vertically. Translate moves it
    // while it keeps its own size.
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 20 : undefined,
  }
  const handle: DashboardSortableHandle = {
    setActivatorNodeRef,
    attributes: attributes as React.HTMLAttributes<HTMLElement>,
    listeners: listeners as React.HTMLAttributes<HTMLElement> | undefined,
  }
  return (
    <div
      ref={(node) => { setNodeRef(node); cardRef.current = node }}
      data-dashboard-item-id={item.id}
      style={style}
      className={cn(
        'relative min-w-0',
        sizeToSpanClass(previewSize ?? item.size),
        previewSize ? 'rounded-xl ring-2 ring-brand-violet' : null,
      )}
    >
      {renderItem(item, handle, isDragging)}
      {editing ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('dashboard.v2.resizeWidget')}
          onPointerDown={beginResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          className="group absolute inset-y-0 right-0 z-10 hidden w-3 cursor-col-resize touch-none md:flex md:items-center md:justify-end"
        >
          <span aria-hidden="true" className="h-8 w-1 rounded-full bg-border transition-colors group-hover:bg-brand-violet" />
        </div>
      ) : null}
    </div>
  )
}
