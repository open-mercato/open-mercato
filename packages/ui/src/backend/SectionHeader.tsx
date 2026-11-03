"use client"

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { Badge } from '../primitives/badge'
import { cn } from '@open-mercato/shared/lib/utils'
import { useOptionalT } from '@open-mercato/shared/lib/i18n/context'

export type SectionHeaderProps = {
  /** Section title */
  title: string
  /** Optional item count — displayed as muted badge */
  count?: number
  /** Action element(s) on the right — typically Button or IconButton */
  action?: React.ReactNode
  /** Additional className */
  className?: string
  /**
   * Additional className on the title element. Supplying it also lets the title row
   * shrink below its content width, so `truncate` takes effect in narrow containers.
   */
  titleClassName?: string
}

export function SectionHeader({
  title,
  count,
  action,
  className,
  titleClassName,
}: SectionHeaderProps) {
  const allowsTitleShrink = Boolean(titleClassName)
  return (
    <div className={cn('flex items-center justify-between', className)}>
      <div className={cn('flex items-center gap-2', allowsTitleShrink && 'min-w-0')}>
        <h3 className={cn('text-sm font-semibold', allowsTitleShrink && 'min-w-0', titleClassName)}>{title}</h3>
        {count != null && (
          <Badge variant="muted" className="text-xs tabular-nums">
            {count}
          </Badge>
        )}
      </div>
      {action ? (
        <div className="flex items-center gap-1">
          {action}
        </div>
      ) : null}
    </div>
  )
}

export type CollapsibleSectionProps = {
  /** Section title */
  title: string
  count?: number
  action?: React.ReactNode
  /** Collapse behavior */
  defaultCollapsed?: boolean
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  /** Content */
  children?: React.ReactNode
  /** Additional className on root */
  className?: string
  /** Additional className on content wrapper */
  contentClassName?: string
  /**
   * Additional className on the title element. Supplying it also lets the header row
   * shrink below its content width, so `truncate` takes effect in narrow containers.
   */
  titleClassName?: string
}

export function CollapsibleSection({
  title,
  count,
  action,
  defaultCollapsed = false,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  children,
  className,
  contentClassName,
  titleClassName,
}: CollapsibleSectionProps) {
  const [internalCollapsed, setInternalCollapsed] = React.useState(defaultCollapsed)
  const isControlled = controlledCollapsed !== undefined
  const isCollapsed = isControlled ? controlledCollapsed : internalCollapsed

  const toggle = React.useCallback(() => {
    const next = !isCollapsed
    if (!isControlled) setInternalCollapsed(next)
    onCollapsedChange?.(next)
  }, [isCollapsed, isControlled, onCollapsedChange])

  const contextT = useOptionalT()
  const t = (key: string, fallback: string) =>
    contextT ? contextT(key, fallback, { title }) : fallback.replace('{title}', title)
  const toggleAriaLabel = isCollapsed
    ? t('ui.sectionHeader.expand', 'Expand {title} section')
    : t('ui.sectionHeader.collapse', 'Collapse {title} section')
  const allowsTitleShrink = Boolean(titleClassName)

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={toggle}
          className={cn('flex items-center gap-2 group', allowsTitleShrink && 'min-w-0')}
          aria-expanded={!isCollapsed}
          aria-label={toggleAriaLabel}
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform duration-200',
              isCollapsed && '-rotate-90',
              allowsTitleShrink && 'shrink-0',
            )}
          />
          <h3 className={cn('text-sm font-semibold', allowsTitleShrink && 'min-w-0', titleClassName)}>{title}</h3>
          {count != null && (
            <Badge variant="muted" className="text-xs tabular-nums">
              {count}
            </Badge>
          )}
        </button>
        {action ? (
          <div className="flex items-center gap-1">
            {action}
          </div>
        ) : null}
      </div>

      {!isCollapsed && (
        <div className={contentClassName}>
          {children}
        </div>
      )}
    </div>
  )
}
