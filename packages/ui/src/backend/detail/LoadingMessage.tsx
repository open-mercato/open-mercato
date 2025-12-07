"use client"

import * as React from 'react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { cn } from '@open-mercato/shared/lib/utils'

export function LoadingMessage({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 rounded border bg-muted/30 px-3 py-2 text-sm text-muted-foreground', className)}>
      <Spinner className="h-4 w-4" />
      <span>{label}</span>
    </div>
  )
}
