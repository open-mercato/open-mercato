"use client"

import * as React from 'react'
import { ShieldAlert } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'

type AccessDeniedMessageProps = {
  label: string
  description?: string
  action?: React.ReactNode
  className?: string
  iconClassName?: string
}

export function AccessDeniedMessage({ label, description, action, className, iconClassName }: AccessDeniedMessageProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded border border-amber-300/50 bg-amber-50/50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200',
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
