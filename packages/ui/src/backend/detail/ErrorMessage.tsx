"use client"

import * as React from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'

type ErrorMessageProps = {
  label: string
  description?: string
  action?: React.ReactNode
  className?: string
  iconClassName?: string
}

export function ErrorMessage({ label, description, action, className, iconClassName }: ErrorMessageProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive',
        className
      )}
      role="alert"
    >
      <AlertCircle className={cn('h-4 w-4 flex-none', iconClassName)} aria-hidden />
      <div className="space-y-1">
        <p className="leading-tight">{label}</p>
        {description ? <p className="text-muted-foreground">{description}</p> : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  )
}
