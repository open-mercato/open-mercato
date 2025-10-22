"use client"

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'

type LoadingMessageProps = {
  label: string
  className?: string
  iconClassName?: string
}

export function LoadingMessage({ label, className, iconClassName }: LoadingMessageProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2 rounded-xl border border-border/40 bg-background/80 p-4 text-sm text-muted-foreground',
        className
      )}
    >
      <Loader2 className={cn('h-4 w-4 animate-spin', iconClassName)} />
      <span>{label}</span>
    </div>
  )
}
