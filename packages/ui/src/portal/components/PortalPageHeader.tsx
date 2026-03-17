"use client"
import type { ReactNode } from 'react'

type PortalPageHeaderProps = {
  title: string
  description?: string
  label?: string
  action?: ReactNode
}

/**
 * Portal page header with large title and optional action slot.
 * Matches the landing page's hero section typography — large,
 * tight tracking, with muted description.
 */
export function PortalPageHeader({ title, description, label, action }: PortalPageHeaderProps) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div>
        {label ? (
          <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground/60">
            {label}
          </p>
        ) : null}
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-3 shrink-0 sm:mt-0">{action}</div> : null}
    </div>
  )
}
