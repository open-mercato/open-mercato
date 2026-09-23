import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

export function Page({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('space-y-6', className)} {...props}>
      {children}
    </div>
  )
}

export type PageHeaderProps = {
  title: string
  description?: string
  actions?: React.ReactNode
  leading?: React.ReactNode
  titleAction?: React.ReactNode
  appearance?: 'page' | 'section'
  headingLevel?: 1 | 2 | 3
  divider?: boolean
  className?: string
}

export function PageHeader({
  title,
  description,
  actions,
  leading,
  titleAction,
  appearance,
  headingLevel = appearance === 'section' ? 2 : 1,
  divider = Boolean(appearance),
  className,
}: PageHeaderProps) {
  const Heading = headingLevel === 3 ? 'h3' : headingLevel === 2 ? 'h2' : 'h1'
  return (
    <div data-slot="page-header" data-appearance={appearance} className={cn(
      'relative flex flex-col gap-3 sm:flex-row sm:justify-between',
      appearance ? 'items-start bg-background px-8 sm:items-center sm:gap-3' : 'sm:items-start sm:gap-4',
      appearance === 'page' && 'py-5',
      appearance === 'section' && 'py-4',
      className,
    )}>
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        {leading ? <div data-slot="page-header-leading" className="flex shrink-0">{leading}</div> : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Heading className={appearance ? 'text-lg font-medium leading-6' : 'text-xl sm:text-2xl font-semibold leading-tight'}>{title}</Heading>
            {titleAction}
          </div>
          {description ? <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {actions ? <div data-slot="page-header-actions" className={cn('flex flex-wrap items-center', appearance ? 'gap-3' : 'gap-2')}>{actions}</div> : null}
      {divider ? <div aria-hidden="true" className="absolute inset-x-8 bottom-0 border-b border-border" /> : null}
    </div>
  )
}

export function PageBody({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('space-y-4', className)} {...props}>
      {children}
    </div>
  )
}
