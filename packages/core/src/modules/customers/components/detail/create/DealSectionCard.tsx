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
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-violet/10">
            <Icon className="size-4 text-brand-violet" />
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-base font-semibold text-foreground">{title}</p>
            {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}
