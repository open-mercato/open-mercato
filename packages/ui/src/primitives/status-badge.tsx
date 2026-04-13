import * as React from 'react'
import { Badge } from './badge'
import { cn } from '@open-mercato/shared/lib/utils'

export type StatusBadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral'

export type StatusBadgeProps = {
  /** Visual variant — maps to semantic color tokens via Badge */
  variant: StatusBadgeVariant
  /** Badge text */
  children: React.ReactNode
  /** Show colored dot before text */
  dot?: boolean
  /** Additional className */
  className?: string
}

const dotColors: Record<StatusBadgeVariant, string> = {
  success: 'bg-status-success-icon',
  warning: 'bg-status-warning-icon',
  error: 'bg-status-error-icon',
  info: 'bg-status-info-icon',
  neutral: 'bg-status-neutral-icon',
}

export function StatusBadge({
  variant,
  children,
  dot = false,
  className,
}: StatusBadgeProps) {
  return (
    <Badge
      variant={variant}
      className={cn(dot && 'gap-1.5', className)}
    >
      {dot && (
        <span
          className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', dotColors[variant])}
          aria-hidden="true"
        />
      )}
      {children}
    </Badge>
  )
}

/**
 * Helper type: modules define their own status → variant mapping.
 *
 * @example
 * const customerStatusMap: StatusMap<'active' | 'inactive' | 'archived'> = {
 *   active: 'success',
 *   inactive: 'neutral',
 *   archived: 'warning',
 * }
 *
 * <StatusBadge variant={customerStatusMap[customer.status] ?? 'neutral'} dot>
 *   {t(`customers.status.${customer.status}`)}
 * </StatusBadge>
 */
export type StatusMap<T extends string = string> = Record<T, StatusBadgeVariant>
