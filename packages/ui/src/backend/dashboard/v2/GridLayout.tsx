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
import type {
  DashboardLayoutItem,
  DashboardWidgetSize,
} from '@open-mercato/shared/modules/dashboard/widgets'

export type DashboardSortableHandle = {
  setActivatorNodeRef: (element: HTMLElement | null) => void
  attributes: React.HTMLAttributes<HTMLElement>
  listeners?: React.HTMLAttributes<HTMLElement>
}

type GridLayoutProps = {
  items: DashboardLayoutItem[]
  editing: boolean
  onReorder: (activeId: string, overId: string) => void
  renderItem: (item: DashboardLayoutItem, handle: DashboardSortableHandle, isDragging: boolean) => React.ReactNode
}

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

export function GridLayout({ items, editing, onReorder, renderItem }: GridLayoutProps) {
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
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">
          {items.map((item) => (
            <SortableGridItem
              key={item.id}
              item={item}
              editing={editing}
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
  renderItem,
}: {
  item: DashboardLayoutItem
  editing: boolean
  renderItem: GridLayoutProps['renderItem']
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !editing })
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
    <div ref={setNodeRef} style={style} className={cn('min-w-0', sizeToSpanClass(item.size))}>
      {renderItem(item, handle, isDragging)}
    </div>
  )
}
