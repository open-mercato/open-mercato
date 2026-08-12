"use client"

import * as React from 'react'
import { Tabs, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'

export type WarrantyWorkspaceTab = {
  id: string
  label: string
  count?: number
  disabled?: boolean
}

type WarrantyWorkspaceProps = {
  title: string
  description?: string
  action?: React.ReactNode
  tabs?: WarrantyWorkspaceTab[]
  activeTab?: string
  onTabChange?: (value: string) => void
  summary?: React.ReactNode
  contentClassName?: string
  children: React.ReactNode
}

export function WarrantyWorkspace({
  title,
  description,
  action,
  tabs,
  activeTab,
  onTabChange,
  summary,
  contentClassName,
  children,
}: WarrantyWorkspaceProps) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-4 px-8 pb-6 pt-7 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {summary ?? null}
      {tabs?.length && activeTab && onTabChange ? (
        <Tabs value={activeTab} onValueChange={onTabChange} variant="underline">
          <TabsList className="flex h-auto w-full gap-1 overflow-x-auto px-7" aria-label={title}>
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                count={tab.count}
                disabled={tab.disabled}
                className="shrink-0 gap-2 px-4 pb-2 pt-3 [&_[data-slot=tabs-trigger-count]]:h-auto [&_[data-slot=tabs-trigger-count]]:min-w-0 [&_[data-slot=tabs-trigger-count]]:rounded-md [&_[data-slot=tabs-trigger-count]]:bg-muted [&_[data-slot=tabs-trigger-count]]:px-1.5 [&_[data-slot=tabs-trigger-count]]:py-0.5 [&_[data-slot=tabs-trigger-count]]:text-overline [&_[data-slot=tabs-trigger-count]]:text-muted-foreground"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}
      <div className={`min-w-0 [&>[data-component-handle]>div:first-child_[data-slot=button]]:h-8 [&>[data-component-handle]>div:first-child_[data-slot=search-input-wrapper]]:h-8 [&_[data-slot=table-header]_[data-slot=table-row]]:h-9 [&_[data-slot=table-body]_[data-slot=table-row]]:h-16 ${contentClassName ?? ''}`}>{children}</div>
    </section>
  )
}
