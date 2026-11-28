"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

export type TileHeaderProps = {
  title: string
  /** Icon rendered in a muted chip before the title; any lucide icon element works. */
  icon?: React.ReactNode
  /** Trailing control such as a range selector or a menu button. */
  action?: React.ReactNode
  /** Heading element; dashboard cards use `h2`, tiles inside a card use the default `h3`. */
  as?: 'h2' | 'h3'
  className?: string
}

/** Shared tile heading for dashboard cards: icon chip, muted base-size title, optional trailing action. */
export function TileHeader({ title, icon, action, as: Heading = 'h3', className }: TileHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-2', className)} data-slot="tile-header">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4" aria-hidden="true">{icon}</span>
        ) : null}
        <Heading className="min-w-0 truncate text-base leading-tight text-muted-foreground" title={title}>{title}</Heading>
      </div>
      {action}
    </div>
  )
}

export default TileHeader
