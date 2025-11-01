"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { Plus } from 'lucide-react'

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
  actionLabel?: string
  onAction?: () => void
  icon?: React.ReactNode
  className?: string
  actionLabelClassName?: string
  children?: React.ReactNode
}

export function EmptyState({
  title,
  description,
  action,
  actionLabel,
  onAction,
  icon,
  className,
  actionLabelClassName,
  children,
}: EmptyStateProps) {
  const resolvedAction = action ?? (actionLabel ? { label: actionLabel, onClick: onAction } : undefined)
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30 px-6 py-10 text-center',
        className
      )}
    >
      {icon ? <div className="mb-3 text-muted-foreground">{icon}</div> : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="mt-2 text-sm text-muted-foreground">{description}</p> : null}
      {children}
      {resolvedAction ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={resolvedAction.onClick}
          className={cn('mt-4 inline-flex items-center gap-2', actionLabelClassName)}
          disabled={resolvedAction.disabled}
        >
          {(resolvedAction.icon ?? <Plus className="h-4 w-4" aria-hidden />)}
          <span>{resolvedAction.label}</span>
        </Button>
      ) : null}
    </div>
  )
}
