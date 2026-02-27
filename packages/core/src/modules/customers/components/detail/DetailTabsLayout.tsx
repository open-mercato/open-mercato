"use client"

import * as React from 'react'
import type { SectionAction } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
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
  return (
    <div className={cn('space-y-4', className)}>
      <div className={cn('flex flex-wrap items-center justify-between gap-3', headerClassName)}>
        <nav
          className={cn('flex flex-wrap items-center gap-3 text-sm', navClassName)}
          role="tablist"
          aria-label={navAriaLabel}
        >
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              variant="ghost"
              size="sm"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'h-auto rounded-none border-b-2 px-0 py-1',
                activeTab === tab.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-transparent'
              )}
            >
              {tab.label}
            </Button>
          ))}
        </nav>
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
