"use client"

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { Badge } from '../primitives/badge'
import { cn } from '@open-mercato/shared/lib/utils'

export type SectionHeaderProps = {
  /** Section title */
  title: string
  /** Optional item count — displayed as muted badge */
  count?: number
  /** Action element(s) on the right — typically Button or IconButton */
  action?: React.ReactNode
  /** Additional className */
  className?: string
}

export function SectionHeader({
  title,
  count,
  action,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between', className)}>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
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
}: CollapsibleSectionProps) {
  const [internalCollapsed, setInternalCollapsed] = React.useState(defaultCollapsed)
  const isControlled = controlledCollapsed !== undefined
  const isCollapsed = isControlled ? controlledCollapsed : internalCollapsed

  const toggle = React.useCallback(() => {
    const next = !isCollapsed
    if (!isControlled) setInternalCollapsed(next)
    onCollapsedChange?.(next)
  }, [isCollapsed, isControlled, onCollapsedChange])

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-2 group"
          aria-expanded={!isCollapsed}
          aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${title} section`}
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform duration-200',
              isCollapsed && '-rotate-90',
            )}
          />
          <h3 className="text-sm font-semibold">{title}</h3>
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
