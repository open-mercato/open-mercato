"use client"
import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

const variantStyles = {
  error: {
    container: 'border-red-200 bg-red-50 text-red-800',
    icon: 'border-red-500',
  },
  info: {
    container: 'border-blue-200 bg-blue-50 text-blue-900',
    icon: 'border-blue-500',
  },
  warning: {
    container: 'border-amber-200 bg-amber-50 text-amber-800',
    icon: 'border-amber-500',
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
