"use client"
import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

/**
 * @deprecated Use <Alert variant="destructive|warning|info"> instead.
 * Migration guide: docs/design-system/migration-tables.md#j3-component-mapping
 *
 * Notice variant="error"   → Alert variant="destructive"
 * Notice variant="warning" → Alert variant="warning"
 * Notice variant="info"    → Alert variant="info"
 */

const variantStyles = {
  error: {
    container: 'border-status-error-border bg-status-error-bg text-status-error-text',
    icon: 'border-status-error-icon',
  },
  info: {
    container: 'border-status-info-border bg-status-info-bg text-status-info-text',
    icon: 'border-status-info-icon',
  },
  warning: {
    container: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
    icon: 'border-status-warning-icon',
  },
} as const

export type NoticeVariant = keyof typeof variantStyles

export type NoticeProps = {
  variant?: NoticeVariant
  title?: string
  message?: string
  action?: React.ReactNode
  children?: React.ReactNode
  className?: string
  compact?: boolean
}

export function Notice({
  variant = 'info',
  title,
  message,
  action,
  children,
  className,
  compact = false,
}: NoticeProps) {
  if (process.env.NODE_ENV === 'development') {
    console.warn(
      '[DS] <Notice> is deprecated. Use <Alert variant="destructive|warning|info"> instead. ' +
      'See: docs/design-system/migration-tables.md'
    )
  }

  const styles = variantStyles[variant]

  if (compact || (!title && !action && (children || message))) {
    return (
      <div className={cn('rounded-md border px-3 py-2 text-sm', styles.container, className)}>
        {children ?? message}
      </div>
    )
  }

  return (
    <div className={cn('rounded-md border p-4', styles.container, className)}>
      <div className="flex items-start gap-3">
        <span
          className={cn('inline-block mt-0.5 h-4 w-4 rounded-full border-2 shrink-0', styles.icon)}
          aria-hidden
        />
        <div className="space-y-1">
          {title ? <div className="text-sm font-medium">{title}</div> : null}
          {message ? <div className="text-sm opacity-90">{message}</div> : null}
          {children}
          {action ? <div className="mt-2">{action}</div> : null}
        </div>
      </div>
    </div>
  )
}
