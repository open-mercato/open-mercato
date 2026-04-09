'use client'
import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../primitives/button'
import { useGroupCollapse } from './useGroupCollapse'

export interface CollapsibleGroupProps {
  groupId: string
  title?: string
  pageType: string
  defaultExpanded?: boolean
  errorCount?: number
  fieldCount?: number
  chevronPosition?: 'left' | 'right'
  icon?: React.ReactNode
  children: React.ReactNode
}

export interface CollapsibleGroupHandle {
  expand: () => void
}

export const CollapsibleGroup = React.forwardRef<CollapsibleGroupHandle, CollapsibleGroupProps>(
  function CollapsibleGroup({ groupId, title, pageType, defaultExpanded = true, errorCount = 0, fieldCount, chevronPosition = 'right', icon, children }, ref) {
    const t = useT()
    const { expanded, toggle, setExpanded } = useGroupCollapse(pageType, groupId, defaultExpanded)
    const contentId = `collapsible-group-${groupId}`

    React.useImperativeHandle(ref, () => ({
      expand: () => setExpanded(true),
    }), [setExpanded])

    const chevronIcon = (
      <ChevronDown
        className={cn(
          'size-4 shrink-0 motion-safe:transition-transform motion-safe:duration-200',
          expanded && 'rotate-180'
        )}
      />
    )

    const fieldCountLabel = typeof fieldCount === 'number' && fieldCount > 0 ? (
      <span className="text-xs font-normal text-muted-foreground">
        · {fieldCount} {fieldCount === 1
          ? t('ui.collapsible.fieldSingular', 'field')
          : t('ui.collapsible.fieldPlural', 'fields')}
      </span>
    ) : null

    const errorBadge = errorCount > 0 ? (
      <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
        {errorCount === 1
          ? t('ui.collapsible.errorSingular', '{{count}} error', { count: errorCount })
          : t('ui.collapsible.errorPlural', '{{count}} errors', { count: errorCount })}
      </span>
    ) : null

    return (
      <div className={cn('rounded-lg border bg-card', errorCount > 0 && 'border-destructive')}>
        {title && (
          <Button
            type="button"
            variant="muted"
            onClick={toggle}
            className={cn(
              'w-full px-4 py-3 text-sm font-medium hover:bg-accent/50 rounded-lg',
              chevronPosition === 'left' ? 'justify-start gap-2' : 'justify-between',
            )}
            aria-expanded={expanded}
            aria-controls={contentId}
          >
            {chevronPosition === 'left' ? (
              <>
                {chevronIcon}
                <span className="flex items-center gap-2">
                  {icon && <span className="relative shrink-0 text-muted-foreground">{icon}{!expanded && errorCount > 0 && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-destructive" />}</span>}
                  <span>{title}</span>
                  {fieldCountLabel}
                  {errorBadge}
                </span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-2">
                  {icon && <span className="relative shrink-0 text-muted-foreground">{icon}{!expanded && errorCount > 0 && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-destructive" />}</span>}
                  <span>{title}</span>
                  {fieldCountLabel}
                  {errorBadge}
                </span>
                {chevronIcon}
              </>
            )}
          </Button>
        )}
        <div
          id={contentId}
          className={cn(
            'motion-safe:transition-all motion-safe:duration-200 overflow-hidden',
            expanded ? 'max-h-[5000px] opacity-100' : 'max-h-0 opacity-0'
          )}
        >
          <div className="px-4 py-3">
            {children}
          </div>
        </div>
      </div>
    )
  }
)
