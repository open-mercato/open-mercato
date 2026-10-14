import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

export type ContentLabelProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> & {
  label: React.ReactNode
  description?: React.ReactNode
  sublabel?: React.ReactNode
  leading?: React.ReactNode
  titleBadge?: React.ReactNode
  badge?: React.ReactNode
  trailing?: React.ReactNode
  size?: 40 | 48
}

export function ContentLabel({ label, description, sublabel, leading, titleBadge, badge, trailing, size = 40, className, ...props }: ContentLabelProps) {
  return <div data-slot="content-label" data-size={size} className={cn('flex min-w-0 items-center gap-3.5', size === 40 ? 'min-h-10' : 'min-h-12', className)} {...props}>
    {leading ? <span data-slot="content-label-leading" className="inline-flex shrink-0 items-center justify-center">{leading}</span> : null}
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <span data-slot="content-label-title" className={cn('font-medium text-foreground', size === 40 ? 'text-sm leading-5' : 'text-base leading-6')}>{label}</span>
        {sublabel ? <span className="text-xs leading-4 text-muted-foreground">{sublabel}</span> : null}
        {titleBadge}
      </div>
      {description ? <span data-slot="content-label-description" className={cn('text-muted-foreground', size === 40 ? 'text-xs leading-4' : 'text-sm leading-5')}>{description}</span> : null}
    </div>
    {badge}{trailing}
  </div>
}
