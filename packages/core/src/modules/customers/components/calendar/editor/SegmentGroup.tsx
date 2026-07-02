"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'

export type SegmentOption<T extends string> = { value: T; label: string; icon?: React.ReactNode }

export function SegmentGroup<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  ariaLabel,
  fullWidth = false,
}: {
  options: Array<SegmentOption<T>>
  value: T
  onChange(next: T): void
  size?: 'sm' | 'md'
  ariaLabel: string
  /** Stretch across the container with equal-width, centered segments. */
  fullWidth?: boolean
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'max-w-full items-start rounded-md border border-border bg-background',
        fullWidth ? 'flex w-full' : 'inline-flex overflow-x-auto',
      )}
    >
      {options.map((option, index) => {
        const isActive = option.value === value
        return (
          <Button
            key={option.value}
            type="button"
            variant="ghost"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-auto gap-1.5 rounded-none border-0 text-sm font-medium leading-5 shadow-none',
              size === 'md' ? 'px-4 py-2' : 'px-3.5 py-1.5',
              index > 0 && 'border-l border-border',
              fullWidth && 'flex-1 justify-center',
              isActive ? 'bg-muted text-foreground hover:bg-muted' : 'bg-background text-muted-foreground',
            )}
          >
            {option.icon ? <span aria-hidden className="shrink-0 opacity-70">{option.icon}</span> : null}
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}
