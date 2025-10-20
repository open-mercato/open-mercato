"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'

type EmptyStateAction = {
  label: string
  onClick?: () => void
  icon?: React.ReactNode
  disabled?: boolean
}

type EmptyStateProps = {
  title: string
  description?: string
  action?: EmptyStateAction
  className?: string
  actionLabelClassName?: string
}

export function EmptyState({
  title,
  description,
  action,
  className,
  actionLabelClassName,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30 px-6 py-10 text-center',
        className
      )}
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="mt-2 text-sm text-muted-foreground">{description}</p> : null}
      {action ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={action.onClick}
          className={cn('mt-4 inline-flex items-center gap-2', actionLabelClassName)}
          disabled={action.disabled}
        >
          {action.icon}
          <span>{action.label}</span>
        </Button>
      ) : null}
    </div>
  )
}
