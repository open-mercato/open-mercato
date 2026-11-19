'use client'

import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from './button'

export type FilterToolbarProps = React.HTMLAttributes<HTMLDivElement> & {
  leading?: React.ReactNode
}

/** Presentation slots for the table and calendar filter compositions. */
export function FilterToolbar({ leading, children, className, ...props }: FilterToolbarProps) {
  return <div data-slot="filter-toolbar" className={cn('flex w-full flex-wrap items-start gap-3', className)} {...props}>
    {leading ? <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">{leading}</div> : null}
    <div className="flex min-w-0 flex-wrap items-center gap-3">{children}</div>
  </div>
}

export type FilterPanelItemProps = React.ComponentPropsWithoutRef<typeof Button> & {
  active?: boolean
  leading?: React.ReactNode
}

export const FilterPanelItem = React.forwardRef<HTMLButtonElement, FilterPanelItemProps>(
  ({ active = false, leading, children, className, ...props }, ref) => <Button
    ref={ref}
    variant="link"
    data-slot="filter-panel-item"
    data-active={active || undefined}
    aria-pressed={active}
    className={cn('h-9 w-full justify-start gap-2 rounded-md p-2 text-sm font-medium text-muted-foreground no-underline hover:no-underline hover:bg-muted hover:text-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground', className)}
    {...props}
  >
    {leading ? <span aria-hidden="true" className={cn('flex size-5 shrink-0 items-center justify-center [&>svg]:size-5', active && 'text-status-info-text')}>{leading}</span> : null}
    <span className="min-w-0 flex-1 text-left">{children}</span>
    <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
  </Button>,
)
FilterPanelItem.displayName = 'FilterPanelItem'

export type FilterPanelHeaderProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> & {
  title: React.ReactNode
  leading?: React.ReactNode
  action?: React.ReactNode
}

export function FilterPanelHeader({ title, leading, action, className, ...props }: FilterPanelHeaderProps) {
  return <div data-slot="filter-panel-header" className={cn('flex min-h-13 items-center gap-2 bg-background px-5 py-4 text-sm leading-5', className)} {...props}>
    {leading ? <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-5">{leading}</span> : null}
    <div className="min-w-0 flex-1 font-medium">{title}</div>
    {action}
  </div>
}

export function FilterPanelFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="filter-panel-footer" className={cn('flex min-h-17 items-center gap-4 bg-background px-5 py-4 border-t border-border [&>button]:flex-1', className)} {...props} />
}
