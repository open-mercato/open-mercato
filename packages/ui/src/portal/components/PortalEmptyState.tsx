"use client"
import type { ReactNode } from 'react'

type PortalEmptyStateProps = {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

/**
 * Empty state placeholder for portal sections with no content.
 * Dashed border, centered layout, optional icon and CTA.
 */
export function PortalEmptyState({ icon, title, description, action }: PortalEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-12 text-center">
      {icon ? (
        <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mt-0.5 max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ?? null}
    </div>
  )
}
