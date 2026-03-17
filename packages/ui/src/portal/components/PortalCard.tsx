"use client"
import type { ReactNode } from 'react'

type PortalCardProps = {
  children: ReactNode
  className?: string
}

/**
 * Portal-styled card container.
 * Clean card with subtle border and minimal shadow, matching the
 * Open Mercato design language.
 */
export function PortalCard({ children, className }: PortalCardProps) {
  return (
    <div className={`rounded-xl border bg-card p-5 sm:p-6 ${className ?? ''}`}>
      {children}
    </div>
  )
}

type PortalCardHeaderProps = {
  title: string
  description?: string
  label?: string
  action?: ReactNode
}

/**
 * Card header with optional uppercase label, title, description, and action slot.
 * Matches the section label pattern from the landing page (small caps, muted).
 */
export function PortalCardHeader({ title, description, label, action }: PortalCardHeaderProps) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        {label ? (
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground/60">
            {label}
          </p>
        ) : null}
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

type PortalStatRowProps = {
  label: string
  value: ReactNode
}

/**
 * Key-value row for displaying stats/info inside a PortalCard.
 * Uses the uppercase label style from the landing page's data fields.
 */
export function PortalStatRow({ label, value }: PortalStatRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {label}
      </span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  )
}

/**
 * Divider between stat rows.
 */
export function PortalCardDivider() {
  return <div className="border-t" />
}
