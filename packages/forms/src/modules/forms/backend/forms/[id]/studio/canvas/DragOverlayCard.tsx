'use client'

import type { LucideIcon } from 'lucide-react'

export function DragOverlayCard({
  Icon,
  label,
  widthPx,
}: {
  Icon: LucideIcon
  label: string
  widthPx?: number
}) {
  const hasWidth = typeof widthPx === 'number' && Number.isFinite(widthPx) && widthPx > 0
  const baseClass = hasWidth
    ? 'flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-lg'
    : 'flex min-w-40 items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-lg'
  return (
    <div className={baseClass} style={hasWidth ? { width: widthPx } : undefined}>
      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </div>
  )
}
