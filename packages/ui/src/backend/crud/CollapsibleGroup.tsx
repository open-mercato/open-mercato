'use client'
import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../primitives/button'
import { useGroupCollapse } from './useGroupCollapse'
import { SortableGroupHandle, useSortableGroupHandle } from './SortableGroupHandle'

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
    const { expanded, toggle, setExpanded, isHydrated } = useGroupCollapse(pageType, groupId, defaultExpanded)
    const contentId = `collapsible-group-${groupId}`
    const sortableHandle = useSortableGroupHandle()
    const showDragHandle = sortableHandle !== null

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

    const dragHandle = showDragHandle ? (
      <span
        className="inline-flex shrink-0 items-center"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <SortableGroupHandle ariaLabel={t('ui.crud.dragHandle.aria', 'Drag to reorder')} />
      </span>
    ) : null

    return (
      <div
        id={`collapsible-group-wrapper-${groupId}`}
        className={cn(
          // Aligned with Figma Accordion `210:4022`: rounded-10, three visual
          // states (closed = white card + soft border + x-small shadow,
          // hover-while-closed = bg-muted + no border + no shadow,
          // open = bg-muted + no border + no shadow). Destructive border
          // wins over the Figma states when the group has validation errors.
          'rounded-[10px] border bg-card transition-colors',
          !isHydrated && 'invisible',
          errorCount > 0
            ? 'border-destructive'
            : expanded
              ? 'border-transparent bg-muted shadow-none'
              : 'border-border shadow-xs hover:border-transparent hover:bg-muted hover:shadow-none',
        )}
        data-collapsible-group-id={groupId}
        data-state={expanded ? 'open' : 'closed'}
        data-persistence-hydrated={isHydrated ? 'true' : 'false'}
        aria-hidden={isHydrated ? undefined : true}
      >
        {title && (
          <div
            className={cn(
              'flex items-center gap-2 px-2 py-2',
              chevronPosition === 'left' ? 'flex-row' : 'flex-row',
            )}
          >
            {dragHandle}
            <Button
              type="button"
              variant="muted"
              onClick={toggle}
              className={cn(
                // Defer hover styling to the surrounding wrapper so the whole
                // row toggles to `bg-muted` together (Figma Accordion behaviour)
                // instead of stacking a second hover layer over the trigger
                // button.
                'flex-1 rounded-md px-2 py-1 text-sm font-medium hover:bg-transparent dark:hover:bg-transparent',
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
          </div>
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
