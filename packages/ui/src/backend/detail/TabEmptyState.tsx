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
  action?: {
    label: string
    onClick?: () => void
    icon?: React.ReactNode
    disabled?: boolean
  }
  className?: string
  children?: React.ReactNode
}

export function TabEmptyState({
  title,
  description,
  actionLabel,
  onAction,
  disabled,
  action,
  className,
  children,
}: TabEmptyStateProps) {
  const resolvedAction =
    action ??
    (actionLabel
      ? {
          label: actionLabel,
          onClick: onAction,
          disabled,
        }
      : undefined)

  return (
    <EmptyState title={title} description={description} action={resolvedAction} className={cn('w-full', className)}>
      {children}
    </EmptyState>
  )
}
