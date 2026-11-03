import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { CompactButton } from './compact-button'
import { ContentLabel, type ContentLabelProps } from './content-label'

export type ContentCardProps = Omit<ContentLabelProps, 'size' | 'titleBadge'> & { disabled?: boolean } & (
  { onDismiss: () => void; dismissLabel: string } | { onDismiss?: undefined; dismissLabel?: string }
)

export function ContentCard({ label, description, sublabel, leading, badge, trailing, onDismiss, dismissLabel, disabled = false, className, ...props }: ContentCardProps) {
  return <div data-slot="content-card" className={cn('flex min-w-0 items-center gap-3.5 rounded-content-card bg-background p-4 shadow-xs ring-1 ring-inset ring-border', className)} {...props}>
    <ContentLabel label={label} description={description} sublabel={sublabel} leading={leading} titleBadge={badge} trailing={trailing} className="flex-1" />
    {onDismiss ? <CompactButton type="button" size={20} appearance="ghost" aria-label={dismissLabel} onClick={onDismiss} disabled={disabled}><X className="size-5" aria-hidden="true" /></CompactButton> : null}
  </div>
}
