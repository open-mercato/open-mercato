"use client"

import * as React from 'react'
import type { SectionAction } from './NotesSection'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tabs, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { cn } from '@open-mercato/shared/lib/utils'
import { Plus } from 'lucide-react'

export type DetailTabDefinition<TId extends string = string> = {
  id: TId
  label: React.ReactNode
}

type DetailTabsLayoutProps<TId extends string = string> = {
  tabs: DetailTabDefinition<TId>[]
  activeTab: TId
  onTabChange: (id: TId) => void
  sectionAction: SectionAction | null
  onSectionAction: () => void
  navAriaLabel: string
  className?: string
  headerClassName?: string
  navClassName?: string
  children: React.ReactNode
}

export function DetailTabsLayout<TId extends string = string>({
  tabs,
  activeTab,
  onTabChange,
  sectionAction,
  onSectionAction,
  navAriaLabel,
  className,
  headerClassName,
  navClassName,
  children,
}: DetailTabsLayoutProps<TId>) {
  const handleTabChange = React.useCallback(
    (id: TId) => {
      onTabChange(id)
    },
    [onTabChange],
  )

  return (
    <div className={cn('space-y-4', className)}>
      <div className={cn('flex flex-wrap items-center justify-between gap-3', headerClassName)}>
        <Tabs
          value={activeTab}
          onValueChange={(value) => handleTabChange(value as TId)}
          variant="underline"
        >
          <TabsList className={cn('h-auto flex-wrap border-b-0', navClassName)} aria-label={navAriaLabel}>
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {sectionAction ? (
          <Button
            type="button"
            size="sm"
            onClick={onSectionAction}
            disabled={sectionAction.disabled}
          >
            {sectionAction.icon ?? (typeof sectionAction.label === 'string' || typeof sectionAction.label === 'number' ? (
              <Plus className="mr-2 h-4 w-4" />
            ) : null)}
            {sectionAction.label}
          </Button>
        ) : null}
      </div>
      <div>{children}</div>
    </div>
  )
}
