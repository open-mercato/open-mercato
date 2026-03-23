"use client"

import * as React from 'react'
import { ShieldAlert } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'

const VARIANT_STYLES = {
  warning: 'border-amber-300/50 bg-amber-50/50 text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200',
  error: 'border-red-300/50 bg-red-50/50 text-red-900 dark:border-red-700/50 dark:bg-red-950/30 dark:text-red-200',
  info: 'border-blue-300/50 bg-blue-50/50 text-blue-900 dark:border-blue-700/50 dark:bg-blue-950/30 dark:text-blue-200',
} as const

type AccessDeniedMessageProps = {
  label: string
  description?: string
  action?: React.ReactNode
  className?: string
  iconClassName?: string
  variant?: keyof typeof VARIANT_STYLES
}

export function AccessDeniedMessage({
  label,
  description,
  action,
  className,
  iconClassName,
  variant = 'warning',
}: AccessDeniedMessageProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded border px-3 py-2 text-sm',
        VARIANT_STYLES[variant],
        className
      )}
      role="alert"
    >
      <ShieldAlert className={cn('h-4 w-4 flex-none', iconClassName)} aria-hidden />
      <div className="space-y-1">
        <p className="leading-tight">{label}</p>
        {description ? <p className="text-muted-foreground">{description}</p> : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  )
}
