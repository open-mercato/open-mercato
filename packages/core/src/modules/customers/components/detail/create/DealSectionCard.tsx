"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

export type DealSectionCardProps = {
  icon: React.ComponentType<{ className?: string }>
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function DealSectionCard({
  icon: Icon,
  title,
  subtitle,
  actions,
  children,
  className,
}: DealSectionCardProps) {
  return (
    <section className={cn('rounded-lg border border-border bg-card shadow-sm p-6 space-y-6', className)}>
      {/* Stacked below `sm`: in one row the actions stay `shrink-0` while the title column is
          `min-w-0`, so at phone width the heading collapses to a sliver and breaks word by word
          under the buttons — worse in languages with longer labels than English (#6858). */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-violet/10">
            <Icon className="size-4 text-brand-violet" />
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-base font-semibold text-foreground">{title}</p>
            {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
        ) : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}
