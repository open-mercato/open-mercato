"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'

export type SavedViewTab = {
  id: string
  label: string
  count?: number
}

export type SavedViewTabsProps = {
  tabs: SavedViewTab[]
  activeId: string
  onSelect: (id: string) => void
  className?: string
}

export function SavedViewTabs({ tabs, activeId, onSelect, className }: SavedViewTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Saved views"
      className={`flex items-center gap-1 border-b border-border ${className ?? ''}`}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId
        return (
          <Button
            key={tab.id}
            type="button"
            variant="ghost"
            size="sm"
            role="tab"
            aria-selected={isActive}
            className={`h-auto rounded-none px-3 py-2 text-sm hover:bg-transparent ${
              isActive
                ? 'border-b-2 border-foreground font-medium text-foreground'
                : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
            {typeof tab.count === 'number' ? (
              <span className="ml-1.5 text-xs text-muted-foreground/70 tabular-nums">{tab.count}</span>
            ) : null}
          </Button>
        )
      })}
    </div>
  )
}
