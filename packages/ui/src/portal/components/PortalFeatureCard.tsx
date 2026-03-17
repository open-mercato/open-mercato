"use client"
import type { ReactNode } from 'react'

type PortalFeatureCardProps = {
  icon?: ReactNode
  title: string
  description?: string
  href?: string
  onClick?: () => void
}

/**
 * Feature card matching the landing page's 3-column feature grid.
 * Subtle border, icon block, title, and description.
 * Can be a link or a static display card.
 */
export function PortalFeatureCard({ icon, title, description, href, onClick }: PortalFeatureCardProps) {
  const content = (
    <>
      {icon ? (
        <div className="mb-3 flex size-10 items-center justify-center rounded-lg border bg-background text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
    </>
  )

  const cls = 'flex flex-col rounded-xl border bg-card p-5 transition-colors hover:bg-accent/50'

  if (href) {
    return <a href={href} className={cls}>{content}</a>
  }
  if (onClick) {
    return <button type="button" onClick={onClick} className={`${cls} text-left`}>{content}</button>
  }
  return <div className="flex flex-col rounded-xl border bg-card p-5">{content}</div>
}
