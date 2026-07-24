"use client"

import * as React from 'react'
import { Tabs, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'

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
  ariaLabel?: string
}

export function SavedViewTabs({ tabs, activeId, onSelect, className, ariaLabel }: SavedViewTabsProps) {
  return (
    <Tabs value={activeId} onValueChange={onSelect} variant="underline" className={className}>
      <TabsList className="w-full flex-wrap" aria-label={ariaLabel ?? 'Saved views'}>
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            count={typeof tab.count === 'number' ? tab.count : undefined}
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
