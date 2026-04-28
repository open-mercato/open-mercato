"use client"

import * as React from 'react'
import { LayoutGrid, List } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import type { ProjectsViewMode } from './useProjectsViewMode'

export type ViewModeToggleProps = {
  mode: ProjectsViewMode
  onChange: (mode: ProjectsViewMode) => void
  tableLabel: string
  cardsLabel: string
  className?: string
}

export function ViewModeToggle({
  mode,
  onChange,
  tableLabel,
  cardsLabel,
  className,
}: ViewModeToggleProps) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className={`inline-flex items-center rounded-md border border-border p-0.5 ${className ?? ''}`}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={mode === 'table'}
        className={`h-auto gap-1.5 px-2.5 py-1 text-xs ${
          mode === 'table'
            ? 'bg-foreground text-background hover:bg-foreground'
            : 'text-muted-foreground hover:bg-muted'
        }`}
        onClick={() => onChange('table')}
      >
        <List className="h-3.5 w-3.5" aria-hidden="true" />
        {tableLabel}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={mode === 'cards'}
        className={`h-auto gap-1.5 px-2.5 py-1 text-xs ${
          mode === 'cards'
            ? 'bg-foreground text-background hover:bg-foreground'
            : 'text-muted-foreground hover:bg-muted'
        }`}
        onClick={() => onChange('cards')}
      >
        <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
        {cardsLabel}
      </Button>
    </div>
  )
}
