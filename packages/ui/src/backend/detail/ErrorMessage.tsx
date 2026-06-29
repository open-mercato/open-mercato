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

const TECHNICAL_MESSAGE_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/

export function formatErrorMessageLabel(label: string): string {
  const trimmed = label.trim()
  if (!TECHNICAL_MESSAGE_PATTERN.test(trimmed)) return label

  const parts = trimmed.split(/[._-]+/).filter(Boolean)
  const meaningfulParts = parts.length > 2 ? parts.slice(-2) : parts
  const sentence = meaningfulParts.join(' ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

export function ErrorMessage({ label, description, action, className, iconClassName }: ErrorMessageProps) {
  const displayLabel = formatErrorMessageLabel(label)
  const displayDescription = description ? formatErrorMessageLabel(description) : undefined

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
        <p className="leading-tight">{displayLabel}</p>
        {displayDescription ? <p className="text-muted-foreground">{displayDescription}</p> : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  )
}
