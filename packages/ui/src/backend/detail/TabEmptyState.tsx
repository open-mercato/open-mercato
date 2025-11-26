"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { EmptyState } from '../EmptyState'

type TabEmptyStateProps = {
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  disabled?: boolean
  className?: string
  children?: React.ReactNode
}

export function TabEmptyState({
  title,
  description,
  actionLabel,
  onAction,
  disabled,
  className,
  children,
}: TabEmptyStateProps) {
  return (
    <EmptyState
      title={title}
      description={description}
      action={
        actionLabel
          ? {
              label: actionLabel,
              onClick: onAction,
              disabled,
            }
          : undefined
      }
      className={cn('w-full', className)}
    >
      {children}
    </EmptyState>
  )
}
