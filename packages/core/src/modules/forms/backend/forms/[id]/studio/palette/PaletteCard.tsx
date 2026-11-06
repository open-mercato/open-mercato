'use client'

import { useDraggable } from '@dnd-kit/core'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'

export const PALETTE_DRAGGABLE_PREFIX = 'palette:'

export const paletteDraggableId = (id: string): string => `${PALETTE_DRAGGABLE_PREFIX}${id}`

export function PaletteCard({
  id,
  Icon,
  label,
}: {
  id: string
  Icon: LucideIcon
  label: string
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: paletteDraggableId(id),
  })
  return (
    <Button
      ref={setNodeRef}
      type="button"
      variant="outline"
      className="h-auto w-full justify-start px-3 py-2 text-left"
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        opacity: isDragging ? 0.5 : 1,
      }}
      {...attributes}
      {...listeners}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </Button>
  )
}
